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
 * - 모델별 max_tokens 매핑은 라우트 단계에서 적용 (model-limits.ts)
 * - 버킷화도 라우트 단계 (서비스 로직)
 */
export function getSessionContextUsage(
  db: Database,
  fromTs?: number,
  toTs?: number
): SessionContextUsageRow[] {
  const params: number[] = [];
  const conds = ["type = 'prompt'", "tokens_confidence = 'high'"];
  conds.push(...buildTimeWindow('timestamp', fromTs, toTs, params));

  // 세션별 마지막 prompt: timestamp 기준 latest 1건
  return db.query(`
    WITH ranked AS (
      SELECT
        session_id,
        model,
        (COALESCE(tokens_input, 0) + COALESCE(cache_read_tokens, 0) + COALESCE(cache_creation_tokens, 0)) AS final_tokens,
        ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY timestamp DESC) AS rn
      FROM requests
      WHERE ${conds.join(' AND ')}
    )
    SELECT session_id, model, final_tokens
    FROM ranked
    WHERE rn = 1 AND final_tokens > 0
  `).all(...params) as SessionContextUsageRow[];
}
