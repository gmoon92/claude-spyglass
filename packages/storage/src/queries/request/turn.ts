/**
 * Request Turn 집계 — 세션별 turn 단위 데이터 조립.
 *
 * @description
 *   srp-redesign Phase 1A: storage/queries/request.ts(1165줄)를 변경 이유별로 분해한 결과.
 *   이 파일의 변경 이유: "Turn 인터리빙·집계 정책 변경"
 *   (turn_id 기반 prompt + tool_calls + responses 조합 방식, 캐시 합산, system_hash cross-link 등).
 *
 *   같은 모듈로 응집해야 할 동기:
 *   - TurnToolCall / TurnResponse / TurnItem 인터페이스가 getTurnsBySession 출력 contract
 *   - 4단계 쿼리(turnSummaries + promptRows + toolRows + responseRows + systemRows)가
 *     동일 규칙으로 조합되어야 일관성 보장
 *
 *   read.ts와 분리한 이유:
 *   - 단순 read는 SELECT 결과를 그대로 반환하지만, turn은 4쿼리 합성 + 캐시 누적 + 인터리빙 등
 *     도메인 변환 로직이 무거움 → 변경 이유가 read 정책과 명백히 다름
 *
 *   ACTIVE_REQUEST_FILTER_SQL은 read.ts에서 정의된 정책을 그대로 사용 (단일 SSoT).
 *
 * 외부 시그니처(`@spyglass/storage` barrel)는 그대로 유지 — 이 파일을 통해 re-export.
 */

import type { Database } from 'bun:sqlite';
import type { Request } from '../../schema';
import { ACTIVE_REQUEST_FILTER_SQL } from './read';

// =============================================================================
// 턴 집계 (Turn View)
// =============================================================================

/** 턴 내 tool_call 항목 */
export interface TurnToolCall {
  id: string;
  type: 'tool_call';
  timestamp: number;
  tool_name: string | null;
  tool_detail: string | null;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  duration_ms: number;
  payload: string | null;
  event_type: string | null;
  model: string | null;
  /** data-honesty-ui: 자식 도구 호출 추적 (sub-agent transcript) */
  parent_tool_use_id: string | null;
  /** data-honesty-ui: 'high'|'low'|'error' (UI에서 신뢰도 표지에 사용) */
  tokens_confidence: string | null;
}

/**
 * 턴 내 assistant 응답.
 * v22 이후 한 turn 안에 여러 건 존재 가능 (도구 호출 사이사이의 중간 텍스트 응답).
 * - source='claude-code-hook'  : Stop 훅의 last_assistant_message (턴 종료 시 1건)
 * - source='transcript-assistant-text' : transcript에서 추출한 중간 응답 (PostToolUse마다 보강)
 */
export interface TurnResponse {
  id: string;
  timestamp: number;
  preview: string | null;
  payload: string | null;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  model: string | null;
  /** data-honesty-ui: 응답 메타 신뢰도 ('high'|'low'|'error') */
  tokens_confidence: string | null;
}

/** 턴 항목 */
export interface TurnItem {
  turn_id: string;
  turn_index: number;
  started_at: number;
  prompt: {
    id: string;
    timestamp: number;
    tokens_input: number;
    tokens_output: number;
    tokens_total: number;
    duration_ms: number;
    model: string | null;
    payload: string | null;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    context_tokens: number;
    /** data-honesty-ui: prompt 메타 신뢰도 ('high'|'low'|'error') */
    tokens_confidence: string | null;
  } | null;
  /**
   * v22 (system-prompt-exposure) — 이 turn에 흐른 첫 proxy 요청의 system_hash.
   * 같은 turn에 여러 LLM 호출이 있어도 페르소나는 보통 동일하므로 첫 hash로 대표.
   * UI는 이전 turn과 비교해 system 변경 표지(▲)를 그릴 때 사용.
   */
  system_hash: string | null;
  system_byte_size: number | null;
  tool_calls: TurnToolCall[];
  /**
   * 턴 내 모든 assistant 응답 (timestamp 오름차순).
   * 빈 배열이면 tool-only turn. v22 이전엔 단수 `response`였으나 중간 응답 보존을 위해 배열로 확장.
   */
  responses: TurnResponse[];
  summary: {
    tool_call_count: number;
    tokens_input: number;
    tokens_output: number;
    total_tokens: number;
    duration_ms: number;
  };
}

/**
 * 세션별 턴 목록 조회
 * - turn_id 기준으로 prompt + tool_calls 그룹화
 * - turn_index: 세션 내 순번 (1부터)
 * 개선: SQL에서 turn/prompt/tool_call 분리 조회로 메모리 효율 개선
 */
export function getTurnsBySession(
  db: Database,
  sessionId: string
): TurnItem[] {
  // 1. 턴 단위 집계: 턴당 첫 타임스탐프, 토큰합, tool_call 수
  const turnSummaries = db.query(`
    SELECT turn_id,
           MIN(timestamp) as started_at,
           SUM(CASE WHEN type = 'prompt' THEN tokens_input ELSE 0 END) as prompt_tokens_input,
           SUM(CASE WHEN type = 'prompt' THEN tokens_output ELSE 0 END) as prompt_tokens_output,
           SUM(tokens_total) as total_tokens,
           COUNT(CASE WHEN type = 'tool_call' THEN 1 END) as tool_call_count
    FROM requests
    WHERE session_id = ? AND turn_id IS NOT NULL
      AND ${ACTIVE_REQUEST_FILTER_SQL}
    GROUP BY turn_id
    ORDER BY started_at ASC
  `).all(sessionId) as Array<{
    turn_id: string;
    started_at: number;
    prompt_tokens_input: number;
    prompt_tokens_output: number;
    total_tokens: number;
    tool_call_count: number;
  }>;

  // 2. 각 턴의 prompt 행 조회
  const promptRows = db.query(`
    SELECT turn_id, id, timestamp, tokens_input, tokens_output, tokens_total, duration_ms,
           model, payload, cache_read_tokens, cache_creation_tokens, tokens_confidence
    FROM requests
    WHERE session_id = ? AND turn_id IS NOT NULL AND type = 'prompt'
      AND ${ACTIVE_REQUEST_FILTER_SQL}
    ORDER BY timestamp ASC
  `).all(sessionId) as Array<{
    turn_id: string;
    id: string;
    timestamp: number;
    tokens_input: number;
    tokens_output: number;
    tokens_total: number;
    duration_ms: number;
    model: string | null;
    payload: string | null;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    tokens_confidence: string | null;
  }>;

  // 3. 각 턴의 tool_call 행 조회
  const toolRows = db.query(`
    SELECT turn_id, id, timestamp, tool_name, tool_detail,
           tokens_input, tokens_output, tokens_total, duration_ms,
           payload, event_type, model, parent_tool_use_id, tokens_confidence
    FROM requests
    WHERE session_id = ? AND turn_id IS NOT NULL AND type = 'tool_call'
      AND ${ACTIVE_REQUEST_FILTER_SQL}
    ORDER BY turn_id, timestamp ASC
  `).all(sessionId) as Array<{
    turn_id: string;
    id: string;
    timestamp: number;
    tool_name: string | null;
    tool_detail: string | null;
    tokens_input: number;
    tokens_output: number;
    tokens_total: number;
    duration_ms: number;
    payload: string | null;
    event_type: string | null;
    model: string | null;
    parent_tool_use_id: string | null;
    tokens_confidence: string | null;
  }>;

  // 3-bis. 각 턴의 assistant response 행 조회.
  // v22+: 한 턴에 여러 건 존재 가능 (도구 호출 사이사이 중간 텍스트 응답).
  // 모든 행을 timestamp 오름차순으로 수집해 호출자에게 배열로 반환.
  const responseRows = db.query(`
    SELECT turn_id, id, timestamp, preview, payload,
           tokens_input, tokens_output, tokens_total, model, tokens_confidence
    FROM requests
    WHERE session_id = ? AND turn_id IS NOT NULL AND type = 'response'
    ORDER BY turn_id, timestamp ASC
  `).all(sessionId) as Array<{
    turn_id: string;
    id: string;
    timestamp: number;
    preview: string | null;
    payload: string | null;
    tokens_input: number;
    tokens_output: number;
    tokens_total: number;
    model: string | null;
    tokens_confidence: string | null;
  }>;

  // 4. 데이터 구성
  const promptMap = new Map(promptRows.map(p => [p.turn_id, p]));
  const toolCallsByTurn = new Map<string, typeof toolRows>();
  for (const tool of toolRows) {
    if (!toolCallsByTurn.has(tool.turn_id)) {
      toolCallsByTurn.set(tool.turn_id, []);
    }
    toolCallsByTurn.get(tool.turn_id)!.push(tool);
  }
  // 같은 turn_id의 응답을 모두 보존 (timestamp 오름차순 push).
  // 단순 set→get 매핑이면 중간 응답이 마지막 1건에 덮어쓰기되어 누락된다.
  const responsesByTurn = new Map<string, typeof responseRows>();
  for (const r of responseRows) {
    const arr = responsesByTurn.get(r.turn_id);
    if (arr) arr.push(r);
    else responsesByTurn.set(r.turn_id, [r]);
  }

  // v22 (system-prompt-exposure): turn별 system_hash + system_byte_size 합류.
  // 같은 turn_id에 여러 proxy 요청이 있을 수 있어 timestamp ASC 첫 hash를 대표로 채택
  // (페르소나는 보통 turn 전체에서 동일). ROW_NUMBER OVER로 PARTITION 1행만 선택.
  const systemRows = db.query(`
    SELECT turn_id, system_hash, system_byte_size FROM (
      SELECT turn_id, system_hash, system_byte_size,
             ROW_NUMBER() OVER (PARTITION BY turn_id ORDER BY timestamp ASC) AS rn
      FROM proxy_requests
      WHERE session_id = ? AND turn_id IS NOT NULL AND system_hash IS NOT NULL
    ) WHERE rn = 1
  `).all(sessionId) as Array<{
    turn_id: string;
    system_hash: string;
    system_byte_size: number | null;
  }>;
  const systemByTurn = new Map(systemRows.map(s => [s.turn_id, s]));

  const turns: TurnItem[] = turnSummaries.map((summary, idx) => {
    const prompt = promptMap.get(summary.turn_id);
    const toolCalls = toolCallsByTurn.get(summary.turn_id) || [];
    const respRows = responsesByTurn.get(summary.turn_id) || [];
    const sysRow = systemByTurn.get(summary.turn_id) ?? null;

    // prompt 캐시 정보 계산
    let promptCacheRead = 0;
    let promptCacheCreate = 0;
    if (prompt) {
      promptCacheRead = prompt.cache_read_tokens || 0;
      promptCacheCreate = prompt.cache_creation_tokens || 0;
    }

    // 턴 duration 계산
    let duration_ms = 0;
    if (toolCalls.length > 0) {
      const first = summary.started_at;
      const last = toolCalls[toolCalls.length - 1];
      duration_ms = last.timestamp + last.duration_ms - first;
    }

    // context_tokens: prompt 실제 입력+캐시. 0이면 0 그대로 노출 (왜곡 fallback 제거 — data-honesty-ui)
    const contextTokens = (prompt?.tokens_input || 0) + promptCacheRead + promptCacheCreate;

    return {
      turn_id: summary.turn_id,
      turn_index: idx + 1,
      started_at: summary.started_at,
      prompt: prompt ? {
        id: prompt.id,
        timestamp: prompt.timestamp,
        tokens_input: prompt.tokens_input,
        tokens_output: prompt.tokens_output,
        tokens_total: prompt.tokens_total,
        duration_ms: prompt.duration_ms,
        model: prompt.model,
        payload: prompt.payload,
        cache_read_tokens: promptCacheRead,
        cache_creation_tokens: promptCacheCreate,
        context_tokens: contextTokens,
        tokens_confidence: prompt.tokens_confidence,
      } : null,
      tool_calls: toolCalls.map(t => ({
        id: t.id,
        type: 'tool_call' as const,
        timestamp: t.timestamp,
        tool_name: t.tool_name,
        tool_detail: t.tool_detail,
        tokens_input: t.tokens_input,
        tokens_output: t.tokens_output,
        tokens_total: t.tokens_total,
        duration_ms: t.duration_ms,
        payload: t.payload,
        event_type: t.event_type,
        model: t.model,
        parent_tool_use_id: t.parent_tool_use_id,
        tokens_confidence: t.tokens_confidence,
      })),
      responses: respRows.map(r => ({
        id: r.id,
        timestamp: r.timestamp,
        preview: r.preview,
        payload: r.payload,
        tokens_input: r.tokens_input,
        tokens_output: r.tokens_output,
        tokens_total: r.tokens_total,
        model: r.model,
        tokens_confidence: r.tokens_confidence,
      })),
      system_hash: sysRow?.system_hash ?? null,
      system_byte_size: sysRow?.system_byte_size ?? null,
      summary: {
        tool_call_count: summary.tool_call_count,
        tokens_input: summary.prompt_tokens_input,
        tokens_output: summary.prompt_tokens_output,
        total_tokens: summary.total_tokens,
        duration_ms,
      },
    };
  });

  return turns.reverse();
}

// =============================================================================
// orphan(NULL turn_id) 행 조회 — ADR-001 P1 (session-prologue)
// =============================================================================

/**
 * 같은 세션에서 turn_id가 NULL인 행을 timestamp 오름차순으로 반환.
 *
 * "session-prologue" 데이터: prompt가 등록되기 전에 hook이 도달한 tool_call/response.
 * 세션 resume/compact 같은 케이스에서 발생할 수 있으며, 어느 turn에도 묶이지 않아
 * UI에서 누락된다. 이 쿼리는 turn-view 상단 "프롤로그" 섹션 노출용.
 *
 * 정책: ACTIVE_REQUEST_FILTER_SQL을 적용해 일반 turn 쿼리와 노출 정책을 통일.
 *
 * @returns 빈 배열이면 프롤로그 없음 — 호출자가 UI 섹션을 그리지 않음.
 */
export function getOrphanRowsBySession(db: Database, sessionId: string): Request[] {
  return db.query(`
    SELECT id, session_id, timestamp, type, tool_name, tool_detail, turn_id, model,
           tokens_input, tokens_output, tokens_total, duration_ms, payload, source,
           cache_creation_tokens, cache_read_tokens, preview, tool_use_id, event_type,
           tokens_confidence, tokens_source, parent_tool_use_id, api_request_id,
           permission_mode, agent_id, agent_type, tool_interrupted, tool_user_modified,
           created_at
    FROM requests
    WHERE session_id = ? AND turn_id IS NULL
      AND ${ACTIVE_REQUEST_FILTER_SQL}
    ORDER BY timestamp ASC
  `).all(sessionId) as Request[];
}
