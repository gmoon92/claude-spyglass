/**
 * 세션 요약 라우트 — 허브(Orca 메인)가 워커를 닫을지 판단하는 한 장 요약 (허브 요약 #3).
 *
 * @description
 *   변경 이유: "세션 한 장 요약에 무엇을 담을지" 정책 변경.
 *   routes/sessions.ts 와 분리한 이유: 그 파일의 `/api/sessions/:id` catch-all 과 무관하게 늘리고,
 *   허브 워커 작업과 같은 파일을 건드리지 않기 위함. api.ts 에서 sessionsRouter 보다 앞에 둔다.
 *
 *   포함 라우트 (2개):
 *   - GET /api/sessions/:id/summary
 *   - GET /api/sessions/summary?hub_role=&active=1&limit=   (목록형, limit 기본 20·최대 100)
 *
 *   조합:
 *   - 메타·토큰·스킬/에이전트/명령: @spyglass/storage getSessionSummaryCore (토큰은 365일 요약 테이블)
 *   - 컨텍스트: summarizeSessionAnomalies 의 context_saturation 중 latest_*·stage
 *   - 마찰: getFrictionSummary(sessionId) 의 totals·repeated_failures
 *
 *   소비자: 허브 orca-workflow(workers.sh), 세션 turns 원문 대신 쓰는 요약 입력.
 */

import type { Database } from 'bun:sqlite';
import {
  getFrictionSummary,
  getSessionSummaryCore,
  listSessionIdsForSummary,
} from '@spyglass/storage';
import { summarizeSessionAnomalies } from '../domain/anomaly-enricher';
import { jsonResponse, type RouteHandler } from './_shared';

/** 목록형에서 마찰 이벤트를 세션마다 읽는 상한 — 요약 목적이라 작게 잡는다. */
const LIST_FRICTION_LIMIT = 2000;

function buildSummary(db: Database, sessionId: string, frictionLimit?: number) {
  const core = getSessionSummaryCore(db, sessionId);
  if (!core) return null;

  const sat = summarizeSessionAnomalies(db, sessionId).context_saturation;
  const fr = getFrictionSummary(db, { sessionId, limit: frictionLimit });

  return {
    ...core,
    context: sat
      ? {
        stage: sat.stage ?? null,
        latest_context_tokens: sat.latest_context_tokens ?? null,
        latest_pct: sat.latest_pct ?? null,
        latest_at: sat.latest_at ?? null,
        window_max: sat.window_max ?? null,
      }
      : null,
    failures: {
      ...fr.totals,
      repeated: fr.repeated_failures.map((r) => ({ tool_name: r.tool_name, streak: r.streak, last_at: r.last_at })),
      truncated: fr.truncated,
    },
  };
}

export const sessionSummaryRouter: RouteHandler = (_req, db, url, path, method) => {
  if (method !== 'GET') return null;

  // GET /api/sessions/summary — 목록형
  if (path === '/api/sessions/summary') {
    const rawLimit = url.searchParams.get('limit');
    const limit = rawLimit ? parseInt(rawLimit, 10) : undefined;
    if (rawLimit && (!Number.isFinite(limit) || (limit as number) <= 0)) {
      return jsonResponse({ success: false, error: 'limit must be a positive integer' }, 400);
    }
    const ids = listSessionIdsForSummary(db, {
      hubRole: url.searchParams.get('hub_role') || null,
      active: url.searchParams.get('active') === '1',
      limit,
    });
    const data = ids.map((id) => buildSummary(db, id, LIST_FRICTION_LIMIT)).filter((x) => x !== null);
    return jsonResponse({ success: true, data, meta: { total: data.length } });
  }

  // GET /api/sessions/:id/summary
  const m = path.match(/^\/api\/sessions\/([^/]+)\/summary$/);
  if (m) {
    const data = buildSummary(db, decodeURIComponent(m[1]));
    if (!data) return jsonResponse({ success: false, error: 'Session not found' }, 404);
    return jsonResponse({ success: true, data });
  }

  return null;
};
