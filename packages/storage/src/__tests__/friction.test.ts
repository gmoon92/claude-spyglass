/**
 * friction — 마찰 신호 집계(queries/friction.ts) 단위 테스트.
 *
 * 검증 핵심:
 *  - 이벤트 종류별 카운트(도구 실패·중단·권한 요청/거부·API 실패·압축)와 세션·도구별 분해
 *  - 오류문은 첫 줄 200자만 노출
 *  - 연속 실패(repeated_failures): 같은 도구가 끊김 없이 이어지고 간격이 10분 이내일 때만 묶임
 *  - SQL 단계 필터(타입·기간·세션·cwd 접두)와 limit 상한(CwdChanged 같은 잡음에 밀리지 않음)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { createEvent, type ClaudeEvent } from '../queries/event';
import {
  getFrictionSummary,
  summarizeFriction,
  REPEAT_GAP_MS,
  FRICTION_ERROR_MAX_CHARS,
} from '../queries/friction';

let db: Database;
let seq = 0;

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  seq = 0;
});
afterEach(() => db.close());

function ev(
  type: string,
  session: string,
  ts: number,
  payload: Record<string, unknown> = {},
  cwd = '/work/hub',
): ClaudeEvent {
  return {
    event_id: `e-${++seq}`,
    event_type: type,
    session_id: session,
    cwd,
    timestamp: ts,
    payload: JSON.stringify(payload),
  };
}
function insert(...events: ClaudeEvent[]): void {
  for (const e of events) createEvent(db, e);
}
const fail = (s: string, ts: number, tool: string, extra: Record<string, unknown> = {}) =>
  ev('PostToolUseFailure', s, ts, { tool_name: tool, error: 'Exit code 1\nstack...', is_interrupt: false, ...extra });

describe('summarizeFriction — 집계', () => {
  it('종류별 totals 와 세션별 분해', () => {
    const r = summarizeFriction([
      fail('a', 1, 'Bash'),
      fail('a', 2, 'Edit', { is_interrupt: true }),
      ev('PermissionRequest', 'a', 3),
      ev('PermissionDenied', 'b', 4),
      ev('StopFailure', 'b', 5),
      ev('PreCompact', 'b', 6),
    ]);
    expect(r.totals).toEqual({
      tool_failures: 2, interrupts: 1, permission_requests: 1,
      permission_denied: 1, stop_failures: 1, compactions: 1,
    });
    const a = r.by_session.find((s) => s.session_id === 'a')!;
    expect(a.tool_failures).toBe(2);
    expect(a.interrupts).toBe(1);
    expect(a.permission_requests).toBe(1);
    expect(a.last_event_at).toBe(3);
    const b = r.by_session.find((s) => s.session_id === 'b')!;
    expect(b.permission_denied).toBe(1);
    expect(b.compactions).toBe(1);
  });

  it('세션은 마찰 합계 큰 순(압축은 합계에서 제외)', () => {
    const r = summarizeFriction([
      ev('PreCompact', 'only-compact', 1), ev('PreCompact', 'only-compact', 2),
      fail('one-fail', 3, 'Bash'),
    ]);
    expect(r.by_session.map((s) => s.session_id)).toEqual(['one-fail', 'only-compact']);
  });

  it('top_failing_tools — 실패 많은 순, 마지막 오류는 첫 줄만', () => {
    const r = summarizeFriction([
      fail('a', 1, 'Bash', { error: 'first failure' }),
      fail('a', 2, 'Bash', { error: 'Exit code 2\nsecret=abc\nmore' }),
      fail('a', 3, 'Read', { error: 'ENOENT' }),
    ]);
    expect(r.top_failing_tools.map((t) => t.tool_name)).toEqual(['Bash', 'Read']);
    expect(r.top_failing_tools[0].failures).toBe(2);
    expect(r.top_failing_tools[0].last_error).toBe('Exit code 2'); // 둘째 줄(secret=...) 미노출
    expect(r.top_failing_tools[0].last_at).toBe(2);
  });

  it('오류문은 FRICTION_ERROR_MAX_CHARS 자로 자른다', () => {
    const r = summarizeFriction([fail('a', 1, 'Bash', { error: 'x'.repeat(1000) })]);
    expect(r.top_failing_tools[0].last_error).toHaveLength(FRICTION_ERROR_MAX_CHARS);
  });

  it('도구명이 없거나 payload 가 깨져도 unknown 으로 센다', () => {
    const broken: ClaudeEvent = { ...ev('PostToolUseFailure', 'a', 1), payload: '{not json' };
    const r = summarizeFriction([broken, ev('PostToolUseFailure', 'a', 2, {})]);
    expect(r.top_failing_tools).toHaveLength(1);
    expect(r.top_failing_tools[0]).toMatchObject({ tool_name: 'unknown', failures: 2, last_error: null });
  });

  it('입력 순서와 무관하게 시간순으로 처리한다', () => {
    const r = summarizeFriction([fail('a', 3, 'Bash'), fail('a', 1, 'Bash'), fail('a', 2, 'Bash')]);
    expect(r.repeated_failures).toEqual([{ session_id: 'a', tool_name: 'Bash', streak: 3, first_at: 1, last_at: 3 }]);
  });
});

describe('summarizeFriction — 연속 실패', () => {
  it('같은 도구 3회 연속 → streak 3', () => {
    const r = summarizeFriction([fail('a', 1, 'Bash'), fail('a', 2, 'Bash'), fail('a', 3, 'Bash')]);
    expect(r.repeated_failures).toHaveLength(1);
    expect(r.repeated_failures[0].streak).toBe(3);
  });

  it('다른 도구 실패가 끼면 끊긴다', () => {
    const r = summarizeFriction([fail('a', 1, 'Bash'), fail('a', 2, 'Bash'), fail('a', 3, 'Read'), fail('a', 4, 'Bash')]);
    expect(r.repeated_failures).toEqual([]); // Bash 2 + Read 1 + Bash 1
  });

  it('간격이 REPEAT_GAP_MS 를 넘으면 끊긴다', () => {
    const r = summarizeFriction([
      fail('a', 0, 'Bash'), fail('a', 1000, 'Bash'),
      fail('a', 1000 + REPEAT_GAP_MS + 1, 'Bash'),
    ]);
    expect(r.repeated_failures).toEqual([]);
  });

  it('세션이 다르면 섞이지 않는다', () => {
    const r = summarizeFriction([fail('a', 1, 'Bash'), fail('b', 2, 'Bash'), fail('a', 3, 'Bash'), fail('b', 4, 'Bash')]);
    expect(r.repeated_failures).toEqual([]);
  });

  it('repeatMin 으로 기준을 바꾼다(최소 2)', () => {
    const events = [fail('a', 1, 'Bash'), fail('a', 2, 'Bash')];
    expect(summarizeFriction(events).repeated_failures).toEqual([]);
    expect(summarizeFriction(events, { repeatMin: 2 }).repeated_failures).toHaveLength(1);
    expect(summarizeFriction([fail('a', 1, 'Bash')], { repeatMin: 0 }).repeated_failures).toEqual([]);
  });
});

describe('getFrictionSummary — DB 조회', () => {
  it('마찰 타입만 읽는다 (CwdChanged 등 잡음 제외)', () => {
    insert(ev('CwdChanged', 'a', 1), ev('ConfigChange', 'a', 2), fail('a', 3, 'Bash'));
    const r = getFrictionSummary(db, {});
    expect(r.scanned_events).toBe(1);
    expect(r.totals.tool_failures).toBe(1);
  });

  it('잡음이 많아도 limit 에 밀리지 않는다', () => {
    for (let i = 0; i < 50; i++) insert(ev('CwdChanged', 'a', 100 + i));
    insert(fail('a', 1, 'Bash'));
    const r = getFrictionSummary(db, { limit: 5 });
    expect(r.totals.tool_failures).toBe(1);
    expect(r.truncated).toBe(false);
  });

  it('limit 에 걸리면 최신 이벤트를 남기고 truncated=true', () => {
    insert(fail('a', 1, 'Old'), fail('a', 2, 'Mid'), fail('a', 3, 'New'));
    const r = getFrictionSummary(db, { limit: 2 });
    expect(r.truncated).toBe(true);
    expect(r.top_failing_tools.map((t) => t.tool_name).sort()).toEqual(['Mid', 'New']);
  });

  it('기간 필터 — from·to 모두 포함', () => {
    insert(fail('a', 10, 'T10'), fail('a', 20, 'T20'), fail('a', 30, 'T30'));
    const r = getFrictionSummary(db, { fromTs: 20, toTs: 30 });
    expect(r.top_failing_tools.map((t) => t.tool_name).sort()).toEqual(['T20', 'T30']);
  });

  it('session_id 필터', () => {
    insert(fail('a', 1, 'Bash'), fail('b', 2, 'Bash'));
    const r = getFrictionSummary(db, { sessionId: 'b' });
    expect(r.by_session.map((s) => s.session_id)).toEqual(['b']);
  });

  it('cwd_prefix 필터 — 접두 일치만, % 와 _ 는 와일드카드가 아니다', () => {
    insert(
      fail('hub', 1, 'Bash'),
      { ...fail('sub', 2, 'Bash'), cwd: '/work/hub/workspace/x' },
      { ...fail('other', 3, 'Bash'), cwd: '/work/other' },
      { ...fail('pct', 4, 'Bash'), cwd: '/work/100%/y' },
    );
    expect(getFrictionSummary(db, { cwdPrefix: '/work/hub' }).by_session.map((s) => s.session_id).sort())
      .toEqual(['hub', 'sub']);
    expect(getFrictionSummary(db, { cwdPrefix: '/work/%' }).by_session).toEqual([]); // 리터럴 '%' 로만 비교
    expect(getFrictionSummary(db, { cwdPrefix: '/work/100%' }).by_session.map((s) => s.session_id)).toEqual(['pct']);
  });

  it('결과가 없으면 0 / 빈 배열', () => {
    const r = getFrictionSummary(db, {});
    expect(r.totals.tool_failures).toBe(0);
    expect(r.by_session).toEqual([]);
    expect(r.top_failing_tools).toEqual([]);
    expect(r.repeated_failures).toEqual([]);
    expect(r.scanned_events).toBe(0);
    expect(r.truncated).toBe(false);
  });
});
