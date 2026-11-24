/**
 * meta-usage — 스킬·에이전트·슬래시 명령의 호출/실패 요약 (stats_meta_usage_hourly, Migration 073, 허브 요약 #1).
 *
 * 책임:
 *  - 실패 기록: PostToolUseFailure 중 Skill/Agent 호출 자체 오류를 시간 버킷에 +1 (recordMetaUsageFailure).
 *    SQL 트리거로는 못 센다 — 실패 정보가 claude_events.payload(zstd 저장) 안에만 있어서.
 *  - 과거 실패 1회 백필(backfillMetaUsageFailures) — metadata 키로 한 번만 돈다.
 *  - 일자 조회(getMetaUsageDaily): tz 기준 날짜 × (kind, name) 로 calls·failures·실패율.
 *
 * 호출 수(calls)는 requests 트리거가 올린다(073). 실패한 호출은 PostToolUse 가 오지 않아 calls 에
 * 없으므로 시도 수 = calls + failures, 실패율 = failures / (calls + failures).
 *
 * 호출자: server events.ts(실패 기록), runtime/lifecycle.ts(백필), routes/meta-docs.ts(조회)
 */

import type { Database } from 'bun:sqlite';
import { getEventsByTypesInRange } from '../event';
import { getMetadata, setMetadata } from '../metadata';
import { projectNameIn } from '../project-alias';

export type MetaUsageKind = 'skill' | 'agent' | 'command';

/**
 * 도구 입력에서 스킬·에이전트 이름을 뽑는다 — requests.tool_detail 과 같은 규칙
 * (server hook/tool-detail.ts extractToolDetail 의 Skill·Agent 분기). Skill/Agent 가 아니면 null.
 */
export function metaUsageTarget(
  toolName: string | null | undefined,
  toolInput: unknown,
): { kind: 'skill' | 'agent'; name: string } | null {
  const input = (toolInput && typeof toolInput === 'object' ? toolInput : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);
  if (toolName === 'Skill') {
    const name = str(input.skill) ?? str(input.args);
    return name ? { kind: 'skill', name: name.slice(0, 80) } : null;
  }
  if (toolName === 'Agent') {
    const name = str(input.subagent_type) ?? str(input.description)?.slice(0, 80) ?? str(input.prompt)?.slice(0, 80);
    return name ? { kind: 'agent', name } : null;
  }
  return null;
}

/** 실패 1건을 시간 버킷에 더한다. 호출 측은 실패해도 이벤트 저장을 막지 않도록 감싼다. */
export function recordMetaUsageFailure(
  db: Database,
  p: { sessionId: string; timestamp: number; kind: MetaUsageKind; name: string },
): void {
  db.run(
    `INSERT INTO stats_meta_usage_hourly (hour_ts, session_id, kind, name, project_name, failures, updated_at)
     VALUES (?, ?, ?, ?, (SELECT s.project_name FROM sessions s WHERE s.id = ?), 1, strftime('%s','now'))
     ON CONFLICT(hour_ts, session_id, kind, name) DO UPDATE SET
       failures     = failures + 1,
       project_name = COALESCE(project_name, excluded.project_name),
       updated_at   = strftime('%s','now')`,
    [Math.floor(p.timestamp / 1000 / 3600) * 3600, p.sessionId, p.kind, p.name, p.sessionId],
  );
}

interface FailurePayload {
  tool_name?: string;
  tool_input?: unknown;
  is_interrupt?: boolean;
}

/**
 * PostToolUseFailure payload 에서 요약 대상이면 {kind, name} 을, 아니면 null.
 * 사용자 중단(is_interrupt)은 호출 자체 오류가 아니므로 제외한다.
 */
export function metaUsageFailureTarget(payload: unknown): { kind: 'skill' | 'agent'; name: string } | null {
  const p = (payload && typeof payload === 'object' ? payload : {}) as FailurePayload;
  if (p.is_interrupt === true) return null;
  return metaUsageTarget(p.tool_name, p.tool_input);
}

const FAILURE_BACKFILL_KEY = 'stats_meta_usage_failures_backfilled_v1';

/**
 * 과거 PostToolUseFailure 를 한 번만 요약에 반영한다(Hot + Archive). metadata 키로 재실행을 막는다.
 * 서버 기동 때 호출한다. 이 함수가 돈 뒤의 실패는 events.ts 가 실시간으로 올린다.
 *
 * @returns 반영한 실패 수. 이미 돌았으면 null.
 */
export function backfillMetaUsageFailures(db: Database): number | null {
  if (getMetadata(db, FAILURE_BACKFILL_KEY)) return null;
  const events = getEventsByTypesInRange(db, { eventTypes: ['PostToolUseFailure'], limit: 1_000_000 });
  let n = 0;
  db.transaction(() => {
    for (const e of events) {
      let payload: unknown;
      try { payload = JSON.parse(e.payload); } catch { continue; }
      const target = metaUsageFailureTarget(payload);
      if (!target) continue;
      recordMetaUsageFailure(db, { sessionId: e.session_id, timestamp: e.timestamp, ...target });
      n++;
    }
    setMetadata(db, FAILURE_BACKFILL_KEY, String(Date.now()));
  })();
  return n;
}

export interface MetaUsageDailyOptions {
  from?: number | null;
  to?: number | null;
  /** IANA 시간대. 기본: 서버 로컬. */
  tz?: string | null;
  project?: string | null;
  kind?: MetaUsageKind | null;
  name?: string | null;
}

export interface MetaUsageDailyRow {
  date: string;
  kind: MetaUsageKind;
  name: string;
  calls: number;
  failures: number;
  /** failures / (calls + failures). 시도 0 이면 null */
  failure_rate: number | null;
  tokens_total: number;
  duration_ms_sum: number;
  sessions: number;
}

/** tz 기준 일자 × (kind, name) 집계. date 내림차순 → 시도 수 내림차순. */
export function getMetaUsageDaily(db: Database, opts: MetaUsageDailyOptions = {}): MetaUsageDailyRow[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts.from != null) { where.push('h.hour_ts >= ?'); params.push(Math.floor(opts.from / 1000 / 3600) * 3600); }
  if (opts.to != null) { where.push('h.hour_ts <= ?'); params.push(Math.floor(opts.to / 1000)); }
  if (opts.kind) { where.push('h.kind = ?'); params.push(opts.kind); }
  if (opts.name) { where.push('h.name = ?'); params.push(opts.name); }
  if (opts.project) {
    const f = projectNameIn(db, 'COALESCE(s.project_name, h.project_name)', opts.project);
    where.push(f.sql);
    params.push(...f.params);
  }
  const rows = db.query(`
    SELECT h.hour_ts, h.session_id, h.kind, h.name, h.calls, h.failures, h.tokens_total, h.duration_ms_sum
      FROM stats_meta_usage_hourly h
      LEFT JOIN sessions s ON s.id = h.session_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
  `).all(...params) as Array<{
    hour_ts: number; session_id: string; kind: MetaUsageKind; name: string;
    calls: number; failures: number; tokens_total: number; duration_ms_sum: number;
  }>;

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: opts.tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const byKey = new Map<string, MetaUsageDailyRow & { _sessions: Set<string> }>();
  for (const r of rows) {
    const date = fmt.format(new Date(r.hour_ts * 1000));
    const key = `${date}\u0000${r.kind}\u0000${r.name}`;
    let a = byKey.get(key);
    if (!a) {
      a = { date, kind: r.kind, name: r.name, calls: 0, failures: 0, failure_rate: null, tokens_total: 0, duration_ms_sum: 0, sessions: 0, _sessions: new Set() };
      byKey.set(key, a);
    }
    a.calls += r.calls;
    a.failures += r.failures;
    a.tokens_total += r.tokens_total;
    a.duration_ms_sum += r.duration_ms_sum;
    a._sessions.add(r.session_id);
  }
  const out: MetaUsageDailyRow[] = [];
  for (const { _sessions, ...a } of byKey.values()) {
    const attempts = a.calls + a.failures;
    a.failure_rate = attempts > 0 ? Math.round((a.failures / attempts) * 10_000) / 10_000 : null;
    a.sessions = _sessions.size;
    out.push(a);
  }
  return out.sort((x, y) =>
    x.date === y.date ? (y.calls + y.failures) - (x.calls + x.failures) || x.name.localeCompare(y.name) : x.date < y.date ? 1 : -1);
}
