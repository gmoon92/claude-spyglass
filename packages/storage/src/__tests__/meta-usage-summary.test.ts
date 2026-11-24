/**
 * stats_meta_usage_hourly (Migration 073) + meta-usage 쿼리 회귀 가드.
 *
 * 고정하는 것:
 *  - calls: 확정된 Skill/Agent 행만(pre_tool 은 안 세고, pre_tool → tool UPDATE 순간 센다). 슬래시 명령도 센다
 *  - failures: recordMetaUsageFailure 로만 오르고, 사용자 중단(is_interrupt)·다른 도구는 대상 아님
 *  - 실패율 = failures / (calls + failures), tz 로 일자를 자른다, 프로젝트 별칭 필터
 *  - backfillMetaUsageFailures 는 한 번만 돈다
 *  - 요약 보존(pruneSummaryTables) 대상에 포함
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import {
  backfillMetaUsageFailures, getMetaUsageDaily, metaUsageFailureTarget, metaUsageTarget, recordMetaUsageFailure,
} from '../queries/stats/meta-usage';
import { createEvent } from '../queries/event';
import { pruneSummaryTables } from '../queries/session/retention';

const T = Date.UTC(2026, 10, 23, 14, 30); // KST 11-23 23:30
const H = 3_600_000;
let db: Database;
let seq = 0;

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  db.run("INSERT INTO sessions (id, project_name, started_at) VALUES ('s1', 'hub', 0), ('s2', 'old', 0)");
});
afterEach(() => db.close());

function req(o: { tool?: string | null; detail?: string | null; ev?: string | null; slash?: string | null; ts?: number; session?: string; tokens?: number }): string {
  const id = `r${++seq}`;
  db.run(
    `INSERT INTO requests (id, session_id, timestamp, type, tool_name, tool_detail, event_type, slash_command, tokens_total, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 10)`,
    [id, o.session ?? 's1', o.ts ?? T, o.slash ? 'prompt' : 'tool_call', o.tool ?? null, o.detail ?? null,
      o.ev === undefined ? 'tool' : o.ev, o.slash ?? null, o.tokens ?? 5],
  );
  return id;
}
const rows = () => db.query('SELECT kind, name, calls, failures FROM stats_meta_usage_hourly ORDER BY kind, name').all();

describe('Migration 073 트리거', () => {
  test('확정 Skill/Agent 행과 슬래시 명령을 세고, pre_tool 은 세지 않는다', () => {
    req({ tool: 'Skill', detail: 'commit' });
    req({ tool: 'Agent', detail: 'Explore' });
    req({ tool: 'Skill', detail: 'push', ev: 'pre_tool' });
    req({ tool: 'Bash', detail: 'ls' });
    req({ slash: '/review', ev: 'prompt' });
    expect(rows()).toEqual([
      { kind: 'agent', name: 'Explore', calls: 1, failures: 0 },
      { kind: 'command', name: '/review', calls: 1, failures: 0 },
      { kind: 'skill', name: 'commit', calls: 1, failures: 0 },
    ]);
  });

  test('pre_tool 행이 tool 로 확정되는 순간 한 번 센다(재UPDATE 는 다시 안 센다)', () => {
    const id = req({ tool: 'Skill', detail: 'push', ev: 'pre_tool' });
    db.run("UPDATE requests SET event_type = 'tool', tokens_total = 9 WHERE id = ?", [id]);
    db.run("UPDATE requests SET event_type = 'tool' WHERE id = ?", [id]);
    expect(db.query("SELECT calls, tokens_total FROM stats_meta_usage_hourly WHERE name = 'push'").get()).toEqual({ calls: 1, tokens_total: 9 });
  });

  test('나중에 처음 채워진 slash_command 도 센다', () => {
    const id = req({ ev: 'prompt' });
    db.run("UPDATE requests SET slash_command = '/plan' WHERE id = ?", [id]);
    db.run("UPDATE requests SET slash_command = '/plan' WHERE id = ?", [id]);
    expect(rows()).toEqual([{ kind: 'command', name: '/plan', calls: 1, failures: 0 }]);
  });
});

describe('실패 기록', () => {
  test('metaUsageTarget·metaUsageFailureTarget 규칙', () => {
    expect(metaUsageTarget('Skill', { skill: 'commit' })).toEqual({ kind: 'skill', name: 'commit' });
    expect(metaUsageTarget('Agent', { subagent_type: 'Plan', description: 'x' })).toEqual({ kind: 'agent', name: 'Plan' });
    expect(metaUsageTarget('Bash', { command: 'ls' })).toBeNull();
    expect(metaUsageFailureTarget({ tool_name: 'Skill', tool_input: { skill: 'commit' }, is_interrupt: true })).toBeNull();
    expect(metaUsageFailureTarget({ tool_name: 'Agent', tool_input: { subagent_type: 'Plan' } })).toEqual({ kind: 'agent', name: 'Plan' });
  });

  test('실패율 = failures / (calls + failures)', () => {
    req({ tool: 'Skill', detail: 'commit' });
    req({ tool: 'Skill', detail: 'commit' });
    req({ tool: 'Skill', detail: 'commit' });
    recordMetaUsageFailure(db, { sessionId: 's1', timestamp: T, kind: 'skill', name: 'commit' });
    const [r] = getMetaUsageDaily(db, { tz: 'UTC' });
    expect(r).toMatchObject({ kind: 'skill', name: 'commit', calls: 3, failures: 1, failure_rate: 0.25, sessions: 1 });
  });

  test('backfillMetaUsageFailures 는 Skill/Agent 실패만 한 번 반영한다', () => {
    const ev = (id: string, payload: object) => createEvent(db, {
      event_id: id, event_type: 'PostToolUseFailure', session_id: 's1', timestamp: T, payload: JSON.stringify(payload),
    });
    ev('e1', { tool_name: 'Skill', tool_input: { skill: 'commit' }, error: 'x' });
    ev('e2', { tool_name: 'Agent', tool_input: { subagent_type: 'Plan' }, error: 'x' });
    ev('e3', { tool_name: 'Bash', tool_input: { command: 'ls' }, error: 'x' });
    ev('e4', { tool_name: 'Skill', tool_input: { skill: 'commit' }, is_interrupt: true });
    expect(backfillMetaUsageFailures(db)).toBe(2);
    expect(backfillMetaUsageFailures(db)).toBeNull();
    expect(rows()).toEqual([
      { kind: 'agent', name: 'Plan', calls: 0, failures: 1 },
      { kind: 'skill', name: 'commit', calls: 0, failures: 1 },
    ]);
  });
});

describe('getMetaUsageDaily', () => {
  test('tz 로 일자를 자르고 kind·name·기간·프로젝트(별칭)로 거른다', () => {
    req({ tool: 'Skill', detail: 'commit', ts: T });
    req({ tool: 'Skill', detail: 'commit', ts: T + H, session: 's2' });
    req({ tool: 'Agent', detail: 'Plan', ts: T });
    expect(getMetaUsageDaily(db, { tz: 'Asia/Seoul', kind: 'skill' }).map((r) => r.date)).toEqual(['2026-11-24', '2026-11-23']);
    expect(getMetaUsageDaily(db, { tz: 'UTC', name: 'commit' })).toMatchObject([{ calls: 2, sessions: 2 }]);
    expect(getMetaUsageDaily(db, { tz: 'UTC', from: T + H })).toHaveLength(1);
    expect(getMetaUsageDaily(db, { tz: 'UTC', project: 'hub' }).reduce((a, r) => a + r.calls, 0)).toBe(2);
    db.run("INSERT INTO project_aliases (alias, project_name) VALUES ('old', 'hub')");
    expect(getMetaUsageDaily(db, { tz: 'UTC', project: 'hub' }).reduce((a, r) => a + r.calls, 0)).toBe(3);
  });

  test('요약 보존 prune 대상이다', () => {
    req({ tool: 'Skill', detail: 'commit', ts: T });
    expect(pruneSummaryTables(db, T + 400 * 24 * H, 365).stats_meta_usage_hourly).toBe(1);
  });
});
