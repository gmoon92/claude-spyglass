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
  if (strategy === 'brew') chosen = 'brew';
  else if (strategy === 'npm') chosen = 'npm';
  else chosen = existing.brewAvailable ? 'brew' : existing.npmAvailable ? 'npm' : 'none';

  if (chosen === 'none') {
    const result: InstallResult = {
      status: 'failed',
      method: 'none',
      version: null,
      log: 'No package manager available. Install Homebrew or Node.js/npm first.',
      restartRequired: false,
      error: 'no-package-manager',
    };
    emit({ type: 'done', result });
    return result;
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
