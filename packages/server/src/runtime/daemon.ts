/**
 * 데몬 명령 — start/stop/restart/status (PID 파일 기반 싱글톤).
 *
 * 변경 이유: 명령어 추가/제거, PID 파일 위치/포맷 변경, 시그널 처리 정책 변경 시 묶여서 손이 가는 묶음.
 */

import { PORT, HOST } from './config';
import {
  isPortAvailable,
  findProcessesByPort,
  waitForProcessExit,
  waitForPortRelease,
} from './port';
import { startServer, stopServer } from './lifecycle';

function getPidFile(): string {
  // 운영/임시 인스턴스 분리: 환경변수로 PID 파일 경로 오버라이드 가능
  return process.env.SPYGLASS_PID_FILE || `${process.env.HOME}/.spyglass/server.pid`;
}

function installShutdownHandlers(pidFile: string, removePidOnExit: boolean = true): void {
  process.on('SIGINT', async () => {
    console.log('\n[Server] Shutting down...');
    await stopServer();
    if (removePidOnExit) {
      try {
        const fs = require('fs');
        if (fs.existsSync(pidFile)) {
          fs.unlinkSync(pidFile);
        }
      } catch {}
    }
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await stopServer();
    process.exit(0);
  });
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

        const exited = await waitForProcessExit(pid, 5000);
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

  process.on('SIGINT', async () => {
    console.log('\n[Server] Shutting down...');
    await stopServer();
    process.exit(0);
  });
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
