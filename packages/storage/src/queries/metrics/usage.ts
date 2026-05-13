/**
 * Observability Metrics — Tier 1: 모델/세션 사용량 지표.
 *
 * 변경 이유: 모델 비교/컨텍스트 진단 정책 변경 시 함께 손이 가는 묶음.
 *  - getModelUsageStats          (Donut)
 *  - getModelCacheMatrix         (모델별 캐시 적중률 매트릭스)
 *  - getSessionContextUsage      (세션 final 토큰 = 컨텍스트 사용률 분포 입력)
 */

import type { Database } from 'bun:sqlite';
import { buildTimeWindow } from './_shared';
import type {
  ModelUsageRow,
  ModelCacheMatrixRow,
  SessionContextUsageRow,
} from './types';

/**
 * 1) 모델 사용량 비율 (Donut)
 *
 * - prompt 레코드 기준 (실제 모델 호출 1회 = 1 request)
 * - tokens_confidence='high' 만 토큰 합산
 * - percentage는 응답 단계에서 계산 (요청 수 기준)
 */
export function getModelUsageStats(
  db: Database,
  fromTs?: number,
  toTs?: number
): ModelUsageRow[] {
  const params: number[] = [];
  const conds = ["type = 'prompt'", 'model IS NOT NULL', "model NOT LIKE '<%>'"];
  conds.push(...buildTimeWindow('timestamp', fromTs, toTs, params));

  return db.query(`
    SELECT
      model,
      COUNT(*) AS request_count,
      COALESCE(SUM(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE 0 END), 0) AS total_tokens,
      COALESCE(AVG(CASE WHEN tokens_confidence='high' THEN tokens_total ELSE NULL END), 0) AS avg_tokens
    FROM requests
    WHERE ${conds.join(' AND ')}
    GROUP BY model
    ORDER BY request_count DESC
  `).all(...params) as ModelUsageRow[];
}

/**
 * 2) 모델별 캐시 적중률 매트릭스
 *
 * - 행: model
 * - 열: total_input / cache_read / cache_create
 * - hit_rate 계산은 응답 단계에서 (cache_read / (total_input + cache_read))
 */
export function getModelCacheMatrix(
  db: Database,
  fromTs?: number,
  toTs?: number
): ModelCacheMatrixRow[] {
  const params: number[] = [];
  const conds = ["type = 'prompt'", "tokens_confidence = 'high'", 'model IS NOT NULL'];
  conds.push(...buildTimeWindow('timestamp', fromTs, toTs, params));

  return db.query(`
    SELECT
      model,
      COALESCE(SUM(tokens_input), 0)            AS total_input,
      COALESCE(SUM(cache_read_tokens), 0)       AS cache_read,
      COALESCE(SUM(cache_creation_tokens), 0)   AS cache_create
    FROM requests
    WHERE ${conds.join(' AND ')}
    GROUP BY model
    ORDER BY total_input + cache_read DESC
  `).all(...params) as ModelCacheMatrixRow[];
}

/**
 * 3) 컨텍스트 사용률 분포 — 세션 단위 final 토큰
 *
 * - 세션의 마지막 prompt 레코드의 (tokens_input + cache_read + cache_creation)
 *   = 그 시점에 모델이 받은 입력 컨텍스트 크기
 * - 모델별 max_tokens 매핑은 라우트 단계에서 적용 (model-limits.ts).
 *   1M opt-in 정확도를 위해 같은 turn의 proxy_requests.anthropic_beta도 함께 반환한다.
 * - 버킷화도 라우트 단계 (서비스 로직)
 *
 * proxy_beta 서브쿼리: turn당 첫 proxy_request의 anthropic_beta 1건만 채택.
 *   (한 turn 안에서는 동일 클라이언트가 같은 헤더로 호출하므로 첫 행이 대표.)
 *   request.turn_id와 매칭하여 LEFT JOIN — turn_id가 없으면 anthropic_beta=NULL.
 */
export function getSessionContextUsage(
  db: Database,
  fromTs?: number,
  toTs?: number
): SessionContextUsageRow[] {
  const params: number[] = [];
  const conds = ["r.type = 'prompt'", "r.tokens_confidence = 'high'"];
  conds.push(...buildTimeWindow('r.timestamp', fromTs, toTs, params));

  return db.query(`
    WITH proxy_beta AS (
      SELECT turn_id, anthropic_beta FROM (
        SELECT turn_id, anthropic_beta,
               ROW_NUMBER() OVER (PARTITION BY turn_id ORDER BY timestamp ASC) AS rn
        FROM proxy_requests
        WHERE turn_id IS NOT NULL
      ) WHERE rn = 1
    ),
    ranked AS (
      SELECT
        r.session_id,
        r.model,
        pb.anthropic_beta,
        (COALESCE(r.tokens_input, 0) + COALESCE(r.cache_read_tokens, 0) + COALESCE(r.cache_creation_tokens, 0)) AS final_tokens,
        ROW_NUMBER() OVER (PARTITION BY r.session_id ORDER BY r.timestamp DESC) AS rn
      FROM requests r
      LEFT JOIN proxy_beta pb ON pb.turn_id = r.turn_id
      WHERE ${conds.join(' AND ')}
    )
    SELECT session_id, model, anthropic_beta, final_tokens
    FROM ranked
    WHERE rn = 1 AND final_tokens > 0
  `).all(...params) as SessionContextUsageRow[];
}
