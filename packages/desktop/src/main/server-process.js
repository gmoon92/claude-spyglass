/**
 * server-process.js — Bun spyglass 서버 라이프사이클 관리자 (데스크톱 전용).
 *
 * @description
 *   Electron 메인 프로세스가 BrowserWindow 로딩 전에 호출하여
 *   `http://127.0.0.1:9999/health` 가 준비되어 있는 상태를 보장한다.
 *
 * 책임:
 *   1) 기존 spyglass 서버 데몬 감지 (health probe).
 *   2) 데몬이 없을 때만 `bun packages/server/src/index.ts start` 를 child process 로 spawn.
 *   3) Electron 앱 종료 시, **자기가 spawn 한 경우에만** graceful SIGTERM → 5s 후 SIGKILL.
 *
 * 의존성:
 *   - `bun` 실행 파일이 PATH 또는 통상 설치 경로(`/opt/homebrew/bin/bun`, `~/.bun/bin/bun`)에 존재.
 *   - 동봉 또는 워크스페이스 위치의 `packages/server/src/index.ts`.
 *
 * 호출 흐름:
 *   main.js (app.whenReady)
 *     → ensureServer({ port, host })
 *         → probeHealth(port, host)  ─[200]→ { mode: 'attached' }
 *                                    ─[fail]→ spawnBunServer() → waitUntilReady() → { mode: 'spawned', child }
 *     → BrowserWindow.loadURL(`http://${host}:${port}`)
 *
 *   app.on('before-quit')
 *     → shutdownServer()  (spawned 모드에서만 child 종료)
 *
 * 비범위:
 *   - 서버가 중간에 죽었을 때의 자동 재시작은 의도적으로 하지 않는다.
 *     사용자 결정 사항: spyglass 서버 재시작은 사용자에게 맡긴다.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 모듈 단일 상태 — 동시에 두 번 spawn 되지 않도록 보장.
let managedChild = null;
let managedMode = 'none'; // 'none' | 'attached' | 'spawned'

const DEFAULT_PORT = 9999;
const DEFAULT_HOST = '127.0.0.1';
const READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;
const SHUTDOWN_GRACE_MS = 5_000;

/**
 * GET /health 로 spyglass 서버 생존을 1초 안에 판단한다.
 * @returns {Promise<boolean>} 200 응답을 받으면 true.
 */
async function probeHealth(host, port) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`http://${host}:${port}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 시스템에 설치된 `bun` 실행 파일 경로를 결정한다 (dev 모드 전용).
 * Electron GUI 앱은 로그인 셸의 PATH 를 상속받지 못하므로 fallback 경로를 직접 탐색한다.
 * @returns {string} 실행 가능한 bun 경로. 찾지 못하면 'bun' 을 반환(spawn ENOENT 로 실패 노출).
 */
function resolveBunBin() {
  const candidates = [
    process.env.BUN_INSTALL ? path.join(process.env.BUN_INSTALL, 'bin', 'bun') : null,
    path.join(process.env.HOME || '', '.bun', 'bin', 'bun'),
    '/opt/homebrew/bin/bun',
    '/usr/local/bin/bun',
  ].filter(Boolean);

  for (const bin of candidates) {
    if (existsSync(bin)) return bin;
  }
  return 'bun';
}

/**
 * spyglass 서버 실행 명령을 결정한다.
 *
 * 두 모드 분기:
 *   - **packaged** (DMG 설치 후 실행): Bun standalone executable 을 직접 실행.
 *     자원 파일은 ASAR 바깥(extraResources)에 동봉되어 있으며 그 절대 경로를
 *     `SPYGLASS_WEB_ROOT` / `SPYGLASS_MIGRATIONS_ROOT` env 로 child 에 주입한다.
 *     `bun` 시스템 설치 불필요.
 *   - **dev** (`bun run desktop:dev`): 시스템 bun + .ts 진입점 직접 실행. env 주입 없이
 *     `import.meta.dir`/`import.meta.url` 기반 워크스페이스 상대 경로로 자원에 도달.
 *
 * @param {{ port: number, host: string }} cfg
 * @returns {{ cmd: string, args: string[], env: Record<string,string> } | null}
 *          진입점/바이너리를 찾지 못하면 null.
 */
function resolveServerLaunch(cfg) {
  const baseEnv = {
    ...process.env,
    SPGLASS_PORT: String(cfg.port),
    SPGLASS_HOST: cfg.host,
  };

  if (app.isPackaged) {
    const bin = path.join(process.resourcesPath, 'bin', 'spyglass-server');
    if (!existsSync(bin)) return null;
    return {
      cmd: bin,
      args: ['start'],
      env: {
        ...baseEnv,
        // standalone bin 안의 `import.meta.dir`이 가상 경로라 동적 fs 접근 실패 → env 로 주입.
        SPYGLASS_WEB_ROOT: path.join(process.resourcesPath, 'app', 'web'),
        SPYGLASS_MIGRATIONS_ROOT: path.join(process.resourcesPath, 'app', 'storage', 'migrations'),
        SPYGLASS_APP_VERSION: app.getVersion(),
        // 배포 채널 표지 — server 가 /api/version 응답에 updateChannel 을 그대로 echo.
        //   web 은 'git' 이외의 채널에서 git pull 기반 배지/모달을 숨긴다.
        //   Electron 자체 update 흐름은 메인 프로세스의 auto-updater.js 가 담당.
        SPYGLASS_UPDATE_CHANNEL: 'packaged',
        // Graph projection 비활성 — native @ladybugdb 가 packaged 환경에 미동봉이므로
        // 'off' 로 명시해 시작 시 native import 시도 자체를 차단 (booting 안전).
        //   storage-graph 의 circuit breaker 가 동작하긴 하나, 첫 부팅 에러 로그를 피하려 명시.
        SPYGLASS_GRAPH_MODE: 'off',
      },
    };
  }

  // dev: __dirname = packages/desktop/src/main → repoRoot = ../../../..
  const entry = path.resolve(__dirname, '..', '..', '..', 'server', 'src', 'index.ts');
  if (!existsSync(entry)) return null;
  return {
    cmd: resolveBunBin(),
    args: [entry, 'start'],
    env: baseEnv,
  };
}

/**
 * spawn 직후 서버가 listen 시작할 때까지 폴링한다.
 * @returns {Promise<void>} 준비 완료 시 resolve, 타임아웃 시 reject.
 */
async function waitUntilReady(host, port) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probeHealth(host, port)) return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`spyglass server did not become ready on ${host}:${port} within ${READY_TIMEOUT_MS}ms`);
}

/**
 * spyglass 서버를 준비 상태로 보장한다.
 * @param {{ port?: number, host?: string }} [opts]
 * @returns {Promise<{ mode: 'attached' | 'spawned', host: string, port: number }>}
 */
export async function ensureServer(opts = {}) {
  const port = opts.port ?? DEFAULT_PORT;
  const host = opts.host ?? DEFAULT_HOST;

  // 1) 이미 떠 있으면 attach — 결정 사항: 기존 데몬과 공존, kill 금지.
  if (await probeHealth(host, port)) {
    managedMode = 'attached';
    return { mode: 'attached', host, port };
  }

  // 2) spawn
  const launch = resolveServerLaunch({ port, host });
  if (!launch) {
    throw new Error(
      app.isPackaged
        ? 'spyglass-server binary not found in Resources/bin (DMG corrupt?)'
        : 'packages/server entry point not found in dev workspace'
    );
  }

  managedChild = spawn(launch.cmd, launch.args, {
    env: launch.env,
    stdio: 'inherit',
    detached: false,
  });

  managedChild.on('exit', (code, signal) => {
    // 의도된 종료(before-quit 핸들러)에서 발생하는 exit 이벤트는 무시한다.
    // 단, 앱 실행 중 비정상 종료가 발생해도 자동 재시작은 하지 않는다 (사용자 정책).
    managedChild = null;
    managedMode = 'none';
    if (process.env.SPGLASS_DESKTOP_DEBUG) {
      console.log(`[server-process] child exited code=${code} signal=${signal}`);
    }
  });

  await waitUntilReady(host, port);
  managedMode = 'spawned';
  return { mode: 'spawned', host, port };
}

/**
 * Electron 앱 종료 직전 호출. attached 모드에서는 no-op.
 * @returns {Promise<void>}
 */
export async function shutdownServer() {
  if (managedMode !== 'spawned' || !managedChild) return;

  const child = managedChild;
  managedChild = null;
  managedMode = 'none';

  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve();
    }, SHUTDOWN_GRACE_MS);
    child.on('exit', () => {
      clearTimeout(killTimer);
      resolve();
    });
  });
}

/**
 * 현재 관리 모드 (테스트/디버그용).
 */
export function getManagedMode() {
  return managedMode;
}
