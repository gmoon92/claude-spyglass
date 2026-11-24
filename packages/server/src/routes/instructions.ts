/**
 * /api/instructions 라우트 — 지침 문서 주입 현황 도메인.
 *
 * @description
 *   변경 이유: "지침 문서(CLAUDE.md·rules·메모리 색인) 컨텍스트 비용을 어떤 단위로 노출할지" 정책 변경.
 *   파싱·집계는 storage queries/instruction-footprint.ts 에 있고, 이 파일은 쿼리 파라미터 해석과 응답 포장만 한다.
 *
 *   포함 라우트 (1개):
 *   - GET /api/instructions/footprint?from=&to=&path_prefix=&limit=
 *       from·to     : ms epoch, 둘 다 포함. 둘 다 없으면 최근 7일. 한쪽만 주면 그쪽만 제한.
 *       path_prefix : 지침 파일 경로가 이 문자열로 시작하는 것만(허브 루트 등). 주면 항목에 rel_path 가 붙는다.
 *       limit       : 표본으로 읽을 세션 수(최근 활동 순, 기본 200, 최대 1000)
 *       trend       : 1 이면 reminder_bytes.by_day(일별 추이)도 계산한다. 기본 끔 — 기간 안 모든 요청의 reminder 를 읽어 느리다.
 *
 *   소비자: 허브 cc-docs-refactor 의 문서 진단(문서 단위 주입 바이트·로드 빈도 보조 입력).
 *   의존: @spyglass/storage getInstructionFootprint
 */

import { getInstructionFootprint, FOOTPRINT_DEFAULT_WINDOW_MS } from '@spyglass/storage';
import { jsonResponse, type RouteHandler } from './_shared';

/** 숫자 쿼리 파라미터 — 없거나 숫자가 아니면 undefined (다른 라우트와 같은 관대한 해석). */
function numParam(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export const instructionsRouter: RouteHandler = (_req, db, url, path, method) => {
  if (path !== '/api/instructions/footprint' || method !== 'GET') return null;

  let fromTs = numParam(url, 'from');
  const toTs = numParam(url, 'to');
  if (fromTs === undefined && toTs === undefined) fromTs = Date.now() - FOOTPRINT_DEFAULT_WINDOW_MS;
  const pathPrefix = url.searchParams.get('path_prefix') || undefined;

  const { sampled_sessions, load_events, ...data } = getInstructionFootprint(db, {
    fromTs,
    toTs,
    pathPrefix,
    sessionLimit: numParam(url, 'limit'),
    includeTrend: url.searchParams.get('trend') === '1',
  });
  return jsonResponse({
    success: true,
    data: { window: { from: fromTs ?? null, to: toTs ?? null }, path_prefix: pathPrefix ?? null, ...data },
    meta: { sampled_sessions, load_events },
  });
};
