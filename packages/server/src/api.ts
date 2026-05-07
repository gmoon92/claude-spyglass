/**
 * REST API Router — fan-out 디스패처.
 *
 * @description
 *   /api/* 엔드포인트의 진입점. 도메인별 routes/* 라우터를 차례로 시도한 뒤
 *   첫 non-null 응답을 반환하는 fan-out 패턴.
 *
 * srp-redesign Phase 2: 기존 api.ts(406줄, 모든 라우트 혼재)를 routes/* 7개 파일로 분해.
 *   각 라우터는 변경 이유가 다른 독립 도메인을 담당:
 *   - routes/sessions.ts       — 세션 도메인 (9개 라우트)
 *   - routes/requests.ts       — Request 도메인 (3개 라우트)
 *   - routes/stats.ts          — 통계 도메인 (7개 라우트)
 *   - routes/dashboard.ts      — 대시보드 + 응답 캐시
 *   - routes/events.ts         — Wildcard hook 이벤트 (3개 라우트)
 *   - routes/proxy.ts          — Proxy 도메인 (3개 라우트)
 *   - routes/system-prompts.ts — System Prompt 카탈로그 (2개 라우트)
 *   - metrics.ts (별도)        — UI Redesign Phase 2 시각 지표 (8개 라우트)
 *
 *   이 파일의 변경 이유: "라우터 등록·우선순위 변경" 또는 "신규 도메인 라우터 추가".
 *   각 라우트의 비즈니스 로직 변경은 routes/* 해당 파일에서만 발생 (SRP 준수).
 */

import type { Database } from 'bun:sqlite';
import { metricsRouter } from './metrics';
import { jsonResponse } from './routes/_shared';
import { sessionsRouter } from './routes/sessions';
import { requestsRouter } from './routes/requests';
import { statsRouter } from './routes/stats';
import { dashboardRouter, invalidateDashboardCache } from './routes/dashboard';
import { eventsRouter } from './routes/events';
import { proxyRouter } from './routes/proxy';
import { systemPromptsRouter } from './routes/system-prompts';
import { metaDocsRouter } from './routes/meta-docs';

// 외부 호환: invalidateDashboardCache는 dashboard 라우터로 이전됐으나
// 기존 import 경로(`./api`)를 보존하기 위해 re-export.
export { invalidateDashboardCache };

// =============================================================================
// 라우터 fan-out
// =============================================================================

/**
 * 동기 도메인 라우터 목록 — 첫 non-null 응답이 최종 응답.
 *
 * 우선순위 주의:
 *   sessionsRouter는 catch-all 라우트(`/api/sessions/:id`)를 포함하므로
 *   하위 경로(/active, /:id/requests 등)가 같은 파일 안에서 먼저 매칭되어야 함.
 *   파일 간 순서는 도메인 분리도 명확하면 서로 영향 없음.
 */
const SYNC_ROUTERS = [
  sessionsRouter,
  requestsRouter,
  statsRouter,
  dashboardRouter,
  eventsRouter,
  proxyRouter,
  systemPromptsRouter,
];

/**
 * API 요청 라우터 — domain별 routes/* 를 차례로 시도.
 */
export async function apiRouter(req: Request, db: Database): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // /api/metrics/* — 별도 비동기 라우터 (UI Redesign Phase 2 시각 지표)
  const metricsResponse = await metricsRouter(req, db);
  if (metricsResponse) return metricsResponse;

  // /api/meta-docs/* — 비동기 라우터 (POST refresh 본문 파싱이 async)
  const metaDocsResponse = await metaDocsRouter(req, db);
  if (metaDocsResponse) return metaDocsResponse;

  for (const handler of SYNC_ROUTERS) {
    const res = handler(req, db, url, path, method);
    if (res) return res;
  }

  return jsonResponse({ success: false, error: 'API endpoint not found' }, 404);
}
