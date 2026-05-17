/**
 * /api/dashboard 라우트 + 대시보드 응답 캐시.
 *
 * @description
 *   srp-redesign Phase 2: api.ts(406줄) 분해 결과.
 *   변경 이유: "대시보드 위젯 구성·캐시 TTL 변경" — 한 곳에 응집.
 *
 *   캐시는 모듈-스코프 변수로 관리. SSE/proxy 흐름이 INSERT 시 `invalidateDashboardCache()`를
 *   호출하여 다음 요청에서 fresh 응답 보장 (TTL 30s 안이라도 무효화).
 *
 *   외부 노출 함수: invalidateDashboardCache() — proxy/handler.ts·hook 등이 import.
 *   외부 호환 보장을 위해 api.ts에서도 re-export.
 */

import type { Database } from 'bun:sqlite';
import {
  getActiveSessions,
  getAvgPromptDurationMs,
  getProjectStats,
  getRequestStats,
  getRequestStatsByType,
  getSessionStats,
  getStripStats,
  getToolStats,
  LIVE_STALE_THRESHOLD_MS,
} from '@spyglass/storage';
import { jsonResponse, type RouteHandler } from './_shared';

// =============================================================================
// 모듈 스코프 캐시 (변경 이유 단일: TTL · 캐시 키 정책)
// =============================================================================

const DASHBOARD_CACHE_TTL = 30_000;
/** 캐시 무효화 debounce 윈도우 (perf pass) — 활성 세션의 hook 폭풍 중 TTL이 무력화되는 회귀 차단. */
const INVALIDATE_DEBOUNCE_MS = 5_000;

let _dashboardCache: { key: string; data: unknown; ts: number } | null = null;
let _invalidateTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 대시보드 응답 캐시 무효화 — debounce 적용 (perf pass).
 *
 * 배경: 활성 세션 중 매 hook 이벤트마다 무효화되면 TTL 30s 캐시가 사실상 0% hit율로 작동.
 *   결과적으로 매 /api/dashboard 요청이 9개 직렬 storage 쿼리를 재실행 → Bun 이벤트 루프
 *   포화 → 다른 HTTP 요청 stalled.
 *
 * 정책: 첫 무효화 신호 도착 시 5s 타이머 시작. 그 안에 추가 신호가 와도 타이머는 그대로 유지
 *   (extend 안 함 — 'leading-trailing' 패턴이 아니라 'trailing only' 시간 윈도우). 타이머 만료 시
 *   _dashboardCache = null. 결과: 가장 활발한 세션에서도 캐시는 최소 5s마다 한 번만 비워짐.
 *
 * 호출자: dispatch.ts(/collect), events.ts(Stop 훅), proxy/handler/broadcast.ts(proxy INSERT).
 */
export function invalidateDashboardCache(): void {
  // 이미 타이머가 돌고 있으면 추가 신호는 흡수 — 무효화는 한 윈도우에 1회만 발생.
  if (_invalidateTimer !== null) return;
  _invalidateTimer = setTimeout(() => {
    _dashboardCache = null;
    _invalidateTimer = null;
  }, INVALIDATE_DEBOUNCE_MS);
}

/**
 * 테스트/긴급 무효화용 — debounce 우회 + 즉시 캐시 null.
 * 운영 흐름에서는 invalidateDashboardCache()를 우선 사용.
 */
export function invalidateDashboardCacheNow(): void {
  if (_invalidateTimer !== null) {
    clearTimeout(_invalidateTimer);
    _invalidateTimer = null;
  }
  _dashboardCache = null;
}

// =============================================================================
// 라우트
// =============================================================================

export const dashboardRouter: RouteHandler = (_req, db: Database, url, path, method) => {
  // GET /api/dashboard
  if (path === '/api/dashboard' && method === 'GET') {
    const now = Date.now();
    const fromTs = url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!, 10) : undefined;
    const toTs = url.searchParams.get('to') ? parseInt(url.searchParams.get('to')!, 10) : undefined;

    // 캐시 키에 날짜 범위 + 라이브 술어 시간 버킷 포함.
    // 시간 버킷(floor(now/STALE_THRESHOLD)) 변경 = stale 경계 통과 → 자연 무효화.
    // 이렇게 하면 INSERT 트리거 외에도 시간 흐름만으로 LIVE 카운트가 줄어들 때 fresh 응답을 받는다.
    const liveBucket = Math.floor(now / LIVE_STALE_THRESHOLD_MS);
    const cacheKey = `${fromTs || 'all'}-${toTs || 'all'}-${liveBucket}`;
    if (_dashboardCache && _dashboardCache.key === cacheKey && now - _dashboardCache.ts < DASHBOARD_CACHE_TTL) {
      return jsonResponse({ success: true, data: _dashboardCache.data });
    }

    // now를 한 응답 안에서 1회 결정 → 모든 LIVE 카운트가 같은 시각 기준으로 일관 보장.
    const sessionStats = getSessionStats(db, now, fromTs, toTs);
    const requestStats = getRequestStats(db, fromTs, toTs);
    const projectStats = getProjectStats(db, 5, now, fromTs, toTs);
    const toolStats = getToolStats(db, 5, fromTs, toTs);
    const typeStats = getRequestStatsByType(db, fromTs, toTs);
    const activeSessions = getActiveSessions(db, now);
    const _avgRaw = getAvgPromptDurationMs(db, fromTs, toTs);
    const avgDurationMs = _avgRaw > 0 ? Math.round(_avgRaw) : null;
    const stripStats = getStripStats(db, fromTs, toTs);

    const data = {
      summary: {
        totalSessions: sessionStats.total_sessions,
        totalRequests: requestStats.total_requests,
        totalTokens: requestStats.total_tokens,
        activeSessions: activeSessions.length,
        avgDurationMs,
        p95DurationMs: stripStats.p95_duration_ms,
        errorRate: stripStats.error_rate,
      },
      sessions: sessionStats,
      requests: requestStats,
      projects: projectStats,
      tools: toolStats,
      types: typeStats,
      active: activeSessions,
    };
    _dashboardCache = { key: cacheKey, data, ts: now };
    return jsonResponse({ success: true, data });
  }

  return null;
};


