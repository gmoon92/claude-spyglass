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
import { t } from '../../i18n';

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
    return { status: 'warn', message: t('checks.integrity.orphan.unavailable') };
  }
  if (count === 0) {
    return { status: 'ok', message: t('checks.integrity.orphan.ok') };
  }
  return {
    status: 'warn',
    message: t('checks.integrity.orphan.warn', { count }),
    hint: t('checks.integrity.orphan.hint'),
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

  if (count < 0) return { status: 'warn', message: t('checks.integrity.zero-response-turns.unavailable') };
  if (count === 0) return { status: 'ok', message: t('checks.integrity.zero-response-turns.ok') };
  return {
    status: 'warn',
    message: t('checks.integrity.zero-response-turns.warn', { count }),
    hint: t('checks.integrity.zero-response-turns.hint'),
  };
}

export function checkLongProxyResponses(): CheckResult {
  const count = withDb<number>((db) => {
    const row = db.prepare(
      `SELECT COUNT(*) as c FROM proxy_requests WHERE response_time_ms > 120000`,
    ).get() as { c: number } | undefined;
    return row?.c ?? 0;
  }, -1);

  if (count < 0) return { status: 'warn', message: t('checks.integrity.long-proxy-responses.unavailable') };
  if (count === 0) return { status: 'ok', message: t('checks.integrity.long-proxy-responses.ok') };
  return {
    status: 'warn',
    message: t('checks.integrity.long-proxy-responses.warn', { count }),
    hint: t('checks.integrity.long-proxy-responses.hint'),
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

  if (count < 0) return { status: 'warn', message: t('checks.integrity.duplicate-responses.unavailable') };
  if (count === 0) return { status: 'ok', message: t('checks.integrity.duplicate-responses.ok') };
  return {
    status: 'fail',
    message: t('checks.integrity.duplicate-responses.fail', { count }),
    hint: t('checks.integrity.duplicate-responses.hint'),
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

  if (count < 0) return { status: 'warn', message: t('checks.integrity.mismatched-turn-ids.unavailable') };
  if (count === 0) return { status: 'ok', message: t('checks.integrity.mismatched-turn-ids.ok') };
  return {
    status: 'fail',
    message: t('checks.integrity.mismatched-turn-ids.fail', { count }),
    hint: t('checks.integrity.mismatched-turn-ids.hint'),
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

  if (!stats) return { status: 'warn', message: t('checks.integrity.unlinked-tool-calls.unavailable') };
  if (stats.total === 0) return { status: 'ok', message: t('checks.integrity.unlinked-tool-calls.no-recent') };
  // 표본 < 5건이면 통계적으로 무의미 — 단일 미매칭이 100%로 보고되는 false alarm 방지.
  if (stats.total < 5) {
    return {
      status: 'ok',
      message: t('checks.integrity.unlinked-tool-calls.ok-sample', { total: stats.total }),
    };
  }
  const pct = Math.round(100 * stats.unlinked / stats.total);
  if (stats.unlinked === 0) {
    return { status: 'ok', message: t('checks.integrity.unlinked-tool-calls.ok', { total: stats.total }) };
  }
  if (pct < 10) {
    return {
      status: 'ok',
      message: t('checks.integrity.unlinked-tool-calls.ok-partial', { unlinked: stats.unlinked, total: stats.total, pct }),
    };
  }
  return {
    status: 'warn',
    message: t('checks.integrity.unlinked-tool-calls.warn', { unlinked: stats.unlinked, total: stats.total, pct }),
    hint: t('checks.integrity.unlinked-tool-calls.hint'),
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
  if (count < 0) return { status: 'warn', message: t('checks.integrity.orphan-proxy-tool-uses.unavailable') };
  if (count === 0) return { status: 'ok', message: t('checks.integrity.orphan-proxy-tool-uses.ok') };
  return {
    status: 'ok',
    message: t('checks.integrity.orphan-proxy-tool-uses.ok-with-count', { count }),
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
