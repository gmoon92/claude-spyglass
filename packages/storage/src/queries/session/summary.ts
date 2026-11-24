/**
 * session summary — 세션 1건을 한 화면 요약으로 접는 저장소 조회 (GET /api/sessions/:id/summary, 허브 요약 #3).
 *
 * 책임:
 *  - 세션 메타(orca_terminal·hub_role·시작/종료) + 마지막 활동 시각
 *  - 토큰 합계: stats_session_hourly(요약, 365일 보존). 원본 30일이 지나도 남는다.
 *  - 부른 스킬·에이전트·슬래시 명령 횟수: requests(Hot)
 *  - 요약 대상 세션 목록 고르기(hub_role·활성 여부)
 *
 * 컨텍스트 포화·마찰 신호는 다른 도메인(metrics·friction)이 계산하므로 server 라우트가 조합한다.
 *
 * 호출자: server routes/session-summary.ts
 */

import type { Database } from 'bun:sqlite';
import { listLiveSessions } from '../../domain/session-status';

export interface SessionSummaryCore {
  session_id: string;
  project_name: string;
  orca_terminal: string | null;
  hub_role: string | null;
  started_at: number;
  ended_at: number | null;
  /** requests·proxy_requests·claude_events 중 가장 늦은 시각 */
  last_activity_at: number | null;
  tokens: {
    requests: number;
    errors: number;
    input: number;
    output: number;
    cache_creation: number;
    cache_read: number;
    total: number;
    cache_hit_rate: number | null;
    by_model: Array<{ model: string; requests: number; total: number }>;
  };
  skills: Array<{ name: string; calls: number }>;
  agents: Array<{ type: string; calls: number }>;
  commands: Array<{ name: string; calls: number }>;
}

interface SessionRow {
  id: string;
  project_name: string;
  orca_terminal: string | null;
  hub_role: string | null;
  started_at: number;
  ended_at: number | null;
}

/** 세션 1건의 요약 코어. 세션이 없으면 null. */
export function getSessionSummaryCore(db: Database, sessionId: string): SessionSummaryCore | null {
  const s = db.query(
    'SELECT id, project_name, orca_terminal, hub_role, started_at, ended_at FROM sessions WHERE id = ?',
  ).get(sessionId) as SessionRow | null;
  if (!s) return null;

  const last = db.query(`
    SELECT MAX(t) AS t FROM (
      SELECT MAX(timestamp) AS t FROM requests       WHERE session_id = ?1
      UNION ALL SELECT MAX(timestamp) FROM proxy_requests WHERE session_id = ?1
      UNION ALL SELECT MAX(timestamp) FROM claude_events  WHERE session_id = ?1
    )`).get(sessionId) as { t: number | null };

  const byModel = db.query(`
    SELECT model, SUM(request_count) AS requests, SUM(error_count) AS errors,
           SUM(tokens_input) AS ti, SUM(tokens_output) AS t_out,
           SUM(cache_creation_tokens) AS tcc, SUM(cache_read_tokens) AS tcr
      FROM stats_session_hourly WHERE session_id = ?
     GROUP BY model ORDER BY requests DESC`).all(sessionId) as Array<{
    model: string; requests: number; errors: number; ti: number; t_out: number; tcc: number; tcr: number;
  }>;
  const sum = (k: 'requests' | 'errors' | 'ti' | 't_out' | 'tcc' | 'tcr') => byModel.reduce((a, r) => a + r[k], 0);
  const input = sum('ti'), output = sum('t_out'), cc = sum('tcc'), cr = sum('tcr');
  const inputSide = input + cc + cr;

  const named = (sql: string) => db.query(sql).all(sessionId) as Array<{ name: string; calls: number }>;
  const skills = named(`
    SELECT tool_detail AS name, COUNT(*) AS calls FROM requests
     WHERE session_id = ? AND tool_name = 'Skill' AND tool_detail IS NOT NULL
       AND (event_type IS NULL OR event_type != 'pre_tool')
     GROUP BY tool_detail ORDER BY calls DESC, name`);
  const agents = named(`
    SELECT tool_detail AS name, COUNT(*) AS calls FROM requests
     WHERE session_id = ? AND tool_name = 'Agent' AND tool_detail IS NOT NULL
       AND (event_type IS NULL OR event_type != 'pre_tool')
     GROUP BY tool_detail ORDER BY calls DESC, name`);
  const commands = named(`
    SELECT slash_command AS name, COUNT(*) AS calls FROM requests
     WHERE session_id = ? AND slash_command IS NOT NULL AND slash_command != ''
     GROUP BY slash_command ORDER BY calls DESC, name`);

  return {
    session_id: s.id,
    project_name: s.project_name,
    orca_terminal: s.orca_terminal,
    hub_role: s.hub_role,
    started_at: s.started_at,
    ended_at: s.ended_at,
    last_activity_at: last.t,
    tokens: {
      requests: sum('requests'),
      errors: sum('errors'),
      input, output, cache_creation: cc, cache_read: cr,
      total: input + output + cc + cr,
      cache_hit_rate: inputSide > 0 ? Math.round((cr / inputSide) * 10_000) / 10_000 : null,
      by_model: byModel.map((r) => ({ model: r.model, requests: r.requests, total: r.ti + r.t_out + r.tcc + r.tcr })),
    },
    skills,
    agents: agents.map((a) => ({ type: a.name, calls: a.calls })),
    commands,
  };
}

export interface SessionSummaryListOptions {
  /** 'main' | 'worker' 등. 없으면 전체. */
  hubRole?: string | null;
  /** true 면 LIVE 세션만(GET /api/sessions/active 와 같은 기준). */
  active?: boolean;
  /** 최대 개수. 기본 20, 최대 100. */
  limit?: number;
}

/** 요약할 세션 id 목록 — 활성이면 LIVE 기준, 아니면 시작 시각 내림차순. */
export function listSessionIdsForSummary(db: Database, opts: SessionSummaryListOptions = {}): string[] {
  const limit = Math.min(Math.max(1, opts.limit ?? 20), 100);
  if (opts.active) {
    return listLiveSessions(db)
      .filter((s) => !opts.hubRole || (s as unknown as { hub_role: string | null }).hub_role === opts.hubRole)
      .slice(0, limit)
      .map((s) => s.id);
  }
  const rows = opts.hubRole
    ? db.query('SELECT id FROM sessions WHERE hub_role = ? ORDER BY started_at DESC LIMIT ?').all(opts.hubRole, limit)
    : db.query('SELECT id FROM sessions ORDER BY started_at DESC LIMIT ?').all(limit);
  return (rows as Array<{ id: string }>).map((r) => r.id);
}
