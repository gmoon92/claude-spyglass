/**
 * /api/metrics/* 라우트 핸들러 — UI Redesign Phase 2 시각 지표 라우터.
 *
 * @description
 *   srp-redesign Phase 3: server/metrics.ts(561줄) 분해 결과.
 *   변경 이유: "신규 메트릭 라우트 추가·기존 라우트의 응답 매핑 변경".
 *
 *   각 라우트는 동일 패턴: storage 호출 → 변환 → jsonResponse.
 *   복잡한 시계열 알고리즘(burn-rate / cache-trend / anomaly)은 calculators/* 로 분리.
 *
 *   가격($) 환산 없음. 토큰/카운트/비율(0~1) 단위만 노출.
 *   /api/dashboard, /api/stats/*는 routes/* 에서 처리 (변경 X).
 *
 * 엔드포인트 (10개):
 *   GET /api/metrics/model-usage          — 모델 사용량 비율 (Donut)
 *   GET /api/metrics/cache-matrix         — 모델별 캐시 적중률
 *   GET /api/metrics/context-usage        — 컨텍스트 사용률 분포 히스토그램
 *   GET /api/metrics/activity-heatmap     — 7일 × 24시간 활동 격자
 *   GET /api/metrics/turn-distribution    — 세션당 turn 수 + Compaction
 *   GET /api/metrics/agent-depth          — 에이전트 깊이 분포
 *   GET /api/metrics/tool-categories      — Tool 카테고리 분포
 *   GET /api/metrics/anomalies-timeseries — Anomaly 시계열
 *   GET /api/metrics/burn-rate            — 24h × 1h 버킷 burn rate
 *   GET /api/metrics/cache-trend          — 24h × 1h 버킷 cache hit rate
 *
 * 공통 쿼리 파라미터:
 *   ?range=24h|7d|30d|all                  (default: 24h)
 *   ?from=<ms>&to=<ms>                     (range보다 우선)
 */

import type { Database } from 'bun:sqlite';
import {
  getActiveSessionCount,
  getActivityHeatmap,
  getAgentCallsPerSession,
  getAnomalyTimeSeriesInputs,
  getCompactionSessionCount,
  getModelCacheMatrix,
  getModelUsageStats,
  getSessionContextUsage,
  getToolCategoryRawCounts,
  getTurnsPerSession,
} from '@spyglass/storage';
import { getModelMaxTokens, getAllModelLimits } from '../model-limits';
import { categorizeToolName, ALL_TOOL_CATEGORIES, type ToolCategory } from '../tool-category';
import { buildMeta, jsonResponse, parseTimeWindow } from './_shared';
import { computeBurnRate } from './calculators/burn-rate';
import { computeCacheTrend } from './calculators/cache-trend';
import { computeAnomalyTimeSeries } from './calculators/anomaly';

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
  // -------------------------------------------------------------------------
  if (path === '/api/metrics/burn-rate') {
    const data = computeBurnRate(db, window);
    return jsonResponse({ success: true, data, meta });
  }

  // -------------------------------------------------------------------------
  // 10) Cache Trend (left-panel-observability-revamp ADR-003)
  // -------------------------------------------------------------------------
  if (path === '/api/metrics/cache-trend') {
    const data = computeCacheTrend(db, window);
    return jsonResponse({ success: true, data, meta });
  }

  return null;
}
