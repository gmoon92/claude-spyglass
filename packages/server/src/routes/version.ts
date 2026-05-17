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

  // 4. 응답 전송 후 비동기 자기 자신 재시작 — bun run dev (restart) 를
  //    detached child로 띄우면 commandRestart가 부모를 SIGTERM으로 종료시키고
  //    새 서버가 같은 PORT를 잡는다. 클라이언트는 polling으로 부활 감지.
  scheduleSelfRestart(cwd);

  return jsonResponse({
    success: true,
    data: {
      currentVersion: cache.currentVersion,
      latestTag: cache.latestTag,
      updateAvailable: cache.updateAvailable,
      restarting: true,
    },
  });
}

/**
 * git pull 성공 후 자기 자신을 백그라운드로 restart 한다.
 *  - 1.2s 지연: HTTP 응답이 클라이언트에 도달할 시간을 보장.
 *  - Bun.spawn detached + stdio ignore: 부모가 죽어도 자식이 살아남도록.
 *  - 자식은 `bun run packages/server/src/index.ts restart` 를 실행 →
 *    daemon.commandRestart 가 기존 PID(=현재 우리)를 SIGTERM 으로 종료 후
 *    같은 포트로 새 서버를 띄운다.
 */
function scheduleSelfRestart(cwd: string): void {
  setTimeout(() => {
    try {
      Bun.spawn(
        ['bun', 'run', 'packages/server/src/index.ts', 'restart'],
        {
          cwd,
          stdout: 'ignore',
          stderr: 'ignore',
          stdin: 'ignore',
        },
      );
      console.log('[VersionRoute] Self-restart scheduled (detached child spawned).');
    } catch (err) {
      console.error('[VersionRoute] Failed to spawn self-restart:', err);
    }
  }, 1200);
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
