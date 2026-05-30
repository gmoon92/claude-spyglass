/**
 * /api/meta-docs/* 라우트 — Behavior Definitions 카탈로그 + 동기화 백도어
 *
 * 책임:
 *  - 클라이언트(웹 UI)가 카탈로그+사용 집계를 한 표로 받아볼 수 있게 LEFT JOIN 결과를 노출.
 *  - 명시적 refresh 요청을 받아 동기화를 다시 돌릴 수 있는 백도어 제공.
 *
 * 라우트:
 *  - GET  /api/meta-docs                     — 카탈로그 + 사용 집계 목록
 *      ?type=agent|skill|command (선택)
 *      ?source_root=<absolute path|null>     ('null'이면 글로벌만)
 *      ?includeDeleted=1                     (기본 false)
 *      ?fromTs=<unixMs>                      (선택 — 사용 집계 시간 윈도우 시작)
 *      ?toTs=<unixMs>                        (선택 — 사용 집계 시간 윈도우 끝)
 *      ?project=<name>                       (선택 — sessions JOIN 으로 좁힘)
 *  - POST /api/meta-docs/refresh             — 동기화 재실행
 *      body: {
 *        scope?: 'global'|'project'|'all',
 *        cwd?: string,                  // 단일 cwd (project 동기화)
 *        includeKnownCwds?: boolean,    // 알려진 모든 cwd 일괄 동기화 (모집단 확장)
 *        force?: boolean,               // throttle 우회
 *      }
 *
 * 호출자: api.ts → SYNC_ROUTERS
 *
 * 변경 이력 (migration-plan §B):
 *   `/api/meta-docs/flow` (SQLite ego BFS) 는 폐기되었고 `/api/graph/unified-flow` (Ladybug)
 *   로 단일화됨. 카탈로그 라우트만 본 파일에 남는다. `buildEgoFlowGraph` / `EGO_LAYOUT`
 *   / `buildColumnEntities` / `pctToStrength` / `emitSpokeEntity` 등 ego 보조는 모두 제거.
 *
 * 의존성: storage 카탈로그 함수, meta-docs/synchronizer.
 */

import { existsSync } from 'node:fs';
import type { Database } from 'bun:sqlite';
import { listMetaDocsWithUsage, type MetaDocType } from '@spyglass/storage';
import { jsonResponse } from './_shared';
import { syncCwd, syncGlobalOnce, syncAllKnownCwds, pruneDeadSourceRoots } from '@spyglass/meta-docs';

/** source_root 경로 존재 여부 캐시 — 같은 요청 안에서 반복 stat 호출 방지. */
function buildSourceRootExistsCache(rows: { source_root?: string | null }[]): Map<string, boolean> {
  const cache = new Map<string, boolean>();
  for (const r of rows) {
    const root = r.source_root;
    if (!root || cache.has(root)) continue;
    cache.set(root, existsSync(root));
  }
  return cache;
}

const ALLOWED_TYPES: MetaDocType[] = ['agent', 'skill', 'command'];

/**
 * Unix ms 타임스탬프 쿼리 파라미터 파서.
 * - null/빈 문자열 → undefined (기간 미지정으로 해석)
 * - Number.isFinite 실패 → undefined (기존 폴백 유지)
 */
function parseTs(v: string | null): number | undefined {
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function metaDocsRouter(req: Request, db: Database): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // GET /api/meta-docs — 카탈로그 + 사용 집계
  if (path === '/api/meta-docs' && method === 'GET') {
    const typeParam = url.searchParams.get('type');
    const sourceRootParam = url.searchParams.get('source_root');
    const projectParam = url.searchParams.get('project');
    const includeDeleted = url.searchParams.get('includeDeleted') === '1';
    const fromTs = parseTs(url.searchParams.get('fromTs'));
    const toTs = parseTs(url.searchParams.get('toTs'));

    const type =
      typeParam && (ALLOWED_TYPES as string[]).includes(typeParam)
        ? (typeParam as MetaDocType)
        : undefined;

    let source_root: string | null | undefined;
    if (sourceRootParam === null) source_root = undefined;
    else if (sourceRootParam === 'null' || sourceRootParam === '') source_root = null;
    else source_root = sourceRootParam;

    const project =
      projectParam && projectParam !== '' && projectParam !== 'null' ? projectParam : undefined;

    const data = listMetaDocsWithUsage(db, { type, source_root, includeDeleted, fromTs, toTs, project });

    // source_root_exists: 클라이언트가 ghost 경로와 실제 경로를 구분해
    // 프로젝트 매칭 시 실제 존재하는 경로를 우선 선택할 수 있도록 제공.
    const existsCache = buildSourceRootExistsCache(data);
    const dataWithExists = data.map(r => ({
      ...r,
      source_root_exists: r.source_root != null ? (existsCache.get(r.source_root) ?? false) : null,
    }));

    return jsonResponse({ success: true, data: dataWithExists, meta: { total: dataWithExists.length } });
  }

  // POST /api/meta-docs/refresh
  if (path === '/api/meta-docs/refresh' && method === 'POST') {
    return refreshHandler(req, db);
  }

  return null;
}

async function refreshHandler(req: Request, db: Database): Promise<Response> {
  let body: {
    scope?: string;
    cwd?: string;
    includeKnownCwds?: boolean;
    force?: boolean;
  } = {};
  try {
    if (req.headers.get('content-type')?.includes('application/json')) {
      body = await req.json();
    }
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const scope = body.scope ?? 'all';
  const force = body.force === true;
  const includeKnownCwds = body.includeKnownCwds === true;

  const result: Record<string, unknown> = {};

  // refresh 시마다 ghost source_root 정리 — 이동/삭제된 프로젝트 경로가
  // 프로젝트 매칭에서 우선 선택되는 문제를 해소.
  result.prunedSourceRoots = pruneDeadSourceRoots(db);

  if (scope === 'global' || scope === 'all') {
    result.global = syncGlobalOnce(db, { force });
  }

  if (scope === 'project' || scope === 'all') {
    if (!body.cwd) {
      if (scope === 'project') {
        return jsonResponse(
          {
            success: false,
            error: 'cwd is required for scope=project',
          },
          400,
        );
      }
      // scope=all 이고 cwd 미지정이면 project 단일 동기화는 skip — 대신 includeKnownCwds로 처리.
    } else {
      result.project = syncCwd(db, body.cwd, { force });
    }
  }

  // 모집단 확장: 알려진 모든 cwd 를 일괄 동기화 (orphan Behavior Definitions 카탈로그 등록).
  if (includeKnownCwds && (scope === 'project' || scope === 'all')) {
    const all = syncAllKnownCwds(db, { force });
    result.cwds = all.cwds;
  }

  return jsonResponse({ success: true, data: result });
}
