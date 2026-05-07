/**
 * /api/meta-docs/* 라우트 — 메타 문서 카탈로그 + 히팅률 (v24)
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
 *  - POST /api/meta-docs/refresh             — 동기화 재실행
 *      body: { scope?: 'global'|'project'|'all', cwd?: string, force?: boolean }
 *
 * 호출자: api.ts → SYNC_ROUTERS
 *
 * 의존성: storage 카탈로그 함수, meta-docs/synchronizer.
 */

import type { Database } from 'bun:sqlite';
import {
  listMetaDocsWithUsage,
  type MetaDocType,
} from '@spyglass/storage';
import { jsonResponse } from './_shared';
import { syncCwd, syncGlobalOnce } from '../meta-docs';

const ALLOWED_TYPES: MetaDocType[] = ['agent', 'skill', 'command'];

/**
 * 비동기 라우터(metricsRouter와 동일 패턴) — POST 본문 파싱이 await가 필요해서 RouteHandler(sync)에 안 맞음.
 * api.ts에서 별도 await 분기로 호출한다.
 */
export async function metaDocsRouter(req: Request, db: Database): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // GET /api/meta-docs
  if (path === '/api/meta-docs' && method === 'GET') {
    const typeParam = url.searchParams.get('type');
    const sourceRootParam = url.searchParams.get('source_root');
    const includeDeleted = url.searchParams.get('includeDeleted') === '1';

    const type = typeParam && (ALLOWED_TYPES as string[]).includes(typeParam)
      ? (typeParam as MetaDocType)
      : undefined;

    let source_root: string | null | undefined;
    if (sourceRootParam === null) source_root = undefined;
    else if (sourceRootParam === 'null' || sourceRootParam === '') source_root = null;
    else source_root = sourceRootParam;

    const data = listMetaDocsWithUsage(db, { type, source_root, includeDeleted });
    return jsonResponse({ success: true, data, meta: { total: data.length } });
  }

  // POST /api/meta-docs/refresh
  if (path === '/api/meta-docs/refresh' && method === 'POST') {
    return refreshHandler(req, db);
  }

  return null;
}

async function refreshHandler(req: Request, db: Database): Promise<Response> {
  let body: { scope?: string; cwd?: string; force?: boolean } = {};
  try {
    if (req.headers.get('content-type')?.includes('application/json')) {
      body = await req.json();
    }
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const scope = body.scope ?? 'all';
  const force = body.force === true;

  const result: Record<string, unknown> = {};

  if (scope === 'global' || scope === 'all') {
    result.global = syncGlobalOnce(db, { force });
  }

  if (scope === 'project' || scope === 'all') {
    if (!body.cwd) {
      if (scope === 'project') {
        return jsonResponse({
          success: false,
          error: 'cwd is required for scope=project',
        }, 400);
      }
      // scope=all이고 cwd 미지정이면 project는 skip
    } else {
      result.project = syncCwd(db, body.cwd);
    }
  }

  return jsonResponse({ success: true, data: result });
}
