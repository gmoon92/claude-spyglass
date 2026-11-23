/**
 * /api/friction 라우트 — 마찰 신호 집계 도메인.
 *
 * @description
 *   변경 이유: "어떤 마찰 신호를 어떤 단위로 노출할지" 정책 변경.
 *   집계 로직은 storage queries/friction.ts 에 있고, 이 파일은 쿼리 파라미터 해석과 응답 포장만 한다.
 *
 *   포함 라우트 (1개):
 *   - GET /api/friction?from=&to=&session_id=&cwd_prefix=&limit=&repeat_min=
 *       from·to    : ms epoch, 둘 다 포함. 둘 다 없으면 최근 24시간. from 만 주면 지금까지.
 *       session_id : 한 세션으로 좁힘
 *       cwd_prefix : 이벤트 cwd 가 이 문자열로 시작하는 것만(허브 루트로 좁힐 때)
 *       limit      : 읽을 이벤트 수 상한(최신순, 기본 5000, 최대 20000)
 *       repeat_min : repeated_failures 로 올릴 최소 연속 횟수(기본 3, 최소 2)
 *
 *   소비자: 허브 task-observer 의 객관 신호 보조 입력.
 *   의존: @spyglass/storage getFrictionSummary
 */

import { getFrictionSummary } from '@spyglass/storage';
import { jsonResponse, type RouteHandler } from './_shared';

/** 기간을 주지 않았을 때의 기본 창. /api/proxy-requests/stats 의 기본 24시간과 같다. */
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 숫자 쿼리 파라미터 — 없거나 숫자가 아니면 undefined (다른 라우트와 같은 관대한 해석). */
function numParam(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export const frictionRouter: RouteHandler = (_req, db, url, path, method) => {
  if (path !== '/api/friction' || method !== 'GET') return null;

  const now = Date.now();
  let fromTs = numParam(url, 'from');
  const toTs = numParam(url, 'to');
  if (fromTs === undefined && toTs === undefined) fromTs = now - DEFAULT_WINDOW_MS;

  const summary = getFrictionSummary(db, {
    fromTs,
    toTs,
    sessionId: url.searchParams.get('session_id') || undefined,
    cwdPrefix: url.searchParams.get('cwd_prefix') || undefined,
    limit: numParam(url, 'limit'),
    repeatMin: numParam(url, 'repeat_min'),
  });

  const { scanned_events, truncated, ...data } = summary;
  return jsonResponse({
    success: true,
    data: { window: { from: fromTs ?? null, to: toTs ?? null }, ...data },
    meta: { scanned_events, truncated },
  });
};
