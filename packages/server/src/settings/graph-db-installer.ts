/**
 * graph-db-installer.ts — Ladybug 의존성 설치 감지 + 자동 설치 (migration-plan §D)
 *
 * 책임:
 *   1) `detectLadybugInstall()` — 현재 시스템에 Ladybug 가 설치돼 있는지 감지.
 *   2) `installLadybugStreaming(strategy, emit)` — 라인 단위 stdout/stderr 를 emit 콜백으로
 *      즉시 발행하며 설치 실행. 종료 시 InstallResult 반환.
 *   3) `installLadybug(strategy)` — (2) 위의 얇은 wrapper. 기존 호출부 (또는 SSE 미사용)
 *      와의 호환을 위해 유지. 내부적으로 emit 을 no-op 으로 넘기고 결과만 반환.
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
 *   - 스트리밍: stdout/stderr 를 TextDecoder + 라인 split 로 즉시 emit. 부분 라인은
 *     다음 chunk 와 합쳐 처리, 종료 시 잔여 부분 라인도 flush.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve as resolvePath } from 'path';

// =============================================================================
// 타입
// =============================================================================

export type InstallStrategy = 'bun' | 'brew' | 'npm' | 'auto';
export type InstallMethod = 'bun' | 'brew' | 'npm' | 'none';

export interface LadybugInstallStatus {
  /** 현재 감지된 설치 방식. 'none' 이면 미설치. */
  method: InstallMethod;
  installed: boolean;
  /** 알려진 버전 문자열 (감지 가능 시). */
  version: string | null;
  /** node_modules 경로 (모듈 감지 케이스). */
  path?: string;
  /** bun 이 사용 가능한지 (자동 설치 UI 가 strategy 옵션 결정 — 레포 표준). */
  bunAvailable: boolean;
  /** brew 가 사용 가능한지. */
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
  /** 실패 시 사용자에게 안내할 진단 hint (npm 권한/타임아웃/네트워크 등). */
  hints?: string[];
}

/**
 * 설치 진행 이벤트 — SSE 로 클라이언트에 전달.
 *   - start: 어떤 명령어가 실행되는지 한 줄 노출
 *   - stdout/stderr: 외부 명령의 라인 단위 출력
 *   - done: 최종 결과 (log 는 누적분, hints 는 분석된 안내)
 */
export type InstallEvent =
  | { type: 'start'; cmd: string[]; cwd?: string }
  | { type: 'stdout'; line: string }
  | { type: 'stderr'; line: string }
  | { type: 'done'; result: InstallResult };

export type InstallEmit = (event: InstallEvent) => void;

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
 * Ladybug 가 설치돼 있는지 감지.
 *
 * SoT: 런타임(client.ts)은 `await import('@ladybugdb/core')` 로 **node_modules 의 JS 모듈만**
 * 로드한다. 따라서 그래프가 동작 가능한지의 유일한 기준은 *그 모듈이 resolve 되는가* 이다.
 * brew 포뮬러(`ladybug`) 설치 여부는 JS import 를 만족시키지 못하므로 `installed` 판정에서 제외.
 * (과거 brew-first short-circuit 은 모듈이 없어도 installed=true 로 오보고 — false-green 버그.)
 *
 * bunAvailable / brewAvailable / npmAvailable 은 *명령어 자체*가 PATH 에 있는지 — 자동 설치
 * UI 의 strategy 옵션 결정에 사용.
 */
export async function detectLadybugInstall(): Promise<LadybugInstallStatus> {
  const [bunAvailable, brewAvailable, npmAvailable] = await Promise.all([
    isCommandAvailable('bun'),
    isCommandAvailable('brew'),
    isCommandAvailable('npm'),
  ]);

  // 유일한 진실: node_modules 의 @ladybugdb/core 모듈이 존재하는가.
  const moduleInfo = detectViaNpmModule();
  if (moduleInfo.installed) {
    return { ...moduleInfo, bunAvailable, brewAvailable, npmAvailable };
  }

  return {
    method: 'none',
    installed: false,
    version: null,
    bunAvailable,
    brewAvailable,
    npmAvailable,
  };
}

/**
 * `@ladybugdb/core` node_modules 모듈 존재 여부 + package.json 의 version 추출.
 *
 * 이것이 설치 감지의 SoT — 런타임 `import('@ladybugdb/core')` 가 resolve 하는 위치와 동일하게
 * node_modules 를 직접 본다. method 라벨은 레포 패키지매니저(bun.lock 유무)에 맞춰 표기.
 * (availability 플래그는 호출 측 detectLadybugInstall 에서 덮어씀.)
 */
function detectViaNpmModule(): LadybugInstallStatus {
  const base: LadybugInstallStatus = {
    method: 'none',
    installed: false,
    version: null,
    bunAvailable: false,
    brewAvailable: false,
    npmAvailable: false,
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
      const pkg = JSON.parse(readFileSync(absPath, 'utf8'));
      const version = typeof pkg?.version === 'string' ? pkg.version : null;
      return {
        ...base,
        method: hasBunLockfile() ? 'bun' : 'npm',
        installed: true,
        version,
        path: absPath.replace(/\/package\.json$/, ''),
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
 * brew 또는 npm 으로 Ladybug 자동 설치 (스트리밍).
 *
 * strategy:
 *   - 'brew' : `brew install ladybug`
 *   - 'npm'  : workspace root 에서 `npm install` (lockfile 재설치)
 *   - 'auto' : brew 가능 → brew, 아니면 npm
 *
 * 동작:
 *   - start 이벤트로 실행 명령을 사용자에게 노출.
 *   - 외부 명령의 stdout/stderr 를 라인 단위로 즉시 emit.
 *   - 종료 후 done 이벤트와 함께 InstallResult 반환 (동일 결과를 함수 반환값으로도 노출).
 *
 * 사전 검증 분기 (이미 설치됨 / 패키지 매니저 부재 등) 는 외부 명령을 실행하지 않으므로
 * start/stdout 이벤트는 발생하지 않고 done 만 발행.
 */
export async function installLadybugStreaming(
  strategy: InstallStrategy,
  emit: InstallEmit,
): Promise<InstallResult> {
  const existing = await detectLadybugInstall();
  if (existing.installed) {
    const result: InstallResult = {
      status: 'already-installed',
      method: existing.method,
      version: existing.version,
      log: `already installed via ${existing.method} (version ${existing.version ?? 'unknown'})`,
      restartRequired: false,
    };
    emit({ type: 'done', result });
    return result;
  }

  let chosen: InstallMethod;
  if (strategy === 'bun') chosen = 'bun';
  else if (strategy === 'brew') chosen = 'brew';
  else if (strategy === 'npm') chosen = 'npm';
  else {
    // auto: 레포 표준 bun 우선 (bun.lock + bun 가용) → npm 폴백 → 최후에 brew.
    if (existing.bunAvailable && hasBunLockfile()) chosen = 'bun';
    else if (existing.npmAvailable) chosen = 'npm';
    else if (existing.brewAvailable) chosen = 'brew';
    else chosen = 'none';
  }

  if (chosen === 'none') {
    const result: InstallResult = {
      status: 'failed',
      method: 'none',
      version: null,
      log: 'No package manager available. Install bun (https://bun.sh) or Node.js/npm first.',
      restartRequired: false,
      error: 'no-package-manager',
    };
    emit({ type: 'done', result });
    return result;
  }

  if (chosen === 'bun') {
    if (!existing.bunAvailable) {
      const result: InstallResult = {
        status: 'failed',
        method: 'bun',
        version: null,
        log: 'bun is not installed. See https://bun.sh',
        restartRequired: false,
        error: 'bun-not-available',
      };
      emit({ type: 'done', result });
      return result;
    }
    return runBunInstallStreaming(emit);
  }

  if (chosen === 'brew') {
    if (!existing.brewAvailable) {
      const result: InstallResult = {
        status: 'failed',
        method: 'brew',
        version: null,
        log: 'brew is not installed. See https://brew.sh',
        restartRequired: false,
        error: 'brew-not-available',
      };
      emit({ type: 'done', result });
      return result;
    }
    return runBrewInstallStreaming(emit);
  }

  if (!existing.npmAvailable) {
    const result: InstallResult = {
      status: 'failed',
      method: 'npm',
      version: null,
      log: 'npm is not installed. Install Node.js first.',
      restartRequired: false,
      error: 'npm-not-available',
    };
    emit({ type: 'done', result });
    return result;
  }
  return runNpmInstallStreaming(emit);
}

/**
 * `installLadybug(strategy)` — 비-스트리밍 호환 wrapper.
 *
 * emit 콜백을 no-op 으로 넘기고 결과만 반환. 기존 호출자 (또는 SSE 미지원 클라이언트)
 * 가 동일한 InstallResult 를 받을 수 있도록 유지.
 */
export async function installLadybug(strategy: InstallStrategy): Promise<InstallResult> {
  return installLadybugStreaming(strategy, () => { /* no-op */ });
}

async function runBrewInstallStreaming(emit: InstallEmit): Promise<InstallResult> {
  const cmd = ['brew', 'install', 'ladybug'];
  emit({ type: 'start', cmd });
  const result = await spawnStreaming(cmd, SPAWN_INSTALL_TIMEOUT_MS, undefined, emit);
  const log = combineLog(result.stdout, result.stderr);

  if (result.exitCode !== 0) {
    const installResult: InstallResult = {
      status: 'failed',
      method: 'brew',
      version: null,
      log,
      restartRequired: false,
      error: result.timedOut
        ? `brew install timed out after ${SPAWN_INSTALL_TIMEOUT_MS / 1000}s`
        : `brew install exited ${result.exitCode}`,
    };
    emit({ type: 'done', result: installResult });
    return installResult;
  }

  const after = await detectLadybugInstall();
  const installResult: InstallResult = {
    status: 'installed',
    method: 'brew',
    version: after.version,
    log,
    restartRequired: true,
  };
  emit({ type: 'done', result: installResult });
  return installResult;
}

async function runBunInstallStreaming(emit: InstallEmit): Promise<InstallResult> {
  // 정책: storage-graph 의 dependency 로 @ladybugdb/core 가 선언돼 있으므로
  //   *모노레포 루트에서* `bun install` (인자 없이) 만 호출해 lockfile 기반 재설치.
  //   레포 표준 패키지매니저(engines.bun) — auto-update(version.ts) 와 동일 경로.
  const cwd = findMonorepoRoot();
  const cmd = ['bun', 'install'];
  emit({ type: 'start', cmd, cwd });
  const result = await spawnStreaming(cmd, SPAWN_INSTALL_TIMEOUT_MS, cwd, emit);
  const log = combineLog(result.stdout, result.stderr);

  if (result.exitCode !== 0) {
    const hints = analyzeNpmFailure(log, cwd);
    const installResult: InstallResult = {
      status: 'failed',
      method: 'bun',
      version: null,
      log,
      restartRequired: false,
      error: result.timedOut
        ? `bun install timed out after ${SPAWN_INSTALL_TIMEOUT_MS / 1000}s`
        : `bun install exited ${result.exitCode}`,
      hints,
    };
    emit({ type: 'done', result: installResult });
    return installResult;
  }

  const after = await detectLadybugInstall();
  const installResult: InstallResult = {
    status: 'installed',
    method: 'bun',
    version: after.version,
    log,
    restartRequired: true,
  };
  emit({ type: 'done', result: installResult });
  return installResult;
}

async function runNpmInstallStreaming(emit: InstallEmit): Promise<InstallResult> {
  // 정책: storage-graph 패키지의 dependency 로 @ladybugdb/core 가 이미 선언돼 있으므로
  //   *모노레포 루트에서* `npm install` (인자 없이) 만 호출해 lockfile 기반 재설치.
  const cwd = findMonorepoRoot();
  const cmd = ['npm', 'install'];
  emit({ type: 'start', cmd, cwd });
  const result = await spawnStreaming(cmd, SPAWN_INSTALL_TIMEOUT_MS, cwd, emit);
  const log = combineLog(result.stdout, result.stderr);

  if (result.exitCode !== 0) {
    // 실패 원인 진단 — EACCES/EPERM/ENOENT/ETIMEDOUT 패턴 매칭.
    const hints = analyzeNpmFailure(log, cwd);
    const installResult: InstallResult = {
      status: 'failed',
      method: 'npm',
      version: null,
      log,
      restartRequired: false,
      error: result.timedOut
        ? `npm install timed out after ${SPAWN_INSTALL_TIMEOUT_MS / 1000}s`
        : `npm install exited ${result.exitCode}`,
      hints,
    };
    emit({ type: 'done', result: installResult });
    return installResult;
  }

  const after = await detectLadybugInstall();
  const installResult: InstallResult = {
    status: 'installed',
    method: 'npm',
    version: after.version,
    log,
    restartRequired: true,
  };
  emit({ type: 'done', result: installResult });
  return installResult;
}

/** npm 실패 로그에서 사용자 안내 hint 를 추출. 빈 배열이 아니면 UI 가 강조 표시. */
function analyzeNpmFailure(log: string, cwd: string): string[] {
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
    hints.push('자세한 원인은 위 로그를 확인하세요. Homebrew 설치(brew install ladybug) 가 가능하면 그쪽이 더 안전합니다.');
  }
  return hints;
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

/**
 * 외부 명령을 실행하면서 stdout/stderr 를 라인 단위로 emit.
 *
 * 동작:
 *   - Bun.spawn 의 ReadableStream<Uint8Array> 를 getReader() 로 즉시 읽음.
 *   - TextDecoder 로 디코드, 라인 버퍼에 누적, \n 으로 split → 즉시 emit.
 *   - 부분 라인(\n 없는 마지막 조각) 은 다음 chunk 와 합쳐 처리.
 *   - 종료 시 잔여 부분 라인도 flush.
 *   - timeout 시 proc.kill().
 *
 * 반환값은 spawnWithTimeout 과 동일한 SpawnResult (전체 누적 stdout/stderr + exitCode).
 * 호출 측이 combineLog/InstallResult 구성에 그대로 사용 가능.
 */
async function spawnStreaming(
  cmd: string[],
  timeoutMs: number,
  cwd: string | undefined,
  emit: InstallEmit,
): Promise<SpawnResult> {
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  try {
    proc = Bun.spawn(cmd, {
      stdout: 'pipe',
      stderr: 'pipe',
      cwd,
    });

    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      try { proc?.kill(); } catch { /* already dead */ }
    }, timeoutMs);

    const collected = { stdout: '', stderr: '' };
    const streamReader = async (
      stream: ReadableStream<Uint8Array>,
      kind: 'stdout' | 'stderr',
    ): Promise<void> => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          buffer += text;
          collected[kind] += text;
          // 마지막 \n 위치까지 라인 단위로 flush. 그 뒤 잔여는 다음 chunk 까지 보존.
          let nlIdx = buffer.indexOf('\n');
          while (nlIdx !== -1) {
            const line = buffer.slice(0, nlIdx).replace(/\r$/, '');
            emit({ type: kind, line });
            buffer = buffer.slice(nlIdx + 1);
            nlIdx = buffer.indexOf('\n');
          }
        }
        // 종료 시 잔여 부분 라인이 있으면 flush (\n 없이 끝났을 때).
        const flushed = decoder.decode();
        if (flushed) {
          buffer += flushed;
          collected[kind] += flushed;
        }
        if (buffer.length > 0) {
          emit({ type: kind, line: buffer.replace(/\r$/, '') });
        }
      } finally {
        try { reader.releaseLock(); } catch { /* ignore */ }
      }
    };

    await Promise.all([
      streamReader(proc.stdout as ReadableStream<Uint8Array>, 'stdout'),
      streamReader(proc.stderr as ReadableStream<Uint8Array>, 'stderr'),
    ]);
    const exitCode = await proc.exited;
    clearTimeout(timeoutHandle);

    return {
      exitCode: timedOut ? -1 : exitCode,
      stdout: collected.stdout,
      stderr: collected.stderr,
      timedOut,
    };
  } catch (err) {
    try { proc?.kill(); } catch { /* ignore */ }
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

/** 레포가 bun 으로 관리되는지 — monorepo 루트에 bun.lock(b) 존재 여부. */
function hasBunLockfile(): boolean {
  const root = findMonorepoRoot();
  return existsSync(resolvePath(root, 'bun.lock')) || existsSync(resolvePath(root, 'bun.lockb'));
}

/** monorepo 루트 추정 — package.json 의 workspaces 필드가 있는 디렉토리 위로 탐색. */
function findMonorepoRoot(): string {
  let cur = process.cwd();
  for (let i = 0; i < 6; i++) {
    const pkgPath = resolvePath(cur, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg?.workspaces) return cur;
      } catch { /* continue */ }
    }
    const parent = resolvePath(cur, '..');
    if (parent === cur) break;
    cur = parent;
  }
  return process.cwd();
}
