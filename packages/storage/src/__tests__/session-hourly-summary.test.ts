/**
 * stats_session_hourly (Migration 072) + getSessionDailyStats + pruneSummaryTables 회귀 가드.
 *
 * 고정하는 것:
 *  - proxy_requests INSERT 트리거가 세션 × 시간 × 모델로 누적하고 session_id 없는 행은 무시한다
 *  - 원본(proxy_requests·sessions)이 지워져도 요약과 프로젝트 이름은 남는다(365일 보존의 이유)
 *  - tz 로 일자를 자른다(UTC 15:00 = KST 다음날 00:00)
 *  - 프로젝트 필터·표시에 별칭이 적용된다
 *  - cache_hit_rate = cache_read / (input + cache_read + cache_creation)
 *  - pruneSummaryTables 는 요약 보존 기간 밖 버킷만 지운다
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { getSessionDailyStats, isValidTimeZone } from '../queries/stats/session-daily';
import { pruneSummaryTables, deleteOldData } from '../queries/session/retention';

const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 23, 14, 30); // 2026-11-23 14:30 UTC = 23:30 KST

let db: Database;
let seq = 0;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  db.run("INSERT INTO sessions (id, project_name, started_at) VALUES ('s1', 'claude-hub', 0), ('s2', 'old-name', 0)");
});
afterEach(() => db.close());

function px(o: { session?: string | null; ts?: number; model?: string; ti?: number; to?: number; cc?: number; cr?: number; status?: number }) {
  db.run(
    `INSERT INTO proxy_requests (id, timestamp, method, path, status_code, model, tokens_input, tokens_output,
       cache_creation_tokens, cache_read_tokens, session_id)
     VALUES (?, ?, 'POST', '/v1/messages', ?, ?, ?, ?, ?, ?, ?)`,
    [`p${++seq}`, o.ts ?? T0, o.status ?? 200, o.model ?? 'claude-opus-5-5', o.ti ?? 10, o.to ?? 5, o.cc ?? 0, o.cr ?? 0,
      o.session === undefined ? 's1' : o.session],
  );
}
const hourly = () => db.query('SELECT * FROM stats_session_hourly ORDER BY hour_ts, session_id, model').all() as Array<Record<string, unknown>>;

describe('Migration 072 트리거', () => {
  test('세션 × 시간 × 모델로 누적하고, session_id 없는 행은 무시한다', () => {
    px({}); px({ ti: 20, status: 500 }); px({ model: 'claude-haiku-5-5' }); px({ session: null });
    const rows = hourly();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.model === 'claude-opus-5-5')).toMatchObject({
      session_id: 's1', project_name: 'claude-hub', request_count: 2, error_count: 1, tokens_input: 30, tokens_output: 10,
    });
  });

  test('원본과 세션이 지워져도 요약과 프로젝트 이름은 남는다', () => {
    px({ session: 's2' });
    db.run('DELETE FROM proxy_requests');
    db.run("DELETE FROM sessions WHERE id = 's2'");
    const [row] = getSessionDailyStats(db, { tz: 'UTC' });
    expect(row).toMatchObject({ session_id: 's2', project_name: 'old-name', requests: 1 });
  });
});

describe('getSessionDailyStats', () => {
  test('tz 로 일자를 자른다 — UTC 14시·15시 버킷은 KST 로 서로 다른 날', () => {
    px({ ts: T0 });          // 14:30 UTC → KST 11-23
    px({ ts: T0 + H });      // 15:30 UTC → KST 11-24
    expect(getSessionDailyStats(db, { tz: 'Asia/Seoul' }).map((r) => r.date)).toEqual(['2026-11-24', '2026-11-23']);
    expect(getSessionDailyStats(db, { tz: 'UTC' }).map((r) => r.date)).toEqual(['2026-11-23']);
  });

  test('모델별 내역을 접고 cache_hit_rate 를 계산한다', () => {
    px({ ti: 10, cc: 30, cr: 60 });
    px({ model: 'claude-haiku-5-5', ti: 0, cc: 0, cr: 0, to: 1 });
    const [row] = getSessionDailyStats(db, { tz: 'UTC' });
    expect(row.models.map((m) => m.model).sort()).toEqual(['claude-haiku-5-5', 'claude-opus-5-5']);
    expect(row.cache_hit_rate).toBe(0.6);
    expect(row.tokens_total).toBe(10 + 5 + 30 + 60 + 1);
  });

  test('프로젝트 필터와 표시에 별칭을 적용한다', () => {
    px({ session: 's1' }); px({ session: 's2' });
    db.run("INSERT INTO project_aliases (alias, project_name) VALUES ('old-name', 'claude-hub')");
    const rows = getSessionDailyStats(db, { tz: 'UTC', project: 'claude-hub' });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.project_name === 'claude-hub')).toBe(true);
    expect(getSessionDailyStats(db, { tz: 'UTC', project: 'nope' })).toHaveLength(0);
  });

  test('from·to·session_id 로 거른다', () => {
    px({ ts: T0 }); px({ ts: T0 + 5 * H }); px({ ts: T0, session: 's2' });
    expect(getSessionDailyStats(db, { from: T0 + 2 * H, tz: 'UTC' })).toHaveLength(1);
    expect(getSessionDailyStats(db, { to: T0 + 1000, tz: 'UTC' }).map((r) => r.session_id).sort()).toEqual(['s1', 's2']);
    expect(getSessionDailyStats(db, { sessionId: 's2', tz: 'UTC' })).toHaveLength(1);
  });

  test('isValidTimeZone', () => {
    expect(isValidTimeZone('Asia/Seoul')).toBe(true);
    expect(isValidTimeZone('Mars/Base')).toBe(false);
  });
});

describe('pruneSummaryTables', () => {
  test('요약 보존 기간 밖 버킷만 지우고, 원본 retention(deleteOldData)에는 지워지지 않는다', () => {
    const now = Date.UTC(2026, 10, 24);
    px({ ts: now - 400 * 24 * H }); // 400일 전
    px({ ts: now - 40 * 24 * H });  // 40일 전 — 원본 보존(30일) 밖이지만 요약 보존(365일) 안
    deleteOldData(db, now - 30 * 24 * H);
    expect(db.query('SELECT COUNT(*) AS n FROM proxy_requests').get()).toEqual({ n: 0 });
    // deleteOldData 는 Date.now() 기준으로 요약을 자르므로, 고정 시각으로 다시 확인한다.
    const removed = pruneSummaryTables(db, now, 365);
    expect(removed.stats_session_hourly).toBe(0); // 400일 전 버킷은 이미 Date.now() 기준 prune 에서 빠졌다
    expect(hourly()).toHaveLength(1);
    expect(pruneSummaryTables(db, now, 30).stats_session_hourly).toBe(1);
    expect(hourly()).toHaveLength(0);
  });
});
