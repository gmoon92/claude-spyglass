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
 *      ?group=name                           (선택 — (type,name) 당 1행. 같은 스킬이 source_root 별
 *                                             여러 행으로 나와 호출 수를 더하면 부풀던 문제 회피.
 *                                             카탈로그 위치는 source_roots[]·sources[] 로 접는다.
 *                                             기본 응답은 그대로)
 *  - GET  /api/meta-docs/usage/daily         — 스킬·에이전트·명령 일자별 호출/실패 (허브 요약 #1)
 *      ?from=&to=(ms) ?tz=<IANA> ?project= ?kind=skill|agent|command ?name=
 *      원천 stats_meta_usage_hourly(365일 보존). 실패율 = failures / (calls + failures).
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
import { getMetaUsageDaily, isValidTimeZone, listMetaDocsWithUsage, type MetaDocType, type MetaUsageKind } from '@spyglass/storage';
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

    const group = url.searchParams.get('group');
    if (group && group !== 'name') {
      return jsonResponse({ success: false, error: 'group must be "name"' }, 400);
    }
    if (group === 'name') {
      const grouped = groupMetaDocsByName(dataWithExists);
      return jsonResponse({ success: true, data: grouped, meta: { total: grouped.length } });
    }

    return jsonResponse({ success: true, data: dataWithExists, meta: { total: dataWithExists.length } });
  }

  // GET /api/meta-docs/usage/daily
  if (path === '/api/meta-docs/usage/daily' && method === 'GET') {
    const ms = (v: string | null): number | null | undefined =>
      v == null || v === '' ? null : /^\d+$/.test(v) ? Number(v) : undefined;
    const from = ms(url.searchParams.get('from'));
    const to = ms(url.searchParams.get('to'));
    if (from === undefined || to === undefined) {
      return jsonResponse({ success: false, error: 'from/to must be ms epoch integers' }, 400);
    }
    const tz = url.searchParams.get('tz') || null;
    if (tz && !isValidTimeZone(tz)) return jsonResponse({ success: false, error: `invalid tz: ${tz}` }, 400);
    const kind = url.searchParams.get('kind') || null;
    if (kind && !['skill', 'agent', 'command'].includes(kind)) {
      return jsonResponse({ success: false, error: 'kind must be one of skill|agent|command' }, 400);
    }
    const data = getMetaUsageDaily(db, {
      from, to, tz,
      project: url.searchParams.get('project') || null,
      kind: kind as MetaUsageKind | null,
      name: url.searchParams.get('name') || null,
    });
    return jsonResponse({ success: true, data, meta: { total: data.length } });
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

// =============================================================================
// group=name — (type, name) 당 1행으로 접기 (허브 API 함정 2)
// =============================================================================

type MetaDocRowWithExists = ReturnType<typeof listMetaDocsWithUsage>[number] & { source_root_exists: boolean | null };

/**
 * 같은 (type, name) 의 카탈로그 행들을 하나로 접는다.
 *
 * 사용 집계(invocations·tokens·duration·used_at)는 이름·프로젝트 기준이라 각 행에 **같은 값이 복사**돼
 * 있다 — 더하지 않고 하나만 쓴다(행마다 다를 수 없지만 안전하게 최댓값/최솟값).
 * 대표 행(id·description·file_path 등)은 삭제 안 된 행 → 실제 존재하는 source_root → 먼저 나온 행 순.
 */
export function groupMetaDocsByName(rows: MetaDocRowWithExists[]) {
  const groups = new Map<string, MetaDocRowWithExists[]>();
  for (const r of rows) {
    const k = `${r.type}\u0000${r.name}`;
    const g = groups.get(k);
    if (g) g.push(r); else groups.set(k, [r]);
  }
  const rank = (r: MetaDocRowWithExists) => (r.deleted_at == null ? 0 : 2) + (r.source_root_exists === false ? 1 : 0);
  const maxOf = (vs: Array<number | null>) => vs.reduce<number | null>((a, v) => (v == null ? a : a == null ? v : Math.max(a, v)), null);
  const minOf = (vs: Array<number | null>) => vs.reduce<number | null>((a, v) => (v == null ? a : a == null ? v : Math.min(a, v)), null);

  return [...groups.values()].map((g) => {
    const rep = [...g].sort((a, b) => rank(a) - rank(b))[0];
    const roots = [...new Set(g.map((r) => r.source_root).filter((v): v is string => v != null))];
    return {
      id: rep.id,
      type: rep.type,
      name: rep.name,
      description: rep.description,
      user_invocable: rep.user_invocable,
      file_path: rep.file_path,
      invocations: Math.max(...g.map((r) => r.invocations)),
      total_tokens: Math.max(...g.map((r) => r.total_tokens)),
      total_duration_ms: Math.max(...g.map((r) => r.total_duration_ms)),
      last_used_at: maxOf(g.map((r) => r.last_used_at)),
      first_used_at: minOf(g.map((r) => r.first_used_at)),
      first_seen_at: minOf(g.map((r) => r.first_seen_at)),
      deleted_at: g.some((r) => r.deleted_at == null) ? null : maxOf(g.map((r) => r.deleted_at)),
      source_roots: roots,
      sources: g.map((r) => ({
        id: r.id, source: r.source, source_root: r.source_root, file_path: r.file_path,
        deleted_at: r.deleted_at, source_root_exists: r.source_root_exists,
      })),
    };
  });
}
