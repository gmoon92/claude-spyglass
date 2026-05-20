/**
 * 데몬 명령 — start/stop/restart/status (PID 파일 기반 싱글톤).
 *
 * 책임:
 *  - CLI 명령 디스패치 (start/stop/restart/status/foreground default).
 *  - graceful shutdown 신호 핸들링: SIGTERM/SIGINT → stopServer → process.exit.
 *  - restart 시 LISTEN 중인 기존 서버를 SIGTERM으로 drain하고 새 서버 기동.
 *
 * 의존성:
 *  - runtime/config: PORT/HOST
 *  - runtime/port: isPortAvailable / findProcessesByPort / waitForProcessExit / waitForPortRelease
 *  - runtime/lifecycle: startServer / stopServer
 *
 * 변경 이유:
 *  - 명령어 추가/제거, PID 파일 위치/포맷 변경, 시그널 처리 정책 변경 시 한 곳만 수정.
 *  - graceful shutdown deadline/진행도 표시 정책도 여기에 모은다 (단일 SSoT).
 *
 * 환경 변수:
 *  - SPYGLASS_PID_FILE        — PID 파일 경로 오버라이드 (기본 ~/.spyglass/server.pid)
 *  - SPYGLASS_SHUTDOWN_TIMEOUT_MS — graceful shutdown deadline (기본 10000)
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

function writePidFile(pidFile: string): void {
  try {
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(path.dirname(pidFile), { recursive: true });
    fs.writeFileSync(pidFile, process.pid.toString());
  } catch {}
}

async function commandStart(pidFile: string): Promise<void> {
  const fs = require('fs');

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
    console.error(`[Server] Run 'bun run dev' to restart with auto-cleanup`);
    process.exit(1);
  }

  // 4. 서버 시작
  startServer();
  writePidFile(pidFile);
  installShutdownHandlers(pidFile);
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
    console.log('[Server] Not running (stale PID file)');
    try { fs.unlinkSync(pidFile); } catch {}
  } else {
    console.log('[Server] Not running');
  }
}

function commandForeground(): void {
  startServer();
  // foreground 모드는 PID 파일을 사용하지 않으므로 정리 단계 없음 (null 전달).
  installShutdownHandlers(null);
}

/**
 * CLI 명령 디스패처. import.meta.main 진입점에서 호출.
 */
export async function dispatchDaemonCommand(command: string | undefined): Promise<void> {
  const pidFile = getPidFile();

  switch (command) {
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
    default:
      // 기본: 포그라운드 실행
      commandForeground();
  }
}
