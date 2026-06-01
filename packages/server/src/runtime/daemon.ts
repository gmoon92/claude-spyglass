/**
 * 데몬 명령 — serve/start/stop/restart/status (PID 파일 기반 싱글톤).
 *
 * 책임:
 *  - CLI 명령 디스패치.
 *    - `serve`  : foreground blocking. launchd / brew services / docker 친화.
 *                 PID 파일 안 만들고 stdout/stderr 그대로 유지.
 *    - `start`  : background daemonize. 자기 자신을 `serve` 모드로 detached spawn 후
 *                 PID 기록하고 부모 즉시 종료. 사용자 편의 wrapper.
 *    - `stop`   : LISTEN PID에 SIGTERM (manual·serve·launchd 모드 무관).
 *    - `restart`: stop + start (PID 파일 모드 기준).
 *    - `status` : 동작 모드(managed daemon / serve / unknown) 표시.
 *    - `doctor` / `analyze` : @see cli/doctor, cli/analyze 위임.
 *  - graceful shutdown 신호 핸들링: SIGTERM/SIGINT → stopServer → process.exit.
 *
 * 의존성:
 *  - runtime/config: PORT/HOST
 *  - runtime/port: isPortAvailable / findProcessesByPort / waitForProcessExit / waitForPortRelease
 *  - runtime/lifecycle: startServer / stopServer
 *  - cli/doctor, cli/analyze: standalone binary 에서도 호출 가능하도록 통합 (`spyglass doctor` 등).
 *
 * 변경 이유:
 *  - 명령어 추가/제거, PID 파일 위치/포맷 변경, 시그널 처리 정책 변경 시 한 곳만 수정.
 *  - graceful shutdown deadline/진행도 표시 정책도 여기에 모은다 (단일 SSoT).
 *  - brew lifecycle 충돌 방지 — `serve` 는 launchd 직접 호출용, `start` 는 사용자 편의.
 *
 * 환경 변수:
 *  - SPYGLASS_PID_FILE             — PID 파일 경로 오버라이드 (기본 ~/.spyglass/server.pid)
 *  - SPYGLASS_SHUTDOWN_TIMEOUT_MS  — graceful shutdown deadline (기본 10000)
 *  - SPYGLASS_DAEMON_LOG           — `start` 의 detached child stdout/stderr 리다이렉트 경로
 *                                    (기본 ~/.spyglass/server.log)
 *
 * 종료 코드:
 *  - 0: 정상
 *  - 1: shutdown 중 예외 또는 deadline 초과로 강제 종료
 *  - 130: 동일 신호 2회 수신(double-SIGINT 등) force-quit
 */

import { PORT, HOST, SHUTDOWN_TIMEOUT_MS } from './config';
import {
  isPortAvailable,
  findProcessesByPort,
  waitForProcessExit,
  waitForPortRelease,
} from './port';
import { startServer, stopServer } from './lifecycle';
import { getInFlightCount } from './in-flight';
import { doctor } from '../cli/doctor';
import { analyze } from '../cli/analyze';
import { openCommand } from '../cli/open';
import { isDiagEnabled } from '../diag-log';
import { serverLogBucketForToday } from './log-paths';

/** double-signal 보호 플래그 — 두 번째 신호는 force-quit로 해석 */
let shuttingDown = false;

function getPidFile(): string {
  // 운영/임시 인스턴스 분리: 환경변수로 PID 파일 경로 오버라이드 가능
  return process.env.SPYGLASS_PID_FILE || `${process.env.HOME}/.spyglass/server.pid`;
}

/**
 * graceful shutdown 공통 흐름.
 *
 *  - 첫 신호: stopServer를 deadline 내에서 await. PID 파일 정리. exit(0).
 *  - 두 번째 신호: 즉시 exit(130) — 사용자의 force-quit 의도 인식.
 *  - deadline 초과: exit(1) — guard timer가 강제 종료.
 *
 * 로그는 stderr로 — lifecycle.installServerStdioMirror가 stdout을 가로채는 동안
 * stdout으로 찍으면 미러링 충돌/순서 흔들림이 발생할 수 있다.
 */
async function gracefulShutdown(signal: string, pidFile: string | null): Promise<void> {
  if (shuttingDown) {
    process.stderr.write(`\n[Server] ${signal} received again — forcing exit\n`);
    process.exit(130);
  }
  shuttingDown = true;
  process.stderr.write(
    `\n[Server] ${signal} received — graceful shutdown (timeout ${SHUTDOWN_TIMEOUT_MS}ms)\n`,
  );

  const guard = setTimeout(() => {
    process.stderr.write(
      `[Server] graceful shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms — forcing exit\n`,
    );
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  guard.unref();

  try {
    await stopServer();
  } catch (err) {
    process.stderr.write(`[Server] shutdown error: ${String(err)}\n`);
    clearTimeout(guard);
    process.exit(1);
  }

  if (pidFile) {
    try {
      const fs = require('fs');
      if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    } catch {}
  }

  clearTimeout(guard);
  process.exit(0);
}

/**
 * SIGTERM/SIGINT 핸들러 설치.
 *  - pidFile=null이면 PID 파일 정리 단계 생략 (foreground 모드 등).
 */
function installShutdownHandlers(pidFile: string | null): void {
  process.on('SIGINT', () => gracefulShutdown('SIGINT', pidFile));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM', pidFile));
}

function writePidFile(pidFile: string, pid?: string | number): void {
  try {
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, String(pid ?? process.pid));
  } catch {}
}

/**
 * `start` 가 자기 자신을 `serve` 모드로 detached spawn 하기 위한 명령 구성.
 *
 * process.argv 형태:
 *   - standalone bin       : [binPath, command, ...rest]                 → entry 가 .ts/.js 아님
 *   - bun + .ts entry (dev): [bunPath, scriptPath, command, ...rest]     → argv[1] 이 .ts/.js
 *
 * 두 경우 모두 command 자리를 'serve' 로 교체해 child 가 동일 entry 로 foreground 실행되게 한다.
 */
function buildRespawnCommand(): { cmd: string; args: string[] } {
  const entry = process.argv[1];
  const isScriptEntry = !!entry && /\.[mc]?[jt]s$/i.test(entry);
  if (isScriptEntry) {
    return { cmd: process.execPath, args: [entry, 'serve'] };
  }
  return { cmd: process.execPath, args: ['serve'] };
}

async function commandStart(pidFile: string): Promise<void> {
  const fs = require('fs');
  const path = require('path');
  const { spawn: nodeSpawn } = require('node:child_process');

  // 1. PORT를 LISTEN 중인 spyglass server가 이미 있는지 확인.
  //    findProcessesByPort는 -sTCP:LISTEN 필터 → proxy 클라이언트(클로드 코드) 안 잡힘.
  //    PID 파일을 신뢰하지 않는다 — stale + PID 재할당 시 무관한 프로세스를 "Already running"으로
  //    잘못 보고할 수 있기 때문. LISTEN 결과만이 spyglass 식별의 SSoT.
  const listeningPids = findProcessesByPort(PORT);
  if (listeningPids.length > 0) {
    console.log(`[Server] Already running (PID: ${listeningPids.join(', ')})`);
    process.exit(0);
  }

  // 2. stale PID 파일은 정리 (남아 있어도 LISTEN 안 함이 위 1번에서 확정됨)
  if (fs.existsSync(pidFile)) {
    try { fs.unlinkSync(pidFile); } catch {}
  }

  // 3. 포트 가용성 확인 — LISTEN은 없지만 TIME_WAIT 등으로 막힐 수 있음.
  if (!(await isPortAvailable(PORT))) {
    console.error(`[Server] Port ${PORT} is unavailable (likely TIME_WAIT)`);
    console.error(`[Server] Run 'spyglass restart' to retry with cleanup`);
    process.exit(1);
  }

  // 4. 자기 자신을 `serve` 모드로 detached spawn 한다.
  //    DIAG 게이트(collect.sh·stdio-mirror 와 통일):
  //      - OFF(기본): child stdout/stderr 를 콘솔로 inherit — 영구 파일 적재 없음.
  //      - ON: `logs/server/YYYY-MM-DD.log` 일자 버킷에 append. `SPYGLASS_DAEMON_LOG` 로 고정 경로 override.
  //    (detached child 는 spawn 시 fd 가 고정되므로 자정 롤오버는 안 됨 — restart 마다 새 일자 파일.)
  const diagOn = isDiagEnabled();
  let logPath: string | null = null;
  let childStdio: ('ignore' | 'inherit' | number)[] = ['ignore', 'inherit', 'inherit'];
  if (diagOn) {
    logPath = process.env.SPYGLASS_DAEMON_LOG || serverLogBucketForToday();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const logFd = fs.openSync(logPath, 'a');
    childStdio = ['ignore', logFd, logFd];
  }

  const { cmd, args } = buildRespawnCommand();
  const child = nodeSpawn(cmd, args, {
    stdio: childStdio,
    detached: true,
    env: process.env,
  });
  child.unref();

  // 5. child PID 기록 + 부모 즉시 종료. child 는 `serve` 모드라 PID 파일을 만들지 않으므로
  //    여기서만 한 번 기록한다. stop/status 는 LISTEN PID 가 SSoT 이므로 PID 파일은 힌트일 뿐.
  writePidFile(pidFile, child.pid);
  console.log(`[Server] Started (PID: ${child.pid}) — manual mode`);
  console.log(`[Server] Endpoint: http://${HOST}:${PORT}`);
  console.log(
    logPath
      ? `[Server] Logs: ${logPath}`
      : `[Server] Logs: console (set SPYGLASS_DIAG_ENABLED=1 to persist to logs/server/)`
  );
  console.log('Tip: `brew services start spyglass` for auto-start at login');
  process.exit(0);
}

function commandStop(pidFile: string): void {
  const fs = require('fs');

  // PORT를 LISTEN 중인 spyglass server PID만 SIGTERM.
  // PID 파일을 신뢰하지 않는다 — stale + PID 재할당 시 무관한 프로세스(예: 작업 중인
  // 클로드 코드 CLI)를 죽일 수 있기 때문. LISTEN 결과만이 종료 대상 결정의 SSoT.
  const listeningPids = findProcessesByPort(PORT);

  if (listeningPids.length === 0) {
    console.log('[Server] Not running');
    if (fs.existsSync(pidFile)) {
      try { fs.unlinkSync(pidFile); } catch {}
    }
    process.exit(0);
  }

  for (const pid of listeningPids) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`[Server] Stopped (PID: ${pid})`);
    } catch (error) {
      console.error(`[Server] Failed to stop (PID: ${pid}):`, error);
    }
  }

  if (fs.existsSync(pidFile)) {
    try { fs.unlinkSync(pidFile); } catch {}
  }

  console.log('Note: brew services users — also run `brew services stop spyglass`');
}

async function commandRestart(pidFile: string): Promise<void> {
  const fs = require('fs');

  // 1. PORT를 LISTEN 중인 spyglass server PID만 종료 대상으로 선정.
  //    PID 파일의 savedPid를 무조건 kill 대상에 포함시키던 우회 경로 제거 —
  //    stale + PID 재할당 시 proxy 클라이언트(클로드 코드 CLI 등)를 죽일 수 있기 때문.
  //    LISTEN 결과만이 종료 대상 결정의 단일 SSoT.
  const listeningPids = findProcessesByPort(PORT);

  if (listeningPids.length === 0) {
    console.log(`[Server] Port ${PORT} is available (no listening server)`);
  } else {
    console.log(`[Server] Stopping listening server(s): PID ${listeningPids.join(', ')}`);

    for (const pid of listeningPids) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`[Server] Stopping process (PID: ${pid})...`);

        // graceful shutdown deadline 동안 drain 진행도를 stderr로 표시.
        //  - 사용자 인내심 확보 + 어떤 작업이 남았는지 가시화.
        //  - in-flight==0이면 stopServer가 빠르게 끝나므로 진행도 표시도 빠르게 종료된다 (fast-path).
        const exited = await waitForProcessExit(
          pid,
          SHUTDOWN_TIMEOUT_MS,
          (remainingMs) => {
            process.stderr.write(
              `[Server] Draining PID ${pid}... (${Math.ceil(remainingMs / 1000)}s remaining)\n`,
            );
          },
        );
        if (!exited) {
          console.log(`[Server] Force killing process (PID: ${pid})...`);
          try { process.kill(pid, 'SIGKILL'); } catch {}
        }
      } catch {}
    }

    // stale PID 파일 정리 (서버 PID는 LISTEN 결과로 식별 끝)
    if (fs.existsSync(pidFile)) {
      try { fs.unlinkSync(pidFile); } catch {}
    }

    // 포트 해제 대기 (OS 레벨 TIME_WAIT 등)
    console.log(`[Server] Waiting for port ${PORT} to be released...`);
    const released = await waitForPortRelease(PORT, 5000);
    if (!released) {
      console.error(`[Server] Failed to release port ${PORT}. Please check manually.`);
      process.exit(1);
    }
    console.log(`[Server] Port ${PORT} is now available`);
  }

  // 2. 서버 시작
  startServer();
  writePidFile(pidFile);
  console.log(`[Server] Restarted (PID: ${process.pid})`);

  installShutdownHandlers(pidFile);
}

function commandStatus(pidFile: string): void {
  const fs = require('fs');

  // PORT LISTEN 필터로 spyglass server 식별 (PID 파일은 신뢰 X — PID 재할당 시 오탐 위험).
  const listeningPids = findProcessesByPort(PORT);
  if (listeningPids.length > 0) {
    console.log(`[Server] Running (PID: ${listeningPids.join(', ')})`);
    console.log(`[Server] Endpoint: http://${HOST}:${PORT}`);
    const inFlight = getInFlightCount();
    if (inFlight > 0) {
      console.log(`[Server] In-flight background tasks: ${inFlight}`);
    }
    return;
  }

  if (fs.existsSync(pidFile)) {
    console.log('[Server] Not running (stale PID file — cleaned up)');
    try { fs.unlinkSync(pidFile); } catch {}
  } else {
    console.log('[Server] Not running');
  }
}

/**
 * foreground blocking 실행. launchd / brew services / docker 가 직접 호출하는 명령.
 * PID 파일을 만들지 않고 stdout/stderr 를 그대로 유지한다 — 호스트 supervisor 가 로그/생명주기 책임.
 */
function commandServe(): void {
  startServer();
  installShutdownHandlers(null);
}

/**
 * CLI 명령 디스패처. import.meta.main 진입점에서 호출.
 *
 * @param args  `process.argv.slice(2)` — command + 옵션들.
 */
export async function dispatchDaemonCommand(args: string[]): Promise<void> {
  const command = args[0];
  const rest = args.slice(1);
  const pidFile = getPidFile();

  switch (command) {
    case 'serve':
      commandServe();
      break;
    case 'start':
      await commandStart(pidFile);
      break;
    case 'stop':
      commandStop(pidFile);
      break;
    case 'restart':
      await commandRestart(pidFile);
      break;
    case 'status':
      commandStatus(pidFile);
      break;
    case 'doctor':
      await doctor(rest.includes('--fix'));
      break;
    case 'analyze':
      await analyze(rest);
      break;
    case 'open':
      await openCommand();
      break;
    case undefined:
      // 인자 없이 호출 — `serve` 와 동일. brew services 가 `run [opt_bin/"spyglass"]` 만 적어도 동작.
      commandServe();
      break;
    default:
      console.error(`[Server] Unknown command: ${command}`);
      console.error('Usage: spyglass <serve|start|stop|restart|status|open|doctor|analyze>');
      process.exit(1);
  }
}
