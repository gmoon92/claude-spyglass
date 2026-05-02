/**
 * hook 모듈 — 요청 데이터 저장 (Upsert + 일반 INSERT + 서브에이전트 자식 INSERT)
 *
 * 책임:
 *  1. tool_call의 Pre/Post Upsert 패턴 처리:
 *     - PreToolUse → INSERT (event_type='pre_tool')
 *     - PostToolUse → 동일 tool_use_id의 pre_tool을 UPDATE (event_type='tool')
 *     - pre_tool 없으면 일반 INSERT
 *  2. prompt/response/system 등 그 외 타입은 단순 INSERT
 *  3. Agent tool 종료 후 서브 transcript에서 추출한 자식 tool_use 일괄 INSERT (Migration 017)
 *
 * 외부 노출 (collect/ 내부 사용 위주):
 *  - saveRequest(db, payload)                                      : 단일 요청 저장 (Upsert 분기 포함)
 *  - persistSubagentChildren(db, children, context)                : 서브에이전트 자식 일괄 저장
 *  - persistAssistantTextResponses(db, entries, context)            : v22 — 중간 assistant text 응답 저장
 *    (PostToolUse 시 transcript에서 추출, message_id 기반 idempotent INSERT OR IGNORE)
 *
 * 호출자:
 *  - handler.ts (processHookEvent): 모든 hook 이벤트의 저장 단계
 *  - raw-handler.ts (PostToolUse + Agent 분기): persistSubagentChildren
 *
 * 의존성:
 *  - @spyglass/storage: createRequest, Request 타입
 *  - turn.ts: assignTurnId, getLastTurnId
 *  - preview.ts: extractPreview, extractToolUseId
 *  - tool-detail.ts: extractToolDetail (서브 자식 저장 시)
 */

import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { createRequest } from '@spyglass/storage';
import type { Request as DbRequest } from '@spyglass/storage';
import type { NormalizedHookPayload, SubagentChildToolCall } from './types';
import type { AssistantTextEntry } from './transcript';
import { assignTurnId, getLastTurnId } from './turn';
import { extractPreview, extractToolUseId } from './preview';
import { extractToolDetail } from './tool-detail';

/**
 * tool_use_id 기준으로 pre_tool 레코드 조회.
 * 호출 시점: PostToolUse 처리 직전, Upsert 매칭 검사용.
 */
function findPreToolRecord(
  db: Database,
  sessionId: string,
  toolUseId: string,
): DbRequest | null {
  return db.query(
    "SELECT * FROM requests WHERE session_id = ? AND tool_use_id = ? AND event_type = 'pre_tool' LIMIT 1",
  ).get(sessionId, toolUseId) as DbRequest | null;
}

/**
 * pre_tool 레코드를 post_tool 데이터로 UPDATE (Upsert merge).
 *
 * - 토큰/소요 시간/payload/event_type을 'tool'로 갱신
 * - tool_name, tool_detail은 pre_tool에서 이미 저장된 값 유지 (PreToolUse 시점에 받은 값이 정답)
 * - model은 COALESCE: post에 없으면 pre 값 유지 (서브에이전트 케이스)
 *
 * @returns 행이 실제로 갱신됐는지 여부
 */
function mergePostToolIntoPreTool(
  db: Database,
  preToolId: string,
  payload: NormalizedHookPayload,
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (db as any).run(
    `UPDATE requests
     SET duration_ms = ?,
         tokens_input = ?,
         tokens_output = ?,
         tokens_total = ?,
         cache_creation_tokens = ?,
         cache_read_tokens = ?,
         model = COALESCE(?, model),
         payload = ?,
         event_type = 'tool'
     WHERE id = ?`,
    payload.duration_ms || 0,
    payload.tokens_input,
    payload.tokens_output,
    payload.tokens_total,
    payload.cache_creation_tokens ?? 0,
    payload.cache_read_tokens ?? 0,
    payload.model ?? null,
    payload.payload ?? null,
    preToolId,
  );
  return result.changes > 0;
}

/**
 * 요청 데이터 저장 — Upsert 분기 포함.
 *
 * 흐름:
 *  1. event_type='tool' + tool_use_id 존재 → pre_tool 매칭 검사
 *     - 매칭 OK → mergePostToolIntoPreTool (UPDATE)
 *     - 매칭 NG → fallthrough to 일반 INSERT
 *  2. 일반 INSERT:
 *     - prompt 타입은 새 turn_id 채번 (assignTurnId)
 *     - 그 외는 직전 prompt의 turn_id 재사용 (getLastTurnId)
 *
 * @returns
 *   saved      : INSERT 또는 UPDATE 성공 여부
 *   wasUpsert  : true=pre_tool을 덮어씀 → handler에서 세션 토큰 갱신 필요
 *   savedId    : Upsert 시 DB의 실제 id(pre-xxx) — SSE 브로드캐스트 일관성 위해 호출자가 사용
 */
export function saveRequest(
  db: Database,
  payload: NormalizedHookPayload,
): { saved: boolean; wasUpsert: boolean; savedId?: string } {
  try {
    const toolUseId = extractToolUseId(payload.payload);
    const isPostTool = payload.event_type === 'tool' && payload.request_type === 'tool_call';

    // PostToolUse: 기존 pre_tool 레코드 Upsert 시도
    if (isPostTool && toolUseId) {
      const preToolRecord = findPreToolRecord(db, payload.session_id, toolUseId);
      if (preToolRecord) {
        const merged = mergePostToolIntoPreTool(db, preToolRecord.id, payload);
        if (merged) {
          // savedId: DB의 실제 id(pre-xxx) — fetchRequests/SSE와 id 일치 보장
          return { saved: true, wasUpsert: true, savedId: preToolRecord.id };
        }
      }
    }

    // 일반 INSERT (pre_tool 또는 매칭 실패한 post_tool, 또는 prompt/system 등)
    let turnId: string | undefined;
    if (payload.request_type === 'prompt') {
      turnId = assignTurnId(db, payload.session_id);
    } else {
      turnId = getLastTurnId(db, payload.session_id) ?? undefined;
    }

    createRequest(db, {
      id: payload.id,
      session_id: payload.session_id,
      timestamp: payload.timestamp,
      type: payload.request_type,
      tool_name: payload.tool_name,
      tool_detail: payload.tool_detail,
      turn_id: turnId,
      model: payload.model,
      tokens_input: payload.tokens_input,
      tokens_output: payload.tokens_output,
      tokens_total: payload.tokens_total,
      duration_ms: payload.duration_ms || 0,
      payload: payload.payload,
      source: payload.source || null,
      cache_creation_tokens: payload.cache_creation_tokens ?? 0,
      cache_read_tokens: payload.cache_read_tokens ?? 0,
      preview: extractPreview(payload) ?? undefined,
      tool_use_id: toolUseId,
      event_type: payload.event_type || null,
      tokens_confidence: payload.tokens_confidence,
      tokens_source: payload.tokens_source,
      // v20: hook raw 페이로드 감사 메타
      permission_mode: payload.permission_mode ?? null,
      agent_id: payload.agent_id ?? null,
      agent_type: payload.agent_type ?? null,
      tool_interrupted: payload.tool_interrupted ?? null,
      tool_user_modified: payload.tool_user_modified ?? null,
    });
    return { saved: true, wasUpsert: false };
  } catch (error) {
    console.error('[Collect] Failed to save request:', error);
    return { saved: false, wasUpsert: false };
  }
}

/**
 * 서브에이전트 자식 도구 호출들을 requests에 일괄 INSERT (Migration 017).
 *
 * - turn_id는 부모 Agent와 동일 (메인 세션의 같은 turn에 묶임)
 * - parent_tool_use_id는 부모 Agent의 tool_use_id (UI에서 트리 표시 가능)
 * - source='subagent-transcript', event_type='tool'
 * - 중복 방지: 동일 tool_use_id가 이미 존재하면 skip (재실행 안전성)
 *
 * 호출 시점: raw-handler.ts의 PostToolUse + tool_name='Agent' 처리 끝 직후.
 *
 * @returns 실제로 INSERT된 행 수
 */
export function persistSubagentChildren(
  db: Database,
  children: SubagentChildToolCall[],
  context: { parentToolUseId: string; sessionId: string; turnId?: string },
): number {
  let inserted = 0;
  for (const child of children) {
    // 이미 동일 tool_use_id가 존재하면 skip (재실행 안전성)
    const exists = db.query(
      'SELECT 1 FROM requests WHERE tool_use_id = ? LIMIT 1',
    ).get(child.toolUseId) as { 1: number } | null;
    if (exists) continue;

    const tokensTotal = child.tokensInput + child.tokensOutput;
    const toolDetail = extractToolDetail(child.toolName, child.toolInput);
    const id = `sub-${child.timestampMs}-${randomUUID().slice(0, 8)}`;

    try {
      createRequest(db, {
        id,
        session_id: context.sessionId,
        timestamp: child.timestampMs,
        type: 'tool_call',
        tool_name: child.toolName,
        tool_detail: toolDetail ?? undefined,
        turn_id: context.turnId,
        model: child.model || undefined,
        tokens_input: child.tokensInput,
        tokens_output: child.tokensOutput,
        tokens_total: tokensTotal,
        duration_ms: 0,
        payload: JSON.stringify({ tool_input: child.toolInput, source: 'subagent-transcript' }),
        source: 'subagent-transcript',
        cache_creation_tokens: child.cacheCreationTokens,
        cache_read_tokens: child.cacheReadTokens,
        tool_use_id: child.toolUseId,
        event_type: 'tool',
        tokens_confidence: 'high',
        tokens_source: 'transcript',
        parent_tool_use_id: context.parentToolUseId,
      });
      inserted++;
    } catch (e) {
      console.error('[Collect] Failed to insert subagent child:', e);
    }
  }
  return inserted;
}

/**
 * v22 — transcript에서 추출한 assistant text 응답들을 requests에 응답 행으로 INSERT.
 *
 * 배경:
 *  - Stop 훅은 turn 종료 시 1회만 발생 + last_assistant_message는 마지막 1건만 보존
 *  - 한 turn 안의 도구 호출 사이사이 출력된 어시스턴트 텍스트는 완전히 누락되던 문제
 *
 * 동작:
 *  - extractAssistantTextEntries로 transcript의 모든 text 응답 entry 확보
 *  - 각 entry의 message_id를 idempotent 키로 사용 → id=`resp-msg-<message_id>`
 *  - INSERT OR IGNORE로 중복 시 silent skip → 매 PostToolUse마다 호출해도 중복 행 없음
 *  - turn_id는 호출자가 결정 (현재 PostToolUse 시점의 turn — getLastTurnId 결과)
 *
 * 호출 시점: PostToolUseHandler 매 호출. 비용은 transcript 크기에 비례하지만 PostToolUse가
 *  이미 transcript를 읽고 있어 추가 부담 미미.
 *
 * @returns 새로 INSERT된 응답 행 수
 */
export function persistAssistantTextResponses(
  db: Database,
  entries: AssistantTextEntry[],
  context: { sessionId: string; turnId?: string; projectName: string },
): number {
  if (entries.length === 0) return 0;

  // INSERT OR IGNORE — id가 PRIMARY KEY라 중복 시 silent skip
  // requests 테이블의 모든 컬럼을 채워야 하므로 raw SQL 사용 (createRequest는 일반 INSERT)
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO requests (
      id, session_id, timestamp, type, tool_name, tool_detail, turn_id, model,
      tokens_input, tokens_output, tokens_total, duration_ms, payload, source,
      cache_creation_tokens, cache_read_tokens, preview, tool_use_id, event_type,
      tokens_confidence, tokens_source, parent_tool_use_id, api_request_id,
      permission_mode, agent_id, agent_type, tool_interrupted, tool_user_modified
    ) VALUES (
      ?, ?, ?, 'response', NULL, NULL, ?, ?,
      ?, ?, ?, 0, ?, 'transcript-assistant-text',
      ?, ?, ?, NULL, 'assistant_response',
      'high', 'transcript', NULL, NULL,
      NULL, NULL, NULL, NULL, NULL
    )
  `);

  let inserted = 0;
  for (const entry of entries) {
    const id = `resp-msg-${entry.messageId}`;
    const previewText = entry.text.slice(0, 2000);
    const tokensTotal = entry.tokensInput + entry.tokensOutput;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (stmt as any).run(
        id,
        context.sessionId,
        entry.timestampMs,
        context.turnId ?? null,
        entry.model || null,
        entry.tokensInput,
        entry.tokensOutput,
        tokensTotal,
        JSON.stringify({ message_id: entry.messageId, text: entry.text, source: 'transcript' }),
        entry.cacheCreationTokens,
        entry.cacheReadTokens,
        previewText,
      );
      if (result.changes > 0) inserted++;
    } catch (e) {
      console.error('[Hook] Failed to insert assistant text response:', e);
    }
  }
  return inserted;
}
