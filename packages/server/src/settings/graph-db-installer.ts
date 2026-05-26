/**
 * graph-db-installer.ts — Ladybug 의존성 설치 감지 + 자동 설치 (migration-plan §D)
 *
 * 책임:
 *   1) `detectLadybugInstall()` — 현재 시스템에 Ladybug 가 설치돼 있는지 감지.
 *      - brew: `brew list ladybug` (macOS/Linux brew 환경)
 *      - npm:  `node -e require.resolve('@ladybugdb/core')` (Node 의존)
 *      - 둘 다 미설치 → method='none'
 *   2) `installLadybug(strategy)` — brew 또는 npm 자동 설치 실행.
 *      - stdout/stderr 를 in-memory 로 수집해 한 번에 반환 (SSE 는 추후 PR).
 *      - 180s timeout (네트워크 다운로드 고려).
 *
 * 의존성:
 *   - Bun.spawn — version-probe.ts 와 동일 패턴.
 *   - 외부 명령: `brew`, `npm`, `node` (PATH 에 있어야 함).
 *
 * 호출자:
 *   - routes/settings.ts: `/api/settings/graph-db/status` + `/api/settings/graph-db/install`
 *
 * 디자인 결정:
 *   - 모든 실패는 throw 없이 `{ installed: false, error }` 로 정규화 — 설정 페이지가
 *     사용자에게 안내할 수 있게.
 *   - 설치 후에는 *서버 재시작 필요* — Node 모듈 캐시는 import 시점 스냅샷.
 *     `restartRequired: true` 로 노출, UI 가 sticky alert 로 안내.
 */

import { existsSync } from 'fs';
import { resolve as resolvePath } from 'path';

// =============================================================================
// 타입
// =============================================================================

export type InstallStrategy = 'brew' | 'npm' | 'auto';
export type InstallMethod = 'brew' | 'npm' | 'none';

export interface LadybugInstallStatus {
  /** 현재 감지된 설치 방식. 'none' 이면 미설치. */
  method: InstallMethod;
  installed: boolean;
  /** 알려진 버전 문자열 (감지 가능 시). */
  version: string | null;
  /** binary 경로 (brew 케이스) 또는 node_modules 경로 (npm 케이스). */
  path?: string;
  /** brew 가 사용 가능한지 (자동 설치 UI 가 strategy 옵션 결정). */
  brewAvailable: boolean;
  /** npm 이 사용 가능한지. */
  npmAvailable: boolean;
  /** 감지 중 발생한 비치명적 에러 메시지. */
  error?: string;
}

export interface InstallResult {
  status: 'installed' | 'already-installed' | 'failed';
  method: InstallMethod;
  version: string | null;
  /** 설치 중 stdout/stderr 캡쳐 (UI 표시용, 최대 8KB). */
  log: string;
  /** 설치 후에는 서버 재시작이 필요한지. brew 는 PATH 갱신만, npm 은 모듈 캐시 재로드 필요. */
  restartRequired: boolean;
  error?: string;
}

// =============================================================================
// 상수
// =============================================================================

const SPAWN_PROBE_TIMEOUT_MS = 2500;
const SPAWN_INSTALL_TIMEOUT_MS = 180_000; // 3분 — 네트워크 다운로드 + 컴파일 고려.
const LOG_MAX_BYTES = 8 * 1024;

// =============================================================================
// 설치 감지
// =============================================================================

/**
 * Ladybug 가 시스템에 설치돼 있는지 감지.
 *
 * 우선순위:
 *   1) brew (macOS/Linux 권장 경로) — `brew list ladybug` 로 확인.
 *   2) npm — `node -e require.resolve('@ladybugdb/core')` 로 확인.
 *   3) 둘 다 부재 → method='none'.
 *
 * brewAvailable / npmAvailable 은 *명령어 자체*가 PATH 에 있는지 — 자동 설치 UI 의
 * strategy 옵션 결정에 사용.
 */
export async function detectLadybugInstall(): Promise<LadybugInstallStatus> {
  const [brewAvailable, npmAvailable] = await Promise.all([
    isCommandAvailable('brew'),
    isCommandAvailable('npm'),
  ]);

  // 1) brew 우선 — Spyglass 자체가 Homebrew Formula 로 배포되므로 brew 환경 가정.
  if (brewAvailable) {
    const brewInfo = await detectViaBrew();
    if (brewInfo.installed) {
      return { ...brewInfo, brewAvailable, npmAvailable };
    }
  }

  // 2) npm — node_modules/@ladybugdb/core 존재 여부 + 버전 추출.
  if (npmAvailable) {
    const npmInfo = detectViaNpmModule();
    if (npmInfo.installed) {
      return { ...npmInfo, brewAvailable, npmAvailable };
    }
  }

  return {
    method: 'none',
    installed: false,
    version: null,
    brewAvailable,
    npmAvailable,
  };
}

/**
 * `brew list --versions ladybug` 의 *출력*으로 실제 설치 여부 판단.
 *
 * 함정 회피: `brew --prefix <pkg>` 는 미설치 패키지에도 *가상의 경로*("$(brew --prefix)/opt/<pkg>")
 * 를 exit code 0 으로 반환한다. exit code 만 보고 installed=true 로 판단하면 false-positive.
 *
 * 정답: `brew list --versions ladybug` 의 stdout 이 *비어있지 않고* `ladybug ` 로 시작해야
 * 실제 설치된 상태.
 */
async function detectViaBrew(): Promise<LadybugInstallStatus> {
  const base: LadybugInstallStatus = {
    method: 'none',
    installed: false,
    version: null,
    brewAvailable: true,
    npmAvailable: false,
  };

  try {
    // 핵심 검증 — `brew list --versions ladybug` 출력에 "ladybug <version>" 이 있어야.
    const versionResult = await spawnWithTimeout(
      ['brew', 'list', '--versions', 'ladybug'],
      SPAWN_PROBE_TIMEOUT_MS,
    );
    // 미설치 시 stdout 빈 문자열 (exit code 는 1 또는 0 둘 다 가능 — brew 버전 따라 다름).
    const versionLine = versionResult.stdout.trim();
    if (!versionLine.startsWith('ladybug')) {
      return base;
    }
    const versionMatch = /ladybug\s+(\S+)/.exec(versionLine);
    const version = versionMatch ? versionMatch[1] : null;

    // 설치 경로 — `brew --prefix ladybug`. 위에서 installed 확정됐으므로 안전.
    let path: string | undefined;
    try {
      const prefixResult = await spawnWithTimeout(
        ['brew', '--prefix', 'ladybug'],
        SPAWN_PROBE_TIMEOUT_MS,
      );
      if (prefixResult.exitCode === 0) {
        path = prefixResult.stdout.trim() || undefined;
      }
    } catch { /* path 는 옵션 — 실패해도 installed 여부 영향 없음 */ }

    return {
      method: 'brew',
      installed: true,
      version,
      path,
      brewAvailable: true,
      npmAvailable: false, // 호출 측에서 덮어씀
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}

/** `@ladybugdb/core` node_modules 경로 + package.json 의 version 필드 추출. */
function detectViaNpmModule(): LadybugInstallStatus {
  const base: LadybugInstallStatus = {
    method: 'none',
    installed: false,
    version: null,
    brewAvailable: false,
    npmAvailable: true,
  };

  // 가능한 monorepo 경로들 — workspace 의 어디든 hoist 될 수 있어 다 검사.
  const candidates = [
    'node_modules/@ladybugdb/core/package.json',
    'packages/storage-graph/node_modules/@ladybugdb/core/package.json',
  ];

  for (const rel of candidates) {
    const absPath = resolvePath(process.cwd(), rel);
    if (!existsSync(absPath)) continue;
    try {
      const pkg = JSON.parse(Bun.file(absPath).text() as unknown as string);
      const version = typeof pkg?.version === 'string' ? pkg.version : null;
      return {
        method: 'npm',
        installed: true,
        version,
        path: absPath.replace(/\/package\.json$/, ''),
        brewAvailable: false, // 호출 측에서 덮어씀
        npmAvailable: true,
      };
    } catch {
      // 파일이 존재하지만 JSON 파싱 실패 — 빈 폴더로 간주.
      continue;
    }
  }

  return base;
}

/** PATH 에 명령어가 있는지 — `command -v` 또는 `which` 로 빠르게 확인. */
async function isCommandAvailable(cmd: string): Promise<boolean> {
  try {
    const r = await spawnWithTimeout(['which', cmd], SPAWN_PROBE_TIMEOUT_MS);
    return r.exitCode === 0 && r.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

// =============================================================================
// 자동 설치
// =============================================================================

/**
 * brew 또는 npm 으로 Ladybug 자동 설치.
 *
 * strategy:
 *   - 'brew' : `brew install ladybug`
 *   - 'npm'  : `npm install @ladybugdb/core` (workspace root cwd)
 *   - 'auto' : brew 가능 → brew, 아니면 npm
 *
 * 종료 후 재감지하여 결과 응답. *서버 재시작이 필요*하다는 정보를 함께 노출.
 */
export async function installLadybug(strategy: InstallStrategy): Promise<InstallResult> {
  const existing = await detectLadybugInstall();
  if (existing.installed) {
    return {
      status: 'already-installed',
      method: existing.method,
      version: existing.version,
      log: `already installed via ${existing.method} (version ${existing.version ?? 'unknown'})`,
      restartRequired: false,
    };
  }

  // strategy 결정.
  let chosen: InstallMethod;
  if (strategy === 'brew') chosen = 'brew';
  else if (strategy === 'npm') chosen = 'npm';
  else {
    chosen = existing.brewAvailable ? 'brew' : existing.npmAvailable ? 'npm' : 'none';
  }

  if (chosen === 'none') {
    return {
      status: 'failed',
      method: 'none',
      version: null,
      log: 'No package manager available. Install Homebrew or Node.js/npm first.',
      restartRequired: false,
      error: 'no-package-manager',
    };
  }

  if (chosen === 'brew') {
    if (!existing.brewAvailable) {
      return {
        status: 'failed',
        method: 'brew',
        version: null,
        log: 'brew is not installed. See https://brew.sh',
        restartRequired: false,
        error: 'brew-not-available',
      };
    }
    return runBrewInstall();
  }

  // npm.
  if (!existing.npmAvailable) {
    return {
      status: 'failed',
      method: 'npm',
      version: null,
      log: 'npm is not installed. Install Node.js first.',
      restartRequired: false,
      error: 'npm-not-available',
    };
  }
  return runNpmInstall();
}

async function runBrewInstall(): Promise<InstallResult> {
  const result = await spawnWithTimeout(['brew', 'install', 'ladybug'], SPAWN_INSTALL_TIMEOUT_MS);
  const log = combineLog(result.stdout, result.stderr);

  if (result.exitCode !== 0) {
    return {
      status: 'failed',
      method: 'brew',
      version: null,
      log,
      restartRequired: false,
      error: `brew install exited ${result.exitCode}`,
    };
  }

  // 설치 직후 재감지 — 버전 노출.
  const after = await detectLadybugInstall();
  return {
    status: 'installed',
    method: 'brew',
    version: after.version,
    log,
    restartRequired: true,
  };
}

async function runNpmInstall(): Promise<InstallResult> {
  // 정책: storage-graph 패키지의 dependency 로 @ladybugdb/core 가 이미 선언돼 있으므로
  //   *모노레포 루트에서* `npm install` (인자 없이) 만 호출해 lockfile 기반 재설치.
  //   `npm install @ladybugdb/core` 형태로 인자 전달 시 root package.json 에 *중복 추가*
  //   되거나 workspace 충돌이 발생할 수 있어 회피.
  const cwd = findMonorepoRoot();
  const result = await spawnWithTimeout(
    ['npm', 'install'],
    SPAWN_INSTALL_TIMEOUT_MS,
    cwd,
  );
  const log = combineLog(result.stdout, result.stderr);

  if (result.exitCode !== 0) {
    // 실패 원인 진단을 사용자에게 명확히 노출.
    //   - EACCES/EPERM : 권한 부족 (brew/system 영역에 spyglass 설치된 경우 흔함)
    //   - ENOENT       : monorepo root 또는 package.json 누락
    //   - ETIMEDOUT    : 네트워크 미연결 / 프록시 문제
    //   사용자 환경에 brew 가 가능하면 brew 권장 안내 동봉.
    const hints: string[] = [];
    if (/EACCES|EPERM|permission denied/i.test(log)) {
      hints.push('권한 부족으로 보입니다. Spyglass 설치 경로(`' + cwd + '`)에 쓰기 권한이 필요합니다.');
    }
    if (/ENOENT.*package\.json/i.test(log)) {
      hints.push('package.json 을 찾지 못했습니다. monorepo root 가 감지되지 않은 환경일 수 있습니다.');
    }
    if (/ETIMEDOUT|ENOTFOUND|getaddrinfo/i.test(log)) {
      hints.push('네트워크 연결이 안 되거나 npm registry 접근이 차단됐습니다.');
    }
    if (!hints.length) {
      hints.push('자세한 원인은 아래 로그를 확인하세요. Homebrew 설치(brew install ladybug) 가 가능하면 그쪽이 더 안전합니다.');
    }
    return {
      status: 'failed',
      method: 'npm',
      version: null,
      log: hints.join('\n') + '\n\n' + log,
      restartRequired: false,
      error: `npm install exited ${result.exitCode}`,
    };
  }

  const after = await detectLadybugInstall();
  return {
    status: 'installed',
    method: 'npm',
    version: after.version,
    log,
    restartRequired: true,
  };
}

// =============================================================================
// 헬퍼
// =============================================================================

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

async function spawnWithTimeout(
  cmd: string[],
  timeoutMs: number,
  cwd?: string,
): Promise<SpawnResult> {
  try {
    const proc = Bun.spawn(cmd, {
      stdout: 'pipe',
      stderr: 'pipe',
      cwd,
    });

    const exited = await Promise.race([
      proc.exited,
      new Promise<number>((resolve) => setTimeout(() => resolve(-1), timeoutMs)),
    ]);

    if (exited === -1) {
      try { proc.kill(); } catch { /* already dead */ }
      return { exitCode: -1, stdout: '', stderr: '', timedOut: true };
    }

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    return { exitCode: exited, stdout, stderr, timedOut: false };
  } catch (err) {
    return {
      exitCode: -2,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
      timedOut: false,
    };
  }
}

function combineLog(stdout: string, stderr: string): string {
  const combined = `${stdout}\n${stderr}`.trim();
  if (combined.length <= LOG_MAX_BYTES) return combined;
  return combined.slice(combined.length - LOG_MAX_BYTES); // 마지막 부분이 더 의미 있음
}

/** monorepo 루트 추정 — package.json 의 workspaces 필드가 있는 디렉토리 위로 탐색. */
function findMonorepoRoot(): string {
  let cur = process.cwd();
  for (let i = 0; i < 6; i++) {
    const pkgPath = resolvePath(cur, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(Bun.file(pkgPath).text() as unknown as string);
        if (pkg?.workspaces) return cur;
      } catch { /* continue */ }
    }
    const parent = resolvePath(cur, '..');
    if (parent === cur) break;
    cur = parent;
  }
  return process.cwd();
}
