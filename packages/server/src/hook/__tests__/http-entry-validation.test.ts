/**
 * T3 — /collect HTTP 진입점 검증 + 응답 shape 특성화 (현재 동작 고정).
 *
 * 검증 목적 (handleHookHttpRequest 의 게이트·응답 contract 특성화):
 *   - 비-POST 메서드 → 405.
 *   - JSON 파싱 실패 → 400 { success:false, error:'Invalid JSON payload' }.
 *   - hook_event_name 누락 → 400 { success:false, error:'Missing hook_event_name' } (조기 거부).
 *   - 정상 PreToolUse → 200, body 는 HookProcessResult { success, request_id, session_id, saved }.
 *   - session_id='' 빈 문자열 — 현재 동작: dispatcher → handler → processHookEvent 가
 *     필수 필드(session_id) 검증에서 거부하여 400 + saved:false.
 *
 *   주의: hook_event_name 게이트가 통과한 뒤의 거부는 processHookEvent 의 필수 필드 검증이
 *   담당한다. 본 테스트는 두 게이트(http-entry, processor)의 협력 결과를 end-to-end 로 고정한다.
 *
 * 격리: 고유 임시 DB + afterEach 본체/-wal/-shm 삭제 + closeDatabase().
 *       전역 SSE connections 는 건드리지 않는다(연결 미생성 — broadcast 는 0개 listener 로 no-op).
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { unlinkSync } from 'fs';
import { SpyglassDatabase, closeDatabase } from '@spyglass/storage';
import { handleHookHttpRequest } from '../http-entry';
import type { HookProcessResult } from '../types';

const TEST_DB_PATH = `/tmp/spyglass-http-entry-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`;

function postJson(body: unknown): Request {
  return new Request('http://localhost/collect', {
    method: 'POST',
    // CORS SSoT 전환(보안): 허용 origin(localhost) 을 명시해 echo 동작을 검증.
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

function postRaw(rawBody: string): Request {
  return new Request('http://localhost/collect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody,
  });
}

describe('T3 — /collect 진입점 검증 + 응답 shape', () => {
  let db: SpyglassDatabase;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try { unlinkSync(`${TEST_DB_PATH}${ext}`); } catch { /* ignore */ }
    }
  });

  it('비-POST(GET) → 405 Method not allowed', async () => {
    const req = new Request('http://localhost/collect', { method: 'GET' });
    const res = await handleHookHttpRequest(req, db);
    expect(res.status).toBe(405);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Method not allowed');
  });

  it('JSON 파싱 실패 → 400 { success:false, error:"Invalid JSON payload" }', async () => {
    const res = await handleHookHttpRequest(postRaw('{ not json'), db);
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('Invalid JSON payload');
  });

  it('hook_event_name 누락 → 400 { success:false, error:"Missing hook_event_name" } (조기 거부)', async () => {
    const res = await handleHookHttpRequest(
      postJson({ session_id: crypto.randomUUID(), tool_name: 'Bash' }),
      db,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('Missing hook_event_name');
  });

  it('정상 PreToolUse → 200 + HookProcessResult shape (success/request_id/session_id/saved)', async () => {
    const sessionId = crypto.randomUUID();
    const res = await handleHookHttpRequest(
      postJson({
        hook_event_name: 'PreToolUse',
        session_id: sessionId,
        cwd: '/tmp/proj-http-entry',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
        tool_use_id: 'tu-http-entry-1',
      }),
      db,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as HookProcessResult;
    expect(body.success).toBe(true);
    expect(body.saved).toBe(true);
    expect(body.session_id).toBe(sessionId);
    expect(typeof body.request_id).toBe('string');
    expect(body.request_id.startsWith('pre-')).toBe(true); // PreToolUseHandler prefix
    // CORS SSoT 전환: 와일드카드('*') 대신 허용 origin echo + Vary: Origin (jsonResponse contract)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it("session_id='' 빈 문자열 → 400 + saved:false (processHookEvent 필수 필드 거부)", async () => {
    // hook_event_name 게이트는 통과(존재)하지만, 그 뒤 processHookEvent 가 session_id 빈 값을
    // 필수 필드 검증에서 거부한다 — 현재 동작 고정.
    const res = await handleHookHttpRequest(
      postJson({
        hook_event_name: 'PreToolUse',
        session_id: '',
        cwd: '/tmp/proj-http-entry',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
        tool_use_id: 'tu-http-entry-empty',
      }),
      db,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as HookProcessResult;
    expect(body.success).toBe(false);
    expect(body.saved).toBe(false);
    expect(body.error).toContain('Missing required fields');
  });

  it('미등록 hook_event_name → fallback(SystemEventHandler) 가 200 으로 보존', async () => {
    // dispatcher 의 FALLBACK 경로 — 등록 안 된 이벤트도 system 으로 저장되어 200.
    const sessionId = crypto.randomUUID();
    const res = await handleHookHttpRequest(
      postJson({
        hook_event_name: 'SomeUnknownEvent',
        session_id: sessionId,
        cwd: '/tmp/proj-http-entry',
      }),
      db,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as HookProcessResult;
    expect(body.success).toBe(true);
    expect(body.session_id).toBe(sessionId);
  });
});
