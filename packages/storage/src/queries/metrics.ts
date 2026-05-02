/**
 * Observability Metrics Queries (UI Redesign Phase 2)
 *
 * @description 신규 시각 지표(Tier 1+2+3) 전용 SELECT 쿼리 모음.
 * - DB 스키마 변경 없음 (기존 sessions/requests/claude_events 컬럼만 사용)
 * - 모든 함수 SELECT 전용, 기존 인덱스 활용
 * - 가격($) 환산 없음 — 토큰/카운트 단위 raw 데이터만 반환
 *
 * 지표 매핑:
 *  Tier 1
 *    1) getModelUsageStats          — 모델 사용량 비율 (Donut)
 *    2) getModelCacheMatrix         — 모델별 캐시 적중률 매트릭스
 *    3) getSessionContextUsage      — 세션 final 토큰(컨텍스트 사용률 분포 입력)
 *  Tier 2
 *    4) getActivityHeatmap          — 7일 × 24시간 격자
 *    5) getTurnDistributionStats    — 세션당 turn 수 분포 + Compaction 발생률
 *    6) getAgentDepthDistribution   — 에이전트 깊이 분포
 *  Tier 3
 *    7) getToolCategoryRawCounts    — tool_name별 호출 수(카테고리 분류는 서버 라우트에서 수행)
 *    8) getAnomalyTimeSeriesInputs  — Anomaly 시계열용 raw 데이터
 */

import type { Database } from 'bun:sqlite';

// =============================================================================
// 타입
// =============================================================================

export interface ModelUsageRow {
  model: string;
  request_count: number;
  total_tokens: number;
  avg_tokens: number;
}

export interface ModelCacheMatrixRow {
  model: string;
  total_input: number;
  cache_read: number;
  cache_create: number;
}

export interface SessionContextUsageRow {
  session_id: string;
  model: string | null;
  final_tokens: number;
}

export interface ActivityHeatmapRow {
  weekday: number; // 0=Sun ~ 6=Sat (SQLite strftime('%w'))
  hour: number;   // 0~23
  count: number;
}

export interface TurnsPerSessionRow {
  session_id: string;
  turn_count: number;
}

export interface ToolCategoryRawRow {
  tool_name: string;
  request_count: number;
}

/** Burn Rate 1시간 버킷 (left-panel-observability-revamp ADR-003) */
export interface BurnRateBucketRow {
  /** 버킷 시작 ms (UTC, 1h 정렬) */
  hour_ts: number;
  /** prompt 레코드 tokens_total 합 (tokens_confidence='high' 한정) */
  tokens: number;
  /** prompt 레코드 수 */
  requests: number;
}

/** Cache Trend 1시간 버킷 (left-panel-observability-revamp ADR-003) */
export interface CacheTrendBucketRow {
  hour_ts: number;
  /** cache_read / (tokens_input + cache_read), denom=0이면 null */
  hit_rate: number | null;
  /** cache_read_tokens (절감 토큰 = 캐시로 재사용된 input) */
  savings_tokens: number;
}

export interface AnomalyInputRow {
  id: string;
  session_id: string;
  turn_id: string | null;
  type: string;
  tool_name: string | null;
  timestamp: number;
  tokens_input: number;
  duration_ms: number;
}

// =============================================================================
// 공통 유틸 — 시간 윈도우 WHERE
// =============================================================================

/**
 * fromTs/toTs 조건을 WHERE 조각으로 변환 (column명 지정 가능).
 * 인자는 SQL params 배열에 push, 반환은 SQL 조각.
 */
function buildTimeWindow(
  column: string,
  fromTs: number | undefined,
  toTs: number | undefined,
  params: number[]
): string[] {
  const conds: string[] = [];
  if (fromTs !== undefined) { conds.push(`${column} >= ?`); params.push(fromTs); }
  if (toTs   !== undefined) { conds.push(`${column} <= ?`); params.push(toTs); }
  return conds;
}

// =============================================================================
// Tier 1
// =============================================================================

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

// =============================================================================
// Tier 2
// =============================================================================

/**
 * 4) 시간대별 활동 heatmap (7일 × 24시간)
 *
 * - 모든 request 기준 (pre_tool 제외)
 * - SQLite strftime: '%w'=요일(0=Sun), '%H'=시
 * - timestamp는 ms 단위라 1000으로 나눠 unixepoch 변환
 */
export function getActivityHeatmap(
  db: Database,
  fromTs?: number,
  toTs?: number
): ActivityHeatmapRow[] {
  const params: number[] = [];
  const conds = ["(event_type IS NULL OR event_type != 'pre_tool' OR tool_name = 'Agent')"];
  conds.push(...buildTimeWindow('timestamp', fromTs, toTs, params));

  return db.query(`
    SELECT
      CAST(strftime('%w', timestamp / 1000, 'unixepoch', 'localtime') AS INTEGER) AS weekday,
      CAST(strftime('%H', timestamp / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
      COUNT(*) AS count
    FROM requests
    WHERE ${conds.join(' AND ')}
    GROUP BY weekday, hour
    ORDER BY weekday, hour
  `).all(...params) as ActivityHeatmapRow[];
}

/**
 * 5-1) 세션당 turn 수
 *
 * - turn_id distinct count, type='prompt' 기준 (turn = prompt 단위)
 */
export function getTurnsPerSession(
  db: Database,
  fromTs?: number,
  toTs?: number
): TurnsPerSessionRow[] {
  const params: number[] = [];
  const conds = ["type = 'prompt'", 'turn_id IS NOT NULL'];
  conds.push(...buildTimeWindow('timestamp', fromTs, toTs, params));

  return db.query(`
    SELECT session_id, COUNT(DISTINCT turn_id) AS turn_count
    FROM requests
    WHERE ${conds.join(' AND ')}
    GROUP BY session_id
  `).all(...params) as TurnsPerSessionRow[];
}

/**
 * 5-2) Compaction 발생 세션 수
 *
 * - claude_events PreCompact / PostCompact 이벤트 보유 세션 수
 * - "PreCompact 또는 PostCompact 1건 이상" = compaction 발생 세션
 * - 분모(total_sessions)와 동일한 시간 윈도우 적용을 위해
 *   해당 세션이 같은 윈도우에서 prompt 활동이 있는 세션으로 한정한다.
 *   (window 외 compaction이 분자에 잡혀 1.0 초과 발생을 방지)
 */
export function getCompactionSessionCount(
  db: Database,
  fromTs?: number,
  toTs?: number
): { compacted_sessions: number } {
  const params: number[] = [];
  const eventConds = ["ce.event_type IN ('PreCompact', 'PostCompact')"];
  eventConds.push(...buildTimeWindow('ce.timestamp', fromTs, toTs, params));

  // 활성 세션(prompt 활동 있는 세션) 동일 윈도우와 교집합
  const sessionConds = ["r.type = 'prompt'", 'r.turn_id IS NOT NULL'];
  sessionConds.push(...buildTimeWindow('r.timestamp', fromTs, toTs, params));

  return db.query(`
    SELECT COUNT(DISTINCT ce.session_id) AS compacted_sessions
    FROM claude_events ce
    WHERE ${eventConds.join(' AND ')}
      AND EXISTS (
        SELECT 1 FROM requests r
        WHERE r.session_id = ce.session_id
          AND ${sessionConds.join(' AND ')}
      )
  `).get(...params) as { compacted_sessions: number };
}

/**
 * 5-3) 활성/대상 세션 수 (compaction_rate 분모)
 *
 * - prompt 레코드를 가진 세션 = "분석 대상 세션"
 *   (turn_id가 부여되어 turn 분포 분모와 동일)
 */
export function getActiveSessionCount(
  db: Database,
  fromTs?: number,
  toTs?: number
): { total_sessions: number } {
  const params: number[] = [];
  const conds = ["type = 'prompt'", 'turn_id IS NOT NULL'];
  conds.push(...buildTimeWindow('timestamp', fromTs, toTs, params));

  return db.query(`
    SELECT COUNT(DISTINCT session_id) AS total_sessions
    FROM requests
    WHERE ${conds.join(' AND ')}
  `).get(...params) as { total_sessions: number };
}

/**
 * 6) 에이전트 깊이 분포 — 세션당 Agent 호출 수
 *
 * - tool_name='Agent' 카운트
 * - 깊이 정의(0/1/multi) 매핑은 라우트 단계
 */
export function getAgentCallsPerSession(
  db: Database,
  fromTs?: number,
  toTs?: number
): Array<{ session_id: string; agent_calls: number }> {
  const params: number[] = [];
  const conds = ["type = 'prompt' OR type = 'tool_call'"];
  conds.push(...buildTimeWindow('timestamp', fromTs, toTs, params));

  // 세션 단위로 Agent 호출 수 집계 (Agent를 호출하지 않은 세션도 0으로 포함)
  return db.query(`
    SELECT
      session_id,
      SUM(CASE WHEN type = 'tool_call' AND tool_name = 'Agent' THEN 1 ELSE 0 END) AS agent_calls
    FROM requests
    WHERE ${conds.join(' AND ')}
    GROUP BY session_id
  `).all(...params) as Array<{ session_id: string; agent_calls: number }>;
}

// =============================================================================
// Tier 3
// =============================================================================

/**
 * 7) Tool 카테고리 분포 — raw tool_name별 호출 수
 *
 * - 카테고리 매핑은 서버 라우트(tool-category.ts)에서 수행
 * - 여기서는 tool_name만 GROUP BY
 */
export function getToolCategoryRawCounts(
  db: Database,
  fromTs?: number,
  toTs?: number
): ToolCategoryRawRow[] {
  const params: number[] = [];
  const conds = [
    "type = 'tool_call'",
    'tool_name IS NOT NULL',
    "(event_type IS NULL OR event_type = 'tool')",
  ];
  conds.push(...buildTimeWindow('timestamp', fromTs, toTs, params));

  return db.query(`
    SELECT tool_name, COUNT(*) AS request_count
    FROM requests
    WHERE ${conds.join(' AND ')}
    GROUP BY tool_name
  `).all(...params) as ToolCategoryRawRow[];
}

// =============================================================================
// 옵저빌리티 사이드바 (left-panel-observability-revamp)
// =============================================================================

/**
 * Burn Rate — 1시간 버킷 토큰 합 + 요청 수
 *
 * - prompt 레코드 기준 (실제 모델 호출 단위)
 * - tokens_confidence='high'만 합산 (Spyglass SSoT 정책)
 * - hour_ts: floor(timestamp / 3_600_000) * 3_600_000 (UTC 1시간 정렬)
 * - 빈 버킷은 SQL 결과에 없으므로 응답 단계에서 0으로 채운다
 */
export function getBurnRateBuckets(
  db: Database,
  fromTs?: number,
  toTs?: number
): BurnRateBucketRow[] {
  const params: number[] = [];
  const conds = ["type = 'prompt'", "tokens_confidence = 'high'"];
  conds.push(...buildTimeWindow('timestamp', fromTs, toTs, params));

  return db.query(`
    SELECT
      (CAST(timestamp / 3600000 AS INTEGER) * 3600000) AS hour_ts,
      COALESCE(SUM(tokens_total), 0) AS tokens,
      COUNT(*)                       AS requests
    FROM requests
    WHERE ${conds.join(' AND ')}
    GROUP BY hour_ts
    ORDER BY hour_ts ASC
  `).all(...params) as BurnRateBucketRow[];
}

/**
 * Cache Trend — 1시간 버킷 hit_rate + 절감 토큰
 *
 * - prompt 레코드 기준, tokens_confidence='high'만
 * - hit_rate = cache_read / (tokens_input + cache_read), denom=0이면 null
 * - 빈 버킷은 응답 단계에서 0으로 채운다
 */
export function getCacheTrendBuckets(
  db: Database,
  fromTs?: number,
  toTs?: number
): CacheTrendBucketRow[] {
  const params: number[] = [];
  const conds = ["type = 'prompt'", "tokens_confidence = 'high'"];
  conds.push(...buildTimeWindow('timestamp', fromTs, toTs, params));

  // .all()은 unknown[]을 반환하므로 raw row 타입을 명시적으로 cast 후 map
  const rawRows = db.query(`
    SELECT
      (CAST(timestamp / 3600000 AS INTEGER) * 3600000)  AS hour_ts,
      COALESCE(SUM(tokens_input), 0)                    AS total_input,
      COALESCE(SUM(cache_read_tokens), 0)               AS cache_read,
      COALESCE(SUM(cache_creation_tokens), 0)           AS cache_create
    FROM requests
    WHERE ${conds.join(' AND ')}
    GROUP BY hour_ts
    ORDER BY hour_ts ASC
  `).all(...params) as Array<{
    hour_ts: number;
    total_input: number;
    cache_read: number;
    cache_create: number;
  }>;

  return rawRows.map((r) => {
    const denom = r.total_input + r.cache_read;
    const hit_rate = denom > 0 ? r.cache_read / denom : null;
    return {
      hour_ts: r.hour_ts,
      hit_rate: hit_rate !== null ? Math.round(hit_rate * 10_000) / 10_000 : null,
      savings_tokens: r.cache_read,
    };
  });
}

/**
 * 8) Anomaly 시계열 — raw 입력
 *
 * - spike/loop/slow 판정은 서버 라우트에서 detectAnomalies() 동등 로직 적용
 *   (anomaly.js와 동일 알고리즘 — 200% 평균 초과, turn 내 동일 tool 3회 연속, P95 초과)
 * - 응답 페이로드를 줄이기 위해 필요한 컬럼만 SELECT
 */
export function getAnomalyTimeSeriesInputs(
  db: Database,
  fromTs?: number,
  toTs?: number
): AnomalyInputRow[] {
  const params: number[] = [];
  const conds = [
    "(event_type IS NULL OR event_type != 'pre_tool' OR tool_name = 'Agent')",
  ];
  conds.push(...buildTimeWindow('timestamp', fromTs, toTs, params));

  return db.query(`
    SELECT
      id, session_id, turn_id, type, tool_name, timestamp,
      tokens_input, duration_ms
    FROM requests
    WHERE ${conds.join(' AND ')}
    ORDER BY timestamp ASC
  `).all(...params) as AnomalyInputRow[];
}
