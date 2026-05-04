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

  // 1. PID 파일로 실행 중인지 확인
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8'), 10);
    try {
      process.kill(pid, 0);
      console.log(`[Server] Already running (PID: ${pid})`);
      process.exit(0);
    } catch {
      fs.unlinkSync(pidFile);
    }
  }

  // 2. 포트 사용 가능 여부 확인
  if (!(await isPortAvailable(PORT))) {
    console.error(`[Server] Port ${PORT} is already in use`);
    const blockingPids = findProcessesByPort(PORT);
    if (blockingPids.length > 0) {
      console.error(`[Server] Blocking process(es): PID ${blockingPids.join(', ')}`);
      console.error(`[Server] Run 'bun run dev' to restart with auto-cleanup`);
    }
    process.exit(1);
  }

  // 3. 서버 시작
  startServer();

  // PID 파일 저장
  writePidFile(pidFile);

  // 종료 시그널 처리
  installShutdownHandlers(pidFile);
}

function commandStop(pidFile: string): void {
  const fs = require('fs');
  if (!fs.existsSync(pidFile)) {
    console.log('[Server] Not running');
    process.exit(0);
  }

  const pid = parseInt(fs.readFileSync(pidFile, 'utf-8'), 10);
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`[Server] Stopped (PID: ${pid})`);
    fs.unlinkSync(pidFile);
  } catch (error) {
    console.error('[Server] Failed to stop:', error);
    process.exit(1);
  }
}

async function commandRestart(pidFile: string): Promise<void> {
  const fs = require('fs');

  // 1. 먼저 포트 사용 가능 여부 확인
  if (await isPortAvailable(PORT)) {
    console.log(`[Server] Port ${PORT} is available`);
  } else {
    console.log(`[Server] Port ${PORT} is in use, attempting to free it...`);

    // 2. PID 파일 또는 포트 점유 프로세스 찾기
    let pidsToKill: number[] = [];
    if (fs.existsSync(pidFile)) {
      const savedPid = parseInt(fs.readFileSync(pidFile, 'utf-8'), 10);
      fs.unlinkSync(pidFile);
      pidsToKill = [savedPid, ...findProcessesByPort(PORT).filter(p => p !== savedPid)];
    } else {
      pidsToKill = findProcessesByPort(PORT);
    }

    // 3. 프로세스 종료 (포트 점유 프로세스 전체)
    for (const pid of pidsToKill) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`[Server] Stopping process (PID: ${pid})...`);

        // 4. 프로세스 종료 대기
        const exited = await waitForProcessExit(pid, 5000);
        if (!exited) {
          console.log(`[Server] Force killing process (PID: ${pid})...`);
          try { process.kill(pid, 'SIGKILL'); } catch {}
        }
      } catch {}
    }

    // 5. 포트 해제 대기
    console.log(`[Server] Waiting for port ${PORT} to be released...`);
    const released = await waitForPortRelease(PORT, 5000);
    if (!released) {
      console.error(`[Server] Failed to release port ${PORT}. Please check manually.`);
      process.exit(1);
    }
    console.log(`[Server] Port ${PORT} is now available`);
  }

  // 6. 서버 시작
  startServer();
  writePidFile(pidFile);
  console.log(`[Server] Restarted (PID: ${process.pid})`);

  installShutdownHandlers(pidFile);
}

function commandStatus(pidFile: string): void {
  const fs = require('fs');
  if (fs.existsSync(pidFile)) {
    const pid = fs.readFileSync(pidFile, 'utf-8').trim();
    try {
      process.kill(parseInt(pid, 10), 0);
      console.log(`[Server] Running (PID: ${pid})`);
      console.log(`[Server] Endpoint: http://${HOST}:${PORT}`);
    } catch {
      console.log('[Server] Not running (stale PID file)');
      fs.unlinkSync(pidFile);
    }
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
