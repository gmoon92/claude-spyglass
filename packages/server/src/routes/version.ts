/**
 * 버전 + 업데이트 라우트 — /api/version, /api/update.
 *
 * 변경 이유: 엔드포인트 경로·응답 포맷·업데이트 절차 변경 시 한 곳만 수정.
 *
 * @see .claude/docs/plans/auto-update-migration-hardening/adr.md
 *   ADR-004: /api/update 응답 contract 확장 (migrationsApplied)
 *   ADR-005: /api/version 응답 확장 (dbUserVersion, latestMigrationFile)
 *   ADR-006: 마이그레이션 lag 감지 (migrationLag 옵셔널 필드)
 *   ADR-007: shallow clone 부팅 감지 (isShallowRepository)
 */

import type { Database } from 'bun:sqlite';
import { jsonResponse, type RouteHandler } from './_shared';
import { getVersionCache, refreshAfterUpdate } from '../version-checker';
import {
  detectMigrationLag,
  getLastMigrationRun,
  getLatestMigrationFile,
  type MigrationRunResult,
} from '@spyglass/storage';

// =============================================================================
// 부팅 시점 1회 산출 — shallow clone 여부 캐시 (ADR-007)
// =============================================================================
//
// `git rev-parse --is-shallow-repository`는 빠르지만 매 요청마다 spawn하는 것은
// 낭비다. 모듈 로드 시점에 1회 실행해 캐시한다. `/api/update` 후 git pull 결과
// 변동 가능성이 있어 refreshShallowFlag()로 재산출 가능.

let isShallowCache: boolean = false;
let isShallowResolved = false;

function refreshShallowFlag(): void {
  try {
    const proc = Bun.spawnSync(['git', 'rev-parse', '--is-shallow-repository'], {
      cwd: process.cwd(),
    });
    if (proc.exitCode !== 0) {
      isShallowCache = false;
    } else {
      const out = proc.stdout.toString().trim();
      isShallowCache = out === 'true';
    }
  } catch {
    isShallowCache = false;
  }
  isShallowResolved = true;
}

function isShallowRepository(): boolean {
  if (!isShallowResolved) refreshShallowFlag();
  return isShallowCache;
}

/**
 * `SPYGLASS_UPDATE_CHANNEL` env 를 그대로 echo. 유효 값이 아니면 'git' fallback.
 * Formula 의 write_env_script / Electron desktop 의 server-process.js 가 주입한다.
 */
function resolveUpdateChannel(): 'git' | 'brew' | 'packaged' {
  const v = process.env.SPYGLASS_UPDATE_CHANNEL;
  if (v === 'brew' || v === 'packaged') return v;
  return 'git';
}

// =============================================================================
// /api/version 응답 contract — TypeScript 타입 SSoT (ADR-004, ADR-005, ADR-007)
// =============================================================================

export interface VersionResponseData {
  currentVersion: string;
  latestTag: string | null;
  updateAvailable: boolean;
  /** ADR-005: PRAGMA user_version 현재값 — 폴링 검증용 (옵셔널 — 호환성 보존). */
  dbUserVersion?: number;
  /** ADR-005: `_migrations` 최신 row의 filename (없으면 null). */
  latestMigrationFile?: string | null;
  /** ADR-007: shallow clone 환경 감지 — true면 dashboard warning 노출. */
  isShallowRepository?: boolean;
  /**
   * 배포 채널 표지 — `SPYGLASS_UPDATE_CHANNEL` env 값을 그대로 echo.
   *   - 'git'      : git clone 기반 dev 환경. 기본값. web 의 git pull 기반 update 배지 활성.
   *   - 'brew'     : Homebrew Formula 설치. `brew upgrade spyglass` 가 canonical. 배지 hide.
   *   - 'packaged' : Electron DMG. 자체 auto-updater 가 처리. 배지 hide.
   *
   * web 클라이언트는 'git' 이외의 채널에서 자체 update 배지/모달을 숨긴다.
   */
  updateChannel?: 'git' | 'brew' | 'packaged';
  /** ADR-006: 마이그레이션 lag 감지 — 비정상 부팅으로 user_version < 최신 파일일 때. */
  migrationLag?: {
    current: number;
    latestFile: string | null;
  };
}

// =============================================================================
// /api/update 응답 contract — TypeScript 타입 SSoT (ADR-004)
// =============================================================================

export interface UpdateResponseData {
  currentVersion: string;
  latestTag: string | null;
  updateAvailable: boolean;
  restarting: boolean;
  /**
   * ADR-004: 본 update 호출이 트리거한 재기동 후 적용된 마이그레이션 결과.
   *
   * 주의 — 본 응답은 재기동 *전* 시점에 작성된다. update 호출 시점에는 신규 마이그레이션이
   * 아직 적용되지 않았으므로 `from === to && files.length === 0`로 노출된다. 클라이언트는
   * 재기동 직후 `/api/version` 폴링으로 `dbUserVersion`·`latestMigrationFile`을 회수해
   * 실제 적용 결과를 확인해야 한다.
   *
   * (재기동된 새 프로세스의 부팅 마이그레이션 결과는 본 응답에 포함될 수 없다 — 응답 송신
   * 후 재기동되므로 측정 불가.)
   */
  migrationsApplied?: MigrationRunResult;
  /**
   * git pull 결과 package.json / bun.lock / packages/*\/package.json 변경이 감지되어
   * `bun install` 을 동기 실행했는지 여부.
   *
   * 변경 이유:
   *   pull 만 적용하고 install 을 건너뛰면 신규 워크스페이스 패키지나 의존성을 자식 부팅
   *   시점에 찾지 못해 (예: `Cannot find module '@spyglass/storage-graph'`) 자기 자신
   *   restart 가 모듈 로드 실패로 즉시 죽는다. 본 필드는 클라이언트가 install 발생 여부와
   *   소요 영향을 파악할 수 있도록 노출.
   */
  dependenciesUpdated?: boolean;
}

// =============================================================================
// GET /api/version
// =============================================================================

function handleGetVersion(db: Database): Response {
  const cache = getVersionCache();

  // 안전한 기본값 — 어느 데이터 조회 실패해도 응답 자체는 깨지지 않도록.
  let dbUserVersion = 0;
  let latestMigrationFile: string | null = null;
  let migrationLag: { current: number; latestFile: string | null } | undefined;

  try {
    const lag = detectMigrationLag(db);
    dbUserVersion = lag.current;
    latestMigrationFile = getLatestMigrationFile(db);

    // current < latest 면 미적용 상태 — 클라이언트에 안내
    if (lag.current < lag.latest) {
      migrationLag = {
        current: lag.current,
        latestFile: lag.latestFile,
      };
    }
  } catch (err) {
    console.warn('[VersionRoute] Failed to read migration state:', err);
  }

  const data: VersionResponseData = {
    currentVersion: cache.currentVersion,
    latestTag: cache.latestTag,
    updateAvailable: cache.updateAvailable,
    dbUserVersion,
    latestMigrationFile,
    isShallowRepository: isShallowRepository(),
    updateChannel: resolveUpdateChannel(),
  };
  if (migrationLag) {
    data.migrationLag = migrationLag;
  }

  return jsonResponse({
    success: true,
    data,
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

  // 2. pull 전 HEAD SHA 캡처 — pull 후 diff 로 의존성 매니페스트 변경을 감지하기 위함.
  //    실패 시 'unknown' 으로 두면 후속 diff 가 빈 결과를 반환해 install 을 건너뛴다.
  const beforeSha = readHeadSha(cwd);

  // 3. git pull --ff-only
  const pullProc = Bun.spawnSync(['git', 'pull', '--ff-only'], { cwd });
  if (pullProc.exitCode !== 0) {
    const err = pullProc.stderr.toString().trim() || pullProc.stdout.toString().trim();
    return jsonResponse(
      { success: false, error: 'pull_failed', data: err },
      500
    );
  }

  // git fetch가 unshallow를 자동 처리했을 수도 있으니 캐시 재산출.
  refreshShallowFlag();

  // 4. 의존성 매니페스트 변경 감지 + 조건부 `bun install`.
  //    매번 install 하면 cold cache 시 20s+ 소요되므로 변경 시에만 실행.
  //    install 실패 시 self-restart 를 차단해 옛 코드로라도 서비스 유지.
  const afterSha = readHeadSha(cwd);
  const depsChanged = beforeSha && afterSha && beforeSha !== afterSha
    ? hasDependencyManifestChange(cwd, beforeSha, afterSha)
    : false;

  let dependenciesUpdated = false;
  if (depsChanged) {
    const installProc = Bun.spawnSync(['bun', 'install'], { cwd });
    if (installProc.exitCode !== 0) {
      const err = installProc.stderr.toString().trim() || installProc.stdout.toString().trim();
      console.error('[VersionRoute] bun install failed after git pull:', err);
      return jsonResponse(
        {
          success: false,
          error: 'install_failed',
          data: err,
        },
        500
      );
    }
    dependenciesUpdated = true;
    console.log('[VersionRoute] Dependencies reinstalled after pull (package manifest changed).');
  }

  // 5. 캐시 갱신 — package.json을 다시 읽어 currentVersion 업데이트
  refreshAfterUpdate();
  const cache = getVersionCache();

  // ADR-004: 본 응답 시점에는 신규 마이그레이션이 아직 적용되지 않았다 (재기동 후 적용됨).
  // 본 프로세스에서 부팅 시 적용된 마이그레이션 결과를 노출 — `from === to && files.length === 0`이면
  // 본 부팅에서는 적용된 게 없음. 진짜 신규 적용 결과는 클라이언트가 재기동 직후 /api/version 폴링으로 회수.
  const migrationsApplied = getLastMigrationRun();

  // 6. 응답 전송 후 비동기 자기 자신 재시작 — bun run dev (restart) 를
  //    detached child로 띄우면 commandRestart가 부모를 SIGTERM으로 종료시키고
  //    새 서버가 같은 PORT를 잡는다. 클라이언트는 polling으로 부활 감지.
  scheduleSelfRestart(cwd);

  const data: UpdateResponseData = {
    currentVersion: cache.currentVersion,
    latestTag: cache.latestTag,
    updateAvailable: cache.updateAvailable,
    restarting: true,
    migrationsApplied,
    dependenciesUpdated,
  };
  return jsonResponse({
    success: true,
    data,
  });
}

/** HEAD SHA 조회. 실패 시 빈 문자열 — 호출자가 install 분기를 건너뛰도록. */
function readHeadSha(cwd: string): string {
  const proc = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd });
  if (proc.exitCode !== 0) return '';
  return proc.stdout.toString().trim();
}

/**
 * pull 전후 SHA 범위의 변경 파일 중 의존성 매니페스트가 포함되어 있는지 검사.
 *
 * 매니페스트로 간주하는 파일:
 *  - `package.json` (루트)
 *  - `bun.lock`, `bun.lockb`
 *  - `packages/*\/package.json` (워크스페이스 멤버 — 신규 워크스페이스 추가/제거 시 install 필요)
 *
 * 검사 실패 시 보수적으로 true 반환 — install 을 추가 1회 실행하는 비용이 누락보다 낫다.
 */
function hasDependencyManifestChange(
  cwd: string,
  beforeSha: string,
  afterSha: string,
): boolean {
  const diffProc = Bun.spawnSync(
    ['git', 'diff', '--name-only', `${beforeSha}..${afterSha}`],
    { cwd },
  );
  if (diffProc.exitCode !== 0) {
    // diff 실패는 드물지만, 새 매니페스트를 놓치고 부팅하는 것이 더 큰 비용이라 보수적으로 install.
    console.warn('[VersionRoute] git diff failed; assuming dependency change to be safe.');
    return true;
  }
  const files = diffProc.stdout.toString().split('\n').map((s) => s.trim()).filter(Boolean);
  return files.some((f) => isDependencyManifest(f));
}

function isDependencyManifest(path: string): boolean {
  if (path === 'package.json') return true;
  if (path === 'bun.lock' || path === 'bun.lockb') return true;
  // packages/<name>/package.json — 워크스페이스 멤버.
  if (/^packages\/[^/]+\/package\.json$/.test(path)) return true;
  return false;
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
  db: Database,
  _url: URL,
  path: string,
  method: string,
): Response | null => {
  if (path === '/api/version' && method === 'GET') {
    return handleGetVersion(db);
  }
  if (path === '/api/update' && method === 'POST') {
    return handlePostUpdate();
  }
  return null;
};
