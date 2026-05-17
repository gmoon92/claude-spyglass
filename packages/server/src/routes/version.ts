/**
 * 버전 + 업데이트 라우트 — /api/version, /api/update.
 *
 * 변경 이유: 엔드포인트 경로·응답 포맷·업데이트 절차 변경 시 한 곳만 수정.
 */

import type { Database } from 'bun:sqlite';
import { jsonResponse, type RouteHandler } from './_shared';
import { getVersionCache, refreshAfterUpdate } from '../version-checker';

// =============================================================================
// GET /api/version
// =============================================================================

function handleGetVersion(): Response {
  const cache = getVersionCache();
  return jsonResponse({
    success: true,
    data: cache,
  });
}

// =============================================================================
// POST /api/update
// =============================================================================

function handlePostUpdate(): Response {
  const cwd = process.cwd();

  // 1. 로컬 변경 여부 확인
  const statusProc = Bun.spawnSync(['git', 'status', '--porcelain'], { cwd });
  if (statusProc.exitCode !== 0) {
    return jsonResponse(
      { success: false, error: 'git_status_failed' },
      500
    );
  }
  const hasLocalChanges = statusProc.stdout.toString().trim().length > 0;
  if (hasLocalChanges) {
    return jsonResponse(
      { success: false, error: 'local_changes' },
      409
    );
  }

  // 2. git pull --ff-only
  const pullProc = Bun.spawnSync(['git', 'pull', '--ff-only'], { cwd });
  if (pullProc.exitCode !== 0) {
    const err = pullProc.stderr.toString().trim() || pullProc.stdout.toString().trim();
    return jsonResponse(
      { success: false, error: 'pull_failed', data: err },
      500
    );
  }

  // 3. 캐시 갱신 — package.json을 다시 읽어 currentVersion 업데이트
  refreshAfterUpdate();
  const cache = getVersionCache();

  return jsonResponse({
    success: true,
    data: {
      currentVersion: cache.currentVersion,
      latestTag: cache.latestTag,
      updateAvailable: cache.updateAvailable,
    },
  });
}

// =============================================================================
// 라우터
// =============================================================================

export const versionRouter: RouteHandler = (
  _req: Request,
  _db: Database,
  _url: URL,
  path: string,
  method: string,
): Response | null => {
  if (path === '/api/version' && method === 'GET') {
    return handleGetVersion();
  }
  if (path === '/api/update' && method === 'POST') {
    return handlePostUpdate();
  }
  return null;
};
