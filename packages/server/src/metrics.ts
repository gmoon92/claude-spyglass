/**
 * /api/metrics/* 라우트 핸들러
 *
 * @description UI Redesign Phase 2 — Tier 1+2+3 시각 지표 8종 전용 라우터.
 * - 가격($) 환산 없음. 토큰/카운트/비율(0~1) 단위만 노출.
 * - 기존 /api/dashboard, /api/stats/* 응답은 변경하지 않음.
 *
 * 엔드포인트:
 *   GET /api/metrics/model-usage          — 1) 모델 사용량 비율 (Donut)
 *   GET /api/metrics/cache-matrix         — 2) 모델별 캐시 적중률 매트릭스
 *   GET /api/metrics/context-usage        — 3) 컨텍스트 사용률 분포 히스토그램
 *   GET /api/metrics/activity-heatmap     — 4) 7일 × 24시간 활동 격자
 *   GET /api/metrics/turn-distribution    — 5) 세션당 turn 수 분포 + Compaction 발생률
 *   GET /api/metrics/agent-depth          — 6) 에이전트 깊이 분포
 *   GET /api/metrics/tool-categories      — 7) Tool 카테고리 분포
 *   GET /api/metrics/anomalies-timeseries — 8) Anomaly 시계열
 *
 * 공통 쿼리 파라미터:
 *   ?range=24h|7d|30d   (default: 24h)   — 사전 정의 윈도우
 *   ?from=<ms>&to=<ms>                    — 명시적 타임스탬프 (range보다 우선)
 */

import type { Database } from 'bun:sqlite';
import {
  getModelUsageStats,
  getModelCacheMatrix,
  getSessionContextUsage,
  getActivityHeatmap,
  getTurnsPerSession,
  getCompactionSessionCount,
  getActiveSessionCount,
  getAgentCallsPerSession,
  getToolCategoryRawCounts,
  getAnomalyTimeSeriesInputs,
  getBurnRateBuckets,
  getCacheTrendBuckets,
  type AnomalyInputRow,
} from '@spyglass/storage';
import { getModelMaxTokens, getAllModelLimits } from './model-limits';
import { categorizeToolName, ALL_TOOL_CATEGORIES, type ToolCategory } from './tool-category';

// =============================================================================
// 응답 공통 타입
// =============================================================================

interface MetricMeta {
  /** 요청에서 사용된 시간 범위 라벨 ('24h' | '7d' | '30d' | 'custom' | 'all') */
  range: string;
  /** 실제 적용된 from 타임스탬프 (ms, undefined=제한 없음) */
  from?: number;
  /** 실제 적용된 to 타임스탬프 (ms, undefined=제한 없음) */
  to?: number;
  /** 응답 생성 시각 (ms) */
  generated_at: number;
}

interface MetricsResponse<T> {
  success: boolean;
  data: T;
  meta: MetricMeta;
}

// =============================================================================
// 시간 윈도우 파싱
// =============================================================================

/**
 * 쿼리 파라미터 → {from, to, label}
 * 우선순위: from/to 명시 > range > 기본 24h
 */
function parseTimeWindow(url: URL): { from?: number; to?: number; label: string } {
  const fromQ = url.searchParams.get('from');
  const toQ   = url.searchParams.get('to');
  const range = url.searchParams.get('range') || '24h';

  if (fromQ || toQ) {
    return {
      from: fromQ ? parseInt(fromQ, 10) : undefined,
      to:   toQ   ? parseInt(toQ, 10)   : undefined,
      label: 'custom',
    };
  }

  const now = Date.now();
  switch (range) {
    case '24h':
      return { from: now - 24 * 60 * 60 * 1000, to: now, label: '24h' };
    case '7d':
      return { from: now - 7  * 24 * 60 * 60 * 1000, to: now, label: '7d' };
    case '30d':
      return { from: now - 30 * 24 * 60 * 60 * 1000, to: now, label: '30d' };
    case 'all':
      return { from: undefined, to: undefined, label: 'all' };
    default:
      return { from: now - 24 * 60 * 60 * 1000, to: now, label: '24h' };
  }
}

// =============================================================================
// JSON 응답 헬퍼
// =============================================================================

function jsonResponse<T>(body: MetricsResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function buildMeta(window: { from?: number; to?: number; label: string }): MetricMeta {
  return {
    range: window.label,
    from: window.from,
    to: window.to,
    generated_at: Date.now(),
  };
}

// =============================================================================
// 라우터
// =============================================================================

/**
 * /api/metrics/* 라우터.
 * 매칭된 경로면 Response, 아니면 null 반환 (api.ts에서 fall-through 후 404 처리).
 */
export async function metricsRouter(req: Request, db: Database): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (method !== 'GET' || !path.startsWith('/api/metrics/')) return null;

  const window = parseTimeWindow(url);
  const meta = buildMeta(window);

  // -------------------------------------------------------------------------
  // 1) 모델 사용량 비율 (Donut)
  // -------------------------------------------------------------------------
  if (path === '/api/metrics/model-usage') {
    const rows = getModelUsageStats(db, window.from, window.to);
    const total = rows.reduce((s, r) => s + r.request_count, 0);
    const data = rows.map(r => ({
      model: r.model,
      request_count: r.request_count,
      total_tokens: r.total_tokens,
      avg_tokens: Math.round(r.avg_tokens),
      percentage: total > 0 ? Math.round((r.request_count / total) * 1000) / 10 : 0,
    }));
    return jsonResponse({ success: true, data, meta });
  }

  // -------------------------------------------------------------------------
  // 2) 모델별 캐시 적중률 매트릭스
  // -------------------------------------------------------------------------
  if (path === '/api/metrics/cache-matrix') {
    const rows = getModelCacheMatrix(db, window.from, window.to);
    const data = rows.map(r => {
      const denom = r.total_input + r.cache_read;
      const hit_rate = denom > 0 ? r.cache_read / denom : 0;
      return {
        model: r.model,
        total_input: r.total_input,
        cache_read: r.cache_read,
        cache_create: r.cache_create,
        hit_rate: Math.round(hit_rate * 10_000) / 10_000,
      };
    });
    return jsonResponse({ success: true, data, meta });
  }

  // -------------------------------------------------------------------------
  // 3) 컨텍스트 사용률 분포 히스토그램
  // -------------------------------------------------------------------------
  if (path === '/api/metrics/context-usage') {
    const rows = getSessionContextUsage(db, window.from, window.to);
    const buckets = [
      { label: '<50%',    range: [0,    0.5]  as [number, number], session_count: 0 },
      { label: '50-80%',  range: [0.5,  0.8]  as [number, number], session_count: 0 },
      { label: '80-95%',  range: [0.8,  0.95] as [number, number], session_count: 0 },
      { label: '>95%',    range: [0.95, Infinity] as [number, number], session_count: 0 },
    ];
    for (const r of rows) {
      const max = getModelMaxTokens(r.model);
      const ratio = max > 0 ? r.final_tokens / max : 0;
      const bucket = buckets.find(b => ratio >= b.range[0] && ratio < b.range[1]) ?? buckets[buckets.length - 1];
      bucket.session_count++;
    }
    return jsonResponse({
      success: true,
      data: {
        buckets,
        total: rows.length,
        model_limits: getAllModelLimits(),
      },
      meta,
    });
  }

  // -------------------------------------------------------------------------
  // 4) 시간대별 활동 heatmap
  // -------------------------------------------------------------------------
  if (path === '/api/metrics/activity-heatmap') {
    const rows = getActivityHeatmap(db, window.from, window.to);

    // 7×24 격자 초기화
    const cells: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let total = 0;
    for (const r of rows) {
      if (r.weekday >= 0 && r.weekday < 7 && r.hour >= 0 && r.hour < 24) {
        cells[r.weekday][r.hour] = r.count;
        total += r.count;
      }
    }
    return jsonResponse({
      success: true,
      data: {
        cells,
        total,
        weekday_labels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      },
      meta,
    });
  }

  // -------------------------------------------------------------------------
  // 5) 세션당 turn 수 분포 + Compaction 발생률
  // -------------------------------------------------------------------------
  if (path === '/api/metrics/turn-distribution') {
    const turns = getTurnsPerSession(db, window.from, window.to);
    const compacted = getCompactionSessionCount(db, window.from, window.to);
    const totalSessions = getActiveSessionCount(db, window.from, window.to);

    // 버킷화
    const turnBuckets = [
      { bucket: '1-3',   min: 1,   max: 3,        session_count: 0 },
      { bucket: '4-10',  min: 4,   max: 10,       session_count: 0 },
      { bucket: '11-25', min: 11,  max: 25,       session_count: 0 },
      { bucket: '26-50', min: 26,  max: 50,       session_count: 0 },
      { bucket: '51+',   min: 51,  max: Infinity, session_count: 0 },
    ];
    for (const t of turns) {
      const b = turnBuckets.find(x => t.turn_count >= x.min && t.turn_count <= x.max);
      if (b) b.session_count++;
    }

    const compactionRate =
      totalSessions.total_sessions > 0
        ? compacted.compacted_sessions / totalSessions.total_sessions
        : 0;

    return jsonResponse({
      success: true,
      data: {
        turn_distribution: turnBuckets.map(b => ({
          bucket: b.bucket,
          session_count: b.session_count,
        })),
        compaction_rate: Math.round(compactionRate * 10_000) / 10_000,
        compacted_sessions: compacted.compacted_sessions,
        total_sessions: totalSessions.total_sessions,
      },
      meta,
    });
  }

  // -------------------------------------------------------------------------
  // 6) 에이전트 깊이 분포
  // -------------------------------------------------------------------------
  if (path === '/api/metrics/agent-depth') {
    const sessions = getAgentCallsPerSession(db, window.from, window.to);

    // depth 분포
    const depthMap = new Map<number, number>();
    let no_agent = 0;
    let single_agent = 0;
    let multi_agent = 0;
    for (const s of sessions) {
      depthMap.set(s.agent_calls, (depthMap.get(s.agent_calls) || 0) + 1);
      if (s.agent_calls === 0) no_agent++;
      else if (s.agent_calls === 1) single_agent++;
      else multi_agent++;
    }

    const distribution = Array.from(depthMap.entries())
      .map(([depth, request_count]) => ({ depth, request_count }))
      .sort((a, b) => a.depth - b.depth);

    return jsonResponse({
      success: true,
      data: {
        distribution,
        summary: {
          no_agent,
          single_agent,
          multi_agent,
          total: sessions.length,
        },
      },
      meta,
    });
  }

  // -------------------------------------------------------------------------
  // 7) Tool 카테고리 분포
  // -------------------------------------------------------------------------
  if (path === '/api/metrics/tool-categories') {
    const rows = getToolCategoryRawCounts(db, window.from, window.to);
    const buckets = new Map<ToolCategory, number>();
    for (const c of ALL_TOOL_CATEGORIES) buckets.set(c, 0);
    let total = 0;
    for (const r of rows) {
      const cat = categorizeToolName(r.tool_name);
      buckets.set(cat, (buckets.get(cat) || 0) + r.request_count);
      total += r.request_count;
    }
    const data = ALL_TOOL_CATEGORIES.map(category => ({
      category,
      request_count: buckets.get(category) || 0,
      percentage: total > 0
        ? Math.round((buckets.get(category)! / total) * 1000) / 10
        : 0,
    }));
    return jsonResponse({ success: true, data, meta });
  }

  // -------------------------------------------------------------------------
  // 8) Anomaly 시계열
  // -------------------------------------------------------------------------
  if (path === '/api/metrics/anomalies-timeseries') {
    const bucket = url.searchParams.get('bucket') || 'hour'; // 'hour' | 'day'
    const rows = getAnomalyTimeSeriesInputs(db, window.from, window.to);
    const data = computeAnomalyTimeSeries(rows, bucket as 'hour' | 'day');
    return jsonResponse({ success: true, data, meta });
  }

  // -------------------------------------------------------------------------
  // 9) Burn Rate (left-panel-observability-revamp ADR-003)
  //    24h 1h 버킷 24개 + 어제 동시각 윈도우 비교
  // -------------------------------------------------------------------------
  if (path === '/api/metrics/burn-rate') {
    const data = computeBurnRate(db, window);
    return jsonResponse({ success: true, data, meta });
  }

  // -------------------------------------------------------------------------
  // 10) Cache Trend (left-panel-observability-revamp ADR-003)
  //     24h 1h 버킷 hit_rate 추세 + 절감 토큰 합
  // -------------------------------------------------------------------------
  if (path === '/api/metrics/cache-trend') {
    const data = computeCacheTrend(db, window);
    return jsonResponse({ success: true, data, meta });
  }

  return null;
}

// =============================================================================
// Burn Rate / Cache Trend 계산 (라우트 핸들러에서 분리 — 가독성)
// =============================================================================

/** 1h 단위로 정렬된 buckets를 N개 슬롯으로 채운다 (빈 버킷=0).
 *  builder가 만드는 출력 타입을 그대로 보존해 호출 측 cast가 불필요하도록 한다. */
function fillHourSlots<T extends { hour_ts: number }, U>(
  rawRows: T[],
  fromMs: number,
  toMs: number,
  builder: (hour_ts: number, row: T | undefined) => U
): U[] {
  const HOUR = 3_600_000;
  const startSlot = Math.floor(fromMs / HOUR) * HOUR;
  const endSlot   = Math.floor(toMs / HOUR) * HOUR;
  const map = new Map<number, T>();
  for (const r of rawRows) map.set(r.hour_ts, r);
  const out: U[] = [];
  for (let ts = startSlot; ts <= endSlot; ts += HOUR) {
    out.push(builder(ts, map.get(ts)));
  }
  return out;
}

interface BurnRatePayload {
  buckets: Array<{ hour_ts: number; tokens: number; requests: number }>;
  current_total: number;
  yesterday_same_window: number;
  delta_pct: number | null;
}

function computeBurnRate(
  db: Database,
  window: { from?: number; to?: number; label: string }
): BurnRatePayload {
  const now = Date.now();
  const toMs   = window.to   ?? now;
  const fromMs = window.from ?? (toMs - 24 * 3_600_000);
  const spanMs = toMs - fromMs;

  // 오늘 윈도우 버킷
  const todayRaw = getBurnRateBuckets(db, fromMs, toMs);
  const buckets: BurnRatePayload['buckets'] = fillHourSlots(todayRaw, fromMs, toMs, (hour_ts, r) => ({
    hour_ts,
    tokens: r?.tokens ?? 0,
    requests: r?.requests ?? 0,
  }));

  const current_total = buckets.reduce((s, b) => s + b.tokens, 0);

  // 어제 동시각 윈도우 (정확히 24h 이전)
  const yFrom = fromMs - 24 * 3_600_000;
  const yTo   = toMs   - 24 * 3_600_000;
  // 동일 spanMs 보장 (윈도우가 24h 미만이어도 같은 길이)
  if (yFrom + spanMs !== yTo) {
    // no-op: 안전하게 yFrom..yFrom+spanMs 사용
  }
  const yesterdayRaw = getBurnRateBuckets(db, yFrom, yTo);
  const yesterday_same_window = yesterdayRaw.reduce((s, r) => s + r.tokens, 0);

  let delta_pct: number | null = null;
  if (yesterday_same_window > 0) {
    delta_pct = Math.round(
      ((current_total - yesterday_same_window) / yesterday_same_window) * 1000
    ) / 10;
  } else if (current_total > 0) {
    delta_pct = null; // 어제 0 → 비교 의미 없음
  }

  return { buckets, current_total, yesterday_same_window, delta_pct };
}

interface CacheTrendPayload {
  buckets: Array<{ hour_ts: number; hit_rate: number | null; savings_tokens: number }>;
  hit_rate_now: number | null;
  savings_tokens_total: number;
}

function computeCacheTrend(
  db: Database,
  window: { from?: number; to?: number; label: string }
): CacheTrendPayload {
  const now = Date.now();
  const toMs   = window.to   ?? now;
  const fromMs = window.from ?? (toMs - 24 * 3_600_000);

  const raw = getCacheTrendBuckets(db, fromMs, toMs);
  const buckets: CacheTrendPayload['buckets'] = fillHourSlots(raw, fromMs, toMs, (hour_ts, r) => ({
    hour_ts,
    hit_rate: r?.hit_rate ?? null,
    savings_tokens: r?.savings_tokens ?? 0,
  }));

  // 마지막 valid hit_rate (= 최신)
  let hit_rate_now: number | null = null;
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (buckets[i].hit_rate !== null) { hit_rate_now = buckets[i].hit_rate; break; }
  }
  const savings_tokens_total = buckets.reduce((s, b) => s + b.savings_tokens, 0);

  return { buckets, hit_rate_now, savings_tokens_total };
}

// =============================================================================
// Anomaly 계산 (anomaly.js와 동일 알고리즘 — 서버 이식)
// =============================================================================

/**
 * detectAnomalies 동등 로직:
 *  - spike: 세션별 prompt tokens_input 평균의 200% 초과
 *  - loop:  turn_id 내 동일 tool_name 연속 3회 이상
 *  - slow:  tool_call duration_ms가 전체 P95 초과
 * 그 후 시간 버킷(hour/day)으로 카운트.
 */
function computeAnomalyTimeSeries(
  rows: AnomalyInputRow[],
  bucket: 'hour' | 'day'
): Array<{ timestamp: string; spike: number; loop: number; slow: number }> {
  // 1. 세션별 prompt 평균 (spike 기준)
  const sessionPromptInputs = new Map<string, number[]>();
  for (const r of rows) {
    if (r.type === 'prompt' && r.tokens_input > 0) {
      const arr = sessionPromptInputs.get(r.session_id) || [];
      arr.push(r.tokens_input);
      sessionPromptInputs.set(r.session_id, arr);
    }
  }
  const sessionAvg = new Map<string, number>();
  for (const [sid, arr] of sessionPromptInputs) {
    if (arr.length >= 2) {
      sessionAvg.set(sid, arr.reduce((s, x) => s + x, 0) / arr.length);
    }
  }

  // 2. 전체 P95 (slow 기준) — type='tool_call' duration_ms > 0
  const durations = rows
    .filter(r => r.type === 'tool_call' && r.duration_ms > 0)
    .map(r => r.duration_ms)
    .sort((a, b) => a - b);
  let p95 = 0;
  if (durations.length > 0) {
    const idx = Math.ceil(durations.length * 0.95) - 1;
    p95 = durations[Math.min(idx, durations.length - 1)];
  }

  // 3. loop: turn_id 그룹 → 연속 3회
  const loopFlagged = new Set<string>();
  const turnGroups = new Map<string, AnomalyInputRow[]>();
  for (const r of rows) {
    if (r.type === 'tool_call' && r.turn_id && r.tool_name) {
      const arr = turnGroups.get(r.turn_id) || [];
      arr.push(r);
      turnGroups.set(r.turn_id, arr);
    }
  }
  for (const [, calls] of turnGroups) {
    let streak = 1;
    for (let i = 1; i < calls.length; i++) {
      if (calls[i].tool_name === calls[i - 1].tool_name) {
        streak++;
        if (streak >= 3) {
          for (let j = i - streak + 1; j <= i; j++) {
            loopFlagged.add(calls[j].id);
          }
        }
      } else {
        streak = 1;
      }
    }
  }

  // 4. 버킷별 카운트
  const bucketSizeMs = bucket === 'day' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  const buckets = new Map<number, { spike: number; loop: number; slow: number }>();

  for (const r of rows) {
    const bucketTs = Math.floor(r.timestamp / bucketSizeMs) * bucketSizeMs;
    const cell = buckets.get(bucketTs) || { spike: 0, loop: 0, slow: 0 };

    // spike
    if (r.type === 'prompt' && r.tokens_input > 0) {
      const avg = sessionAvg.get(r.session_id);
      if (avg !== undefined && r.tokens_input > avg * 2) cell.spike++;
    }
    // loop
    if (loopFlagged.has(r.id)) cell.loop++;
    // slow
    if (r.type === 'tool_call' && p95 > 0 && r.duration_ms > p95) cell.slow++;

    buckets.set(bucketTs, cell);
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([ts, v]) => ({
      timestamp: new Date(ts).toISOString(),
      spike: v.spike,
      loop: v.loop,
      slow: v.slow,
    }));
}
