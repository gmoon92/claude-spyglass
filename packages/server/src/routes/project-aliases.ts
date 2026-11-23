/**
 * /api/projects/aliases 라우트 — 프로젝트 별칭 관리 (Migration 070).
 *
 * @description
 *   변경 이유: "프로젝트 이름 변경 대응 정책(별칭 등록·삭제 방식)" 변경.
 *   저장·검증은 storage queries/project-alias.ts 에 있고, 이 파일은 요청 해석과 응답 포장만 한다.
 *
 *   포함 라우트 (3개):
 *   - GET    /api/projects/aliases          — 등록된 별칭 목록
 *   - POST   /api/projects/aliases          — 등록. body: { alias, project_name, note? } (같은 alias 면 덮어씀)
 *   - DELETE /api/projects/aliases/:alias   — 삭제 (삭제하면 그 이름의 이력은 다시 따로 집계된다)
 *
 *   alias = 옛 이름(sessions.project_name 에 남은 값), project_name = 현재 이름.
 *   등록·삭제 즉시 반영된다 — 읽을 때 풀어쓰므로 sessions 행은 바뀌지 않는다.
 *
 *   라우트 충돌 주의: sessions 라우터의 `/api/projects/:name/sessions`·`/tool-stats` 는 두 번째 세그먼트가
 *   더 붙는 경로라 `/api/projects/aliases` 와 겹치지 않는다.
 *
 *   의존: @spyglass/storage listProjectAliases / upsertProjectAlias / deleteProjectAlias
 */

import { deleteProjectAlias, listProjectAliases, upsertProjectAlias } from '@spyglass/storage';
import type { Database } from 'bun:sqlite';
import { jsonResponse } from './_shared';

const ALIASES_PATH = '/api/projects/aliases';
const ALIAS_ITEM_PREFIX = `${ALIASES_PATH}/`;

/**
 * 비동기 라우터 — POST 본문 파싱이 async 라 meta-docs 라우터와 같은 형태로 둔다(api.ts 에서 await).
 * 매칭되지 않으면 null.
 */
export async function projectAliasesRouter(req: Request, db: Database): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (path === ALIASES_PATH && method === 'GET') {
    const data = listProjectAliases(db);
    return jsonResponse({ success: true, data, meta: { total: data.length } });
  }

  if (path === ALIASES_PATH && method === 'POST') {
    let body: { alias?: unknown; project_name?: unknown; note?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
    }
    if (typeof body.alias !== 'string' || typeof body.project_name !== 'string') {
      return jsonResponse({ success: false, error: 'alias and project_name must be strings' }, 400);
    }
    const result = upsertProjectAlias(db, {
      alias: body.alias,
      project_name: body.project_name,
      note: typeof body.note === 'string' ? body.note : null,
    });
    if (!result.ok) return jsonResponse({ success: false, error: result.error }, 400);
    return jsonResponse({ success: true, data: listProjectAliases(db) });
  }

  if (path.startsWith(ALIAS_ITEM_PREFIX) && method === 'DELETE') {
    const alias = decodeURIComponent(path.slice(ALIAS_ITEM_PREFIX.length));
    if (!deleteProjectAlias(db, alias)) {
      return jsonResponse({ success: false, error: 'Alias not found' }, 404);
    }
    return jsonResponse({ success: true, data: listProjectAliases(db) });
  }

  return null;
}
