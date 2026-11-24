/**
 * session-daily — stats_session_hourly 를 시간대(tz) 기준 일자로 묶은 세션별 토큰 합계
 * (GET /api/stats/sessions/daily, 허브 요약 #2).
 *
 * 책임:
 *  - 시간 버킷 행을 tz 의 로컬 날짜(YYYY-MM-DD)로 묶어 (date, session_id) 별 토큰·캐시 적중률을 낸다.
 *  - 모델별 내역은 models[] 로 접어 준다.
 *
 * 프로젝트 이름: sessions 가 살아 있으면 그 값, 지워졌으면(원본 30일 경과) 요약에 복사해 둔 값.
 *  필터·표시 모두 project_aliases 를 적용해 대표 이름으로 맞춘다.
 *
 * 시간대: 버킷이 정시 단위라 30·45분 오프셋 시간대(예: Asia/Kolkata)에서는 경계 시간의 토큰이
 *  한쪽 날짜로 몰린다. 허브 용도(KST)에는 영향 없다.
 *
 * 호출자: server routes/stats.ts
 */

import type { Database } from 'bun:sqlite';
import { canonicalProjectNameExpr, projectNameIn } from '../project-alias';

export interface SessionDailyOptions {
  /** ms epoch, 포함. hour 버킷 시작 시각 기준으로 거른다. */
  from?: number | null;
  /** ms epoch, 포함. */
  to?: number | null;
  /** IANA 시간대. 기본: 서버 로컬 시간대. */
  tz?: string | null;
  project?: string | null;
  sessionId?: string | null;
}

export interface SessionDailyModel {
  model: string;
  requests: number;
  tokens_input: number;
  tokens_output: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export interface SessionDailyRow {
  date: string;
  session_id: string;
  project_name: string | null;
  requests: number;
  errors: number;
  tokens_input: number;
  tokens_output: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  /** input + output + cache_creation + cache_read */
  tokens_total: number;
  /** cache_read / (input + cache_read + cache_creation). 입력이 0 이면 null */
  cache_hit_rate: number | null;
  models: SessionDailyModel[];
}

/** tz 문자열이 유효한 IANA 시간대인지. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface HourRow {
  hour_ts: number;
  session_id: string;
  model: string;
  project_name: string | null;
  request_count: number;
  error_count: number;
  tokens_input: number;
  tokens_output: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

/**
 * 세션별 일자 합계. date 내림차순 → tokens_total 내림차순.
 * @throws RangeError tz 가 유효하지 않을 때(라우트가 400 으로 먼저 거른다)
 */
export function getSessionDailyStats(db: Database, opts: SessionDailyOptions = {}): SessionDailyRow[] {
  const projectExpr = canonicalProjectNameExpr(db, 'COALESCE(s.project_name, h.project_name)');
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts.from != null) { where.push('h.hour_ts >= ?'); params.push(Math.floor(opts.from / 1000 / 3600) * 3600); }
  if (opts.to != null) { where.push('h.hour_ts <= ?'); params.push(Math.floor(opts.to / 1000)); }
  if (opts.sessionId) { where.push('h.session_id = ?'); params.push(opts.sessionId); }
  if (opts.project) {
    const f = projectNameIn(db, 'COALESCE(s.project_name, h.project_name)', opts.project);
    where.push(f.sql);
    params.push(...f.params);
  }

  const rows = db.query(`
    SELECT h.hour_ts, h.session_id, h.model, ${projectExpr} AS project_name,
           h.request_count, h.error_count, h.tokens_input, h.tokens_output,
           h.cache_creation_tokens, h.cache_read_tokens
      FROM stats_session_hourly h
      LEFT JOIN sessions s ON s.id = h.session_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
  `).all(...params) as HourRow[];

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: opts.tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const byKey = new Map<string, SessionDailyRow & { _models: Map<string, SessionDailyModel> }>();

  for (const r of rows) {
    const date = fmt.format(new Date(r.hour_ts * 1000));
    const key = `${date}\u0000${r.session_id}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = {
        date, session_id: r.session_id, project_name: r.project_name,
        requests: 0, errors: 0, tokens_input: 0, tokens_output: 0,
        cache_creation_tokens: 0, cache_read_tokens: 0, tokens_total: 0,
        cache_hit_rate: null, models: [], _models: new Map(),
      };
      byKey.set(key, agg);
    }
    agg.project_name ??= r.project_name;
    agg.requests += r.request_count;
    agg.errors += r.error_count;
    agg.tokens_input += r.tokens_input;
    agg.tokens_output += r.tokens_output;
    agg.cache_creation_tokens += r.cache_creation_tokens;
    agg.cache_read_tokens += r.cache_read_tokens;

    let m = agg._models.get(r.model);
    if (!m) {
      m = { model: r.model, requests: 0, tokens_input: 0, tokens_output: 0, cache_creation_tokens: 0, cache_read_tokens: 0 };
      agg._models.set(r.model, m);
    }
    m.requests += r.request_count;
    m.tokens_input += r.tokens_input;
    m.tokens_output += r.tokens_output;
    m.cache_creation_tokens += r.cache_creation_tokens;
    m.cache_read_tokens += r.cache_read_tokens;
  }

  const out: SessionDailyRow[] = [];
  for (const { _models, ...a } of byKey.values()) {
    a.tokens_total = a.tokens_input + a.tokens_output + a.cache_creation_tokens + a.cache_read_tokens;
    const inputSide = a.tokens_input + a.cache_read_tokens + a.cache_creation_tokens;
    a.cache_hit_rate = inputSide > 0 ? Math.round((a.cache_read_tokens / inputSide) * 10_000) / 10_000 : null;
    a.models = [..._models.values()].sort((x, y) => y.requests - x.requests);
    out.push(a);
  }
  return out.sort((x, y) => (x.date === y.date ? y.tokens_total - x.tokens_total : x.date < y.date ? 1 : -1));
}
