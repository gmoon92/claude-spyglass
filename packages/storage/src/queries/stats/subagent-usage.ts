/**
 * subagent-usage — 서브에이전트 종류 × 실제 모델별 사용량 집계 (GET /api/stats/subagents).
 *
 * 책임:
 *  - 서브에이전트 실행(agent_id) 단위로 agent_type·모델·토큰을 모아 (agent_type, model) 로 묶는다.
 *  - 모델 상한(max_tier) 초과 여부를 표시한다(허브의 CLAUDE_CODE_SUBAGENT_MODEL 상한 점검용).
 *
 * 모델·토큰의 출처:
 *  - 모델: requests.api_request_id 로 이어지는 proxy_requests.model 을 우선한다(실제 API 호출 기록).
 *    proxy 가 없을 때만 requests.model 을 쓴다. requests.model 은 서브에이전트 첫 도구 행에 부모
 *    모델이 들어가던 이력이 있어(Migration 071 참고) 단독으로는 믿지 않는다.
 *  - 토큰: 같은 api_request_id 의 proxy 실측값. 한 응답에 도구 행이 여럿이어도 api_request_id 로
 *    중복을 없앤 뒤 더한다. proxy 와 이어지지 않는 실행은 토큰 0 으로 센다.
 *
 * 범위: Hot 테이블만(원본 보존 30일). 프로젝트 필터는 project_aliases 를 적용한다.
 *
 * 호출자: server routes/stats.ts
 */

import type { Database } from 'bun:sqlite';
import { projectNameIn } from '../project-alias';

/** 모델 등급 — 높을수록 비싸다. 상한 비교에만 쓴다. */
const TIER_ORDER = ['haiku', 'sonnet', 'opus', 'fable'] as const;
export type ModelTier = (typeof TIER_ORDER)[number];

/** 모델 ID 에서 등급을 뽑는다. 알 수 없는 모델이면 null. */
export function modelTier(model: string | null | undefined): ModelTier | null {
  if (!model) return null;
  const m = model.toLowerCase();
  for (const t of TIER_ORDER) if (m.includes(t)) return t;
  return null;
}

/** 등급 문자열 검증 — max_tier 쿼리 파라미터 해석용. */
export function parseModelTier(v: string | null | undefined): ModelTier | null {
  if (!v) return null;
  const t = v.trim().toLowerCase();
  return (TIER_ORDER as readonly string[]).includes(t) ? (t as ModelTier) : null;
}

export interface SubagentUsageOptions {
  /** ms epoch, 포함. */
  from?: number | null;
  /** ms epoch, 포함. */
  to?: number | null;
  /** 프로젝트 이름(별칭 포함으로 풀어쓴다). */
  project?: string | null;
  /** 이 등급보다 높은 모델이면 over_cap=true. 없으면 over_cap 은 null. */
  maxTier?: ModelTier | null;
}

export interface SubagentUsageRow {
  agent_type: string;
  model: string;
  /** 'proxy' = 실제 API 기록으로 판정, 'requests' = proxy 가 없어 훅 기록으로 판정 */
  model_source: 'proxy' | 'requests';
  /** 서브에이전트 실행 수(distinct agent_id) */
  runs: number;
  sessions: number;
  api_requests: number;
  tokens_input: number;
  tokens_output: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  tokens_total: number;
  first_at: number;
  last_at: number;
  over_cap: boolean | null;
}

/**
 * 서브에이전트 사용량을 (agent_type, model) 로 집계한다. runs 내림차순.
 */
export function getSubagentUsage(db: Database, opts: SubagentUsageOptions = {}): SubagentUsageRow[] {
  const where: string[] = ['r.agent_id IS NOT NULL'];
  const params: Array<string | number> = [];
  if (opts.from != null) { where.push('r.timestamp >= ?'); params.push(opts.from); }
  if (opts.to != null) { where.push('r.timestamp <= ?'); params.push(opts.to); }
  if (opts.project) {
    const f = projectNameIn(db, 's.project_name', opts.project);
    where.push(`r.session_id IN (SELECT s.id FROM sessions s WHERE ${f.sql})`);
    params.push(...f.params);
  }

  // 1) 서브에이전트 실행 단위 → 대표 agent_type·훅 기록 모델·시각 범위
  // 2) 실행의 api_request_id 집합(중복 제거) ↔ proxy 실측 모델·토큰
  // 3) 실행의 모델 = proxy 모델 중 가장 많이 쓰인 것, 없으면 훅 기록 모델
  const sql = `
    WITH sub AS (
      SELECT r.session_id, r.agent_id, r.agent_type, r.model, r.api_request_id, r.timestamp
        FROM requests r
       WHERE ${where.join(' AND ')}
    ),
    runs AS (
      SELECT agent_id,
             MAX(session_id)                     AS session_id,
             COALESCE(MAX(agent_type), 'unknown') AS agent_type,
             MIN(timestamp)                      AS first_at,
             MAX(timestamp)                      AS last_at,
             (SELECT s2.model FROM sub s2
               WHERE s2.agent_id = sub.agent_id AND s2.model IS NOT NULL
               GROUP BY s2.model ORDER BY COUNT(*) DESC LIMIT 1) AS hook_model
        FROM sub
       GROUP BY agent_id
    ),
    run_calls AS (
      SELECT DISTINCT sub.agent_id, p.api_request_id, p.model,
             COALESCE(p.tokens_input, 0)          AS ti,
             COALESCE(p.tokens_output, 0)         AS t_out,
             COALESCE(p.cache_creation_tokens, 0) AS tcc,
             COALESCE(p.cache_read_tokens, 0)     AS tcr
        FROM sub
        JOIN proxy_requests p ON p.api_request_id = sub.api_request_id
       WHERE sub.api_request_id IS NOT NULL
    ),
    run_model AS (
      SELECT agent_id,
             (SELECT rc2.model FROM run_calls rc2
               WHERE rc2.agent_id = rc.agent_id AND rc2.model IS NOT NULL
               GROUP BY rc2.model ORDER BY COUNT(*) DESC LIMIT 1) AS proxy_model,
             COUNT(*) AS api_requests,
             SUM(ti) AS ti, SUM(t_out) AS t_out, SUM(tcc) AS tcc, SUM(tcr) AS tcr
        FROM run_calls rc
       GROUP BY agent_id
    )
    SELECT runs.agent_type                                        AS agent_type,
           COALESCE(rm.proxy_model, runs.hook_model, 'unknown')   AS model,
           CASE WHEN rm.proxy_model IS NOT NULL THEN 'proxy' ELSE 'requests' END AS model_source,
           COUNT(*)                                               AS runs,
           COUNT(DISTINCT runs.session_id)                        AS sessions,
           COALESCE(SUM(rm.api_requests), 0)                      AS api_requests,
           COALESCE(SUM(rm.ti), 0)                                AS tokens_input,
           COALESCE(SUM(rm.t_out), 0)                             AS tokens_output,
           COALESCE(SUM(rm.tcc), 0)                               AS cache_creation_tokens,
           COALESCE(SUM(rm.tcr), 0)                               AS cache_read_tokens,
           MIN(runs.first_at)                                     AS first_at,
           MAX(runs.last_at)                                      AS last_at
      FROM runs
      LEFT JOIN run_model rm ON rm.agent_id = runs.agent_id
     GROUP BY 1, 2, 3
     ORDER BY runs DESC, agent_type, model`;

  const rows = db.query(sql).all(...params) as Array<Omit<SubagentUsageRow, 'tokens_total' | 'over_cap'>>;
  const cap = opts.maxTier ? TIER_ORDER.indexOf(opts.maxTier) : -1;
  return rows.map((r) => {
    const tier = modelTier(r.model);
    return {
      ...r,
      tokens_total: r.tokens_input + r.tokens_output + r.cache_creation_tokens + r.cache_read_tokens,
      over_cap: cap < 0 || tier === null ? null : TIER_ORDER.indexOf(tier) > cap,
    };
  });
}
