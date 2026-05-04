/**
 * Turn 무결성 체크 — ADR-001 P1.
 *
 * 변경 이유: 무결성 임계값 정책·집계 쿼리 변경 시 묶여서 손이 가는 묶음.
 *
 * 5개 체크:
 *   1. orphan_rows           : turn_id가 NULL인 tool_call/response 수
 *   2. zero_response_turns   : prompt 있지만 response 0개인 turn 수 (전체)
 *   3. long_proxy_responses  : response_time_ms > 120000ms인 proxy 호출 수 (잔여 누락 위험)
 *   4. duplicate_responses   : 같은 session에서 preview 동일 + timestamp 1초 이내인
 *                              response 행 쌍 수 (P1-A 수정 후 0이어야 정상)
 *   5. mismatched_turn_ids   : tool_call/response의 turn_id가 timestamp 기준으로 매핑한
 *                              turn_id와 일치하지 않는 행 수 (잘못 태깅된 행)
 *
 * 임계 정책:
 *   - 0건이면 ok
 *   - duplicate_responses, mismatched_turn_ids > 0 → fail (코드가 막아야 하는 회귀)
 *   - 그 외 > 0 → warn (이미 알려진 비결정적 케이스)
 */

import { existsSync } from 'fs';
import { getDatabase, getDefaultDbPath, closeDatabase } from '@spyglass/storage';
import type { CheckResult } from '../output';

interface IntegrityCounts {
  orphan_rows: number;
  zero_response_turns: number;
  long_proxy_responses: number;
  duplicate_responses: number;
  mismatched_turn_ids: number;
}

function withDb<T>(fn: (db: ReturnType<typeof getDatabase>['instance']) => T, fallback: T): T {
  if (!existsSync(getDefaultDbPath())) return fallback;
  try {
    const db = getDatabase();
    const out = fn(db.instance);
    closeDatabase();
    return out;
  } catch {
    try { closeDatabase(); } catch { /* ignore */ }
    return fallback;
  }
}

export function checkOrphanRows(): CheckResult {
  const count = withDb<number>((db) => {
    const row = db.prepare(
      `SELECT COUNT(*) as c FROM requests WHERE turn_id IS NULL`,
    ).get() as { c: number } | undefined;
    return row?.c ?? 0;
  }, -1);

  if (count < 0) {
    return { status: 'warn', message: 'orphan 행 확인 불가 (DB 없음 또는 오류)' };
  }
  if (count === 0) {
    return { status: 'ok', message: 'orphan 행 (turn_id NULL) 0건' };
  }
  return {
    status: 'warn',
    message: `orphan 행 ${count}건 — turn에 묶이지 않는 tool_call/response`,
    hint: 'session resume 또는 hook 누락. UI는 "세션 프롤로그" 섹션으로 노출 (ADR-001 P1)',
  };
}

export function checkZeroResponseTurns(): CheckResult {
  const count = withDb<number>((db) => {
    const row = db.prepare(`
      SELECT COUNT(*) as c FROM (
        SELECT p.turn_id
        FROM requests p
        LEFT JOIN requests r ON r.turn_id = p.turn_id AND r.type = 'response'
        WHERE p.type = 'prompt' AND p.turn_id IS NOT NULL
        GROUP BY p.turn_id
        HAVING COUNT(r.id) = 0
      )
    `).get() as { c: number } | undefined;
    return row?.c ?? 0;
  }, -1);

  if (count < 0) return { status: 'warn', message: 'response 0개 turn 확인 불가' };
  if (count === 0) return { status: 'ok', message: 'response 0개 turn 0건' };
  return {
    status: 'warn',
    message: `response 0개 turn ${count}건`,
    hint: 'tool-only turn(정상) 또는 Stop/proxy fallback 모두 누락(이상). 개별 확인 필요',
  };
}

export function checkLongProxyResponses(): CheckResult {
  const count = withDb<number>((db) => {
    const row = db.prepare(
      `SELECT COUNT(*) as c FROM proxy_requests WHERE response_time_ms > 120000`,
    ).get() as { c: number } | undefined;
    return row?.c ?? 0;
  }, -1);

  if (count < 0) return { status: 'warn', message: '120s 초과 proxy 응답 확인 불가' };
  if (count === 0) return { status: 'ok', message: '120s 초과 proxy 응답 0건' };
  return {
    status: 'warn',
    message: `120s 초과 proxy 응답 ${count}건 — fallback 윈도우 초과 잔여 위험`,
    hint: 'ADR-001 P1: api_request_id 정확 매칭 도입 시 해소. 현재는 모니터링만',
  };
}

export function checkDuplicateResponses(): CheckResult {
  const count = withDb<number>((db) => {
    // 같은 session, preview 동일, timestamp 1초 이내 차이의 response 행 쌍.
    // P1-A 수정(`resp-msg-${msgid}` ID 통일 + 백필 우선)이 적용된 이후 0이어야 정상.
    const row = db.prepare(`
      SELECT COUNT(*) as c FROM (
        SELECT a.id
        FROM requests a
        JOIN requests b
          ON a.session_id = b.session_id
         AND a.type = 'response' AND b.type = 'response'
         AND a.id < b.id
         AND a.preview = b.preview
         AND a.preview IS NOT NULL
         AND ABS(a.timestamp - b.timestamp) <= 1000
      )
    `).get() as { c: number } | undefined;
    return row?.c ?? 0;
  }, -1);

  if (count < 0) return { status: 'warn', message: '중복 response 확인 불가' };
  if (count === 0) return { status: 'ok', message: '중복 response 0건' };
  return {
    status: 'fail',
    message: `중복 response ${count}쌍 — 같은 메시지가 두 행으로 저장됨`,
    hint: 'ADR-001 P1-A 수정 후엔 0이어야 한다. 코드 회귀 가능성 — 변경 이력 확인',
  };
}

export function checkMismatchedTurnIds(): CheckResult {
  const count = withDb<number>((db) => {
    // tool_call/response 각 행의 turn_id가, 같은 세션에서 자기 timestamp 이전의 가장 최근 prompt
    // turn_id와 일치하지 않으면 잘못 태깅된 것. (NULL turn_id는 orphan 체크에서 별도 카운트.)
    const row = db.prepare(`
      WITH non_prompt AS (
        SELECT id, session_id, timestamp, turn_id
        FROM requests
        WHERE type IN ('tool_call', 'response')
          AND turn_id IS NOT NULL
      )
      SELECT COUNT(*) as c
      FROM non_prompt np
      WHERE np.turn_id != COALESCE((
        SELECT p.turn_id FROM requests p
        WHERE p.session_id = np.session_id
          AND p.type = 'prompt'
          AND p.turn_id IS NOT NULL
          AND p.timestamp <= np.timestamp
        ORDER BY p.timestamp DESC LIMIT 1
      ), np.turn_id)
    `).get() as { c: number } | undefined;
    return row?.c ?? 0;
  }, -1);

  if (count < 0) return { status: 'warn', message: 'mismatched turn_id 확인 불가' };
  if (count === 0) return { status: 'ok', message: 'mismatched turn_id 0건' };
  return {
    status: 'fail',
    message: `mismatched turn_id ${count}건 — timestamp 기준 잘못 태깅된 행`,
    hint: 'ADR-001 P1-A의 getTurnIdAt 적용 후 0이어야 한다. 회귀 가능성',
  };
}

/**
 * ADR-001 P1-E (v23): proxy_tool_uses 등장 이후로 PostToolUse 행의 api_request_id가
 * 정확 매칭으로 채워져야 한다. 최근 1시간 내 tool_call 중 NULL 비율 추적.
 * 절대 0건은 보장 못 함 (proxy 우회 도구 호출 등).
 */
export function checkUnlinkedToolCalls(): CheckResult {
  const stats = withDb<{ total: number; unlinked: number } | null>((db) => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const row = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN api_request_id IS NULL THEN 1 ELSE 0 END) as unlinked
      FROM requests
      WHERE type = 'tool_call'
        AND event_type = 'tool'
        AND timestamp > ?
        AND (source IS NULL OR source != 'subagent-transcript')
    `).get(oneHourAgo) as { total: number; unlinked: number } | undefined;
    return row ? { total: row.total ?? 0, unlinked: row.unlinked ?? 0 } : null;
  }, null);

  if (!stats) return { status: 'warn', message: 'tool_call api_request_id 매칭 확인 불가' };
  if (stats.total === 0) return { status: 'ok', message: '최근 1시간 내 tool_call 없음 (체크 skip)' };
  const pct = Math.round(100 * stats.unlinked / stats.total);
  if (stats.unlinked === 0) {
    return { status: 'ok', message: `tool_call api_request_id 매칭 100% (${stats.total}건)` };
  }
  if (pct < 10) {
    return {
      status: 'ok',
      message: `tool_call api_request_id 미매칭 ${stats.unlinked}/${stats.total} (${pct}%)`,
    };
  }
  return {
    status: 'warn',
    message: `tool_call api_request_id 미매칭 ${stats.unlinked}/${stats.total} (${pct}%)`,
    hint: 'proxy SSE의 tool_use 캡처 누락 또는 hook 도착 순서 역전 의심 (ADR-001 P1-E)',
  };
}

/**
 * proxy_tool_uses orphan: 참조하는 hook tool_call이 없는 행 카운트.
 * 사용자가 도구 실행을 거부/취소했거나 hook 미도착인 케이스 — 정보성.
 */
export function checkOrphanProxyToolUses(): CheckResult {
  const count = withDb<number>((db) => {
    const row = db.prepare(`
      SELECT COUNT(*) as c
      FROM proxy_tool_uses ptu
      LEFT JOIN requests r ON r.tool_use_id = ptu.tool_use_id AND r.event_type = 'tool'
      WHERE r.id IS NULL
    `).get() as { c: number } | undefined;
    return row?.c ?? 0;
  }, -1);
  if (count < 0) return { status: 'warn', message: 'proxy_tool_uses orphan 확인 불가' };
  if (count === 0) return { status: 'ok', message: 'proxy_tool_uses orphan 0건' };
  return {
    status: 'ok',
    message: `proxy_tool_uses orphan ${count}건 (보통 사용자 취소된 tool_use)`,
  };
}

export function getIntegrityCounts(): IntegrityCounts | null {
  return withDb<IntegrityCounts | null>((db) => {
    const orphan = (db.prepare(`SELECT COUNT(*) as c FROM requests WHERE turn_id IS NULL`)
      .get() as { c: number } | undefined)?.c ?? 0;
    const zero = (db.prepare(`
      SELECT COUNT(*) as c FROM (
        SELECT p.turn_id FROM requests p
        LEFT JOIN requests r ON r.turn_id = p.turn_id AND r.type = 'response'
        WHERE p.type = 'prompt' AND p.turn_id IS NOT NULL
        GROUP BY p.turn_id HAVING COUNT(r.id) = 0
      )
    `).get() as { c: number } | undefined)?.c ?? 0;
    const long = (db.prepare(`SELECT COUNT(*) as c FROM proxy_requests WHERE response_time_ms > 120000`)
      .get() as { c: number } | undefined)?.c ?? 0;
    return {
      orphan_rows: orphan,
      zero_response_turns: zero,
      long_proxy_responses: long,
      duplicate_responses: 0,
      mismatched_turn_ids: 0,
    };
  }, null);
}
