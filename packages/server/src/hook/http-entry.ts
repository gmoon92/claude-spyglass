/**
 * hook 모듈 — HTTP 진입점 (/collect 엔드포인트)
 *
 * 책임:
 *  - POST /collect 요청을 받아 raw JSON 파싱.
 *  - 진단 로그(stdout [RECV] + hook-payload.jsonl)에 기록.
 *  - HookContext 구성 후 dispatchHookEvent(raw, ctx)로 위임.
 *
 * 디자인 노트:
 *  - 외부 hook 스크립트(spyglass-collect.sh)와의 호환성을 위해 HTTP 엔드포인트는 `/collect` 그대로 유지.
 *  - 내부 함수·심볼은 hook 명명 정합화 적용 (handleHookHttpRequest, processHookEvent, dispatchHookEvent).
 *
 * 외부 노출:
 *  - handleHookHttpRequest(req, db) : HTTP 라우터에서 호출 (server/index.ts)
 *  - rawCollectHandler              : @deprecated handleHookHttpRequest의 별칭 (외부 호환)
 *  - collectHandler                 : @deprecated 정제된 페이로드 직접 수신 (테스트용)
 *
 * 호출자:
 *  - server/src/index.ts: path === '/collect' 라우팅
 *  - 테스트: __tests__/server.test.ts, collect.test.ts
 *
 * 의존성:
 *  - @spyglass/storage: SpyglassDatabase, getDatabase (CLI 테스트)
 *  - ../diag-log: hook-payload.jsonl
 *  - 동일 모듈: types, dispatcher, processor
 */

import { SpyglassDatabase, getDatabase } from '@spyglass/storage';
import { diagJson } from '../diag-log';
import type { ClaudeHookPayload, NormalizedHookPayload, HookProcessResult } from './types';
import type { HookContext } from './event-handler';
import { dispatchHookEvent } from './dispatcher';
import { processHookEvent } from './processor';

/**
 * raw Claude Code hook payload를 받아 dispatcher로 라우팅.
 *
 * 흐름:
 *  1. POST 검증 + JSON 파싱 (실패 시 400)
 *  2. [RECV] stdout + hook-payload.jsonl 기록 (사후 채널 비교 분석용)
 *  3. HookContext 구성 (db, now, project_name)
 *  4. dispatchHookEvent → handler가 raw → NormalizedHookPayload 정제 → processHookEvent → DB
 *  5. 결과 success → 200, 실패 → 400
 */
export async function handleHookHttpRequest(
  req: Request,
  db: SpyglassDatabase,
): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let raw: ClaudeHookPayload;
  try {
    raw = (await req.json()) as ClaudeHookPayload;
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid JSON payload' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const { hook_event_name, session_id, cwd, tool_name, tool_use_id } = raw;

  console.log(`[RECV] ${hook_event_name} session=${session_id}`);

  // 진단: 훅 raw payload 전체를 jsonl 한 줄로 보존 (proxy 채널과 사후 비교용)
  diagJson('hook-payload', {
    hook_event_name,
    session_id,
    tool_name: tool_name ?? null,
    tool_use_id: tool_use_id ?? null,
    cwd: cwd ?? null,
    raw,
  });

  const ctx: HookContext = {
    db: db.instance,
    now: Date.now(),
    projectName: cwd ? cwd.split('/').pop() ?? 'unknown' : 'unknown',
  };

  const result = dispatchHookEvent(raw, ctx);

  return jsonResponse(result);
}

/**
 * @deprecated handleHookHttpRequest의 alias. v21 명명 정합화 이전 호출자 호환.
 */
export const rawCollectHandler = handleHookHttpRequest;

/**
 * @deprecated 정제된 NormalizedHookPayload를 직접 수신하는 레거시 핸들러.
 *  현재 운영에서는 사용 안 함. __tests__/collect.test.ts 등이 의존하므로 export 유지.
 */
export async function collectHandler(req: Request, db: SpyglassDatabase): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload = (await req.json()) as NormalizedHookPayload;
    const result = processHookEvent(db.instance, payload);
    return jsonResponse(result);
  } catch (error) {
    console.error('[Hook] Error processing legacy request:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Invalid JSON payload' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

function jsonResponse(result: HookProcessResult): Response {
  return new Response(JSON.stringify(result), {
    status: result.success ? 200 : 400,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

// =============================================================================
// CLI 직접 실행 테스트 (bun run packages/server/src/hook/http-entry.ts)
// =============================================================================
if (import.meta.main) {
  const db = getDatabase();
  const testPayload: NormalizedHookPayload = {
    id: `test-${Date.now()}`,
    session_id: 'test-session',
    project_name: 'test-project',
    timestamp: Date.now(),
    event_type: 'prompt',
    request_type: 'prompt',
    model: 'claude-sonnet',
    tokens_input: 100,
    tokens_output: 50,
    tokens_total: 150,
    duration_ms: 1000,
    source: 'cli-test',
  };

  console.log('Testing hook processor...');
  const result = processHookEvent(db.instance, testPayload);
  console.log('Result:', JSON.stringify(result, null, 2));

  if (result.success) {
    console.log('Hook processor test passed');
  } else {
    console.error('Hook processor test failed:', result.error);
    process.exit(1);
  }
}
