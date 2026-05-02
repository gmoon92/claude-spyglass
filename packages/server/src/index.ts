/**
 * spyglass Server
 *
 * @description Bun HTTP 서버 - API + SSE 스트리밍
 * @see docs/planning/03-adr.md - ADR-001 (글로벌 데몬)
 */

import {
  SpyglassDatabase,
  getDatabase,
  closeDatabase,
  getDefaultDbPath,
  deleteOldSessions,
  getMetadata,
  setMetadata,
} from '@spyglass/storage';
import { handleHookHttpRequest } from './hook';
import { eventsCollectHandler } from './events';
import { apiRouter, invalidateDashboardCache } from './api';
import { sseRouter } from './sse';
import { handleProxy } from './proxy';
import { clearDiagLogs, getDiagLogDir } from './diag-log';

// =============================================================================
// 설정
// =============================================================================

/** 기본 포트 */
const DEFAULT_PORT = 9999;

/** 환경변수에서 설정 */
const PORT = parseInt(process.env.SPGLASS_PORT || `${DEFAULT_PORT}`, 10);
const HOST = process.env.SPGLASS_HOST || '127.0.0.1';
const DB_PATH = process.env.SPGLASS_DB_PATH || getDefaultDbPath();

/** 서버 인스턴스 */
let server: ReturnType<typeof Bun.serve> | null = null;
let db: SpyglassDatabase | null = null;

// =============================================================================
// 포트 유틸리티
// =============================================================================

/**
 * 포트 사용 가능 여부 확인 (테스트 서버로 검증)
 */
async function isPortAvailable(port: number): Promise<boolean> {
  try {
    const testServer = Bun.serve({
      port,
      hostname: HOST,
      fetch: () => new Response("test"),
    });
    testServer.stop();
    return true;
  } catch {
    return false;
  }
}

/**
 * 포트를 점유한 프로세스 ID 목록 찾기
 */
function findProcessesByPort(port: number): number[] {
  try {
    const { execSync } = require('child_process');
    const out = execSync(`lsof -ti :${port}`, { encoding: 'utf-8' }).trim();
    return out ? out.split('\n').map(Number).filter((n: number) => !isNaN(n) && n > 0) : [];
  } catch {
    return [];
  }
}

/**
 * 프로세스가 완전히 종료될 때까지 대기
 */
async function waitForProcessExit(pid: number, timeoutMs: number = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * 포트 해제 대기 (OS 레벨 TIME_WAIT 등)
 */
async function waitForPortRelease(port: number, timeoutMs: number = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortAvailable(port)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
}

// =============================================================================
// 유지보수
// =============================================================================

const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000; // 1시간마다 조건 체크
const METADATA_KEY_LAST_CLEANUP = 'last_cleanup_date'; // 저장 형식: YYYY-MM-DD

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 오늘 아직 cleanup을 실행하지 않았으면 실행한다.
 * - 서버 시작 시 즉시 호출
 * - 이후 1시간 간격 인터벌에서도 호출 (날짜가 바뀐 시점을 놓치지 않기 위해)
 *
 * SPYGLASS_RETENTION_DAYS 환경변수로 보존 기간 설정 (기본: 90일)
 */
function runDailyMaintenanceIfNeeded(database: SpyglassDatabase): void {
  try {
    const today = todayDateString();
    const lastRun = getMetadata(database.instance, METADATA_KEY_LAST_CLEANUP);
    if (lastRun === today) return;

    const retentionDays = parseInt(process.env.SPYGLASS_RETENTION_DAYS ?? '90', 10);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const deleted = deleteOldSessions(database.instance, cutoff);
    database.instance.run('PRAGMA VACUUM');

    setMetadata(database.instance, METADATA_KEY_LAST_CLEANUP, today);
    console.log(`[Maintenance] Cleanup done (${today}): removed ${deleted} sessions older than ${retentionDays}d`);
  } catch (err) {
    console.warn('[Maintenance] Cleanup failed:', err);
  }
}

let maintenanceTimer: ReturnType<typeof setInterval> | null = null;

function startMaintenanceSchedule(database: SpyglassDatabase): void {
  runDailyMaintenanceIfNeeded(database);
  maintenanceTimer = setInterval(
    () => runDailyMaintenanceIfNeeded(database),
    MAINTENANCE_INTERVAL_MS
  );
}

function stopMaintenanceSchedule(): void {
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }
}

// =============================================================================
// 라우팅
// =============================================================================

/**
 * 메인 요청 핸들러
 */
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS 프리플라이트
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  try {
    // /v1/* — Anthropic API 프록시 (ANTHROPIC_BASE_URL 설정 시 활성화)
    if (path.startsWith('/v1/')) {
      return handleProxy(req, url, db!.instance);
    }

    // /collect 엔드포인트 — raw Claude Code hook payload 수신 후 서버에서 정제
    if (path === '/collect') {
      const result = await handleHookHttpRequest(req, db!);
      // 캐시 무효화 (SSE 브로드캐스트는 handleCollect 내부 broadcastNewRequest가 담당)
      if (result.status === 200) invalidateDashboardCache();
      return result;
    }

    // /events: POST = raw hook 수집, GET = SSE 스트림
    if (path === '/events') {
      if (req.method === 'POST') {
        return eventsCollectHandler(req, db!.instance);
      }
      return sseRouter(req);
    }

    // /api/* REST API
    if (path.startsWith('/api/')) {
      return apiRouter(req, db!.instance);
    }

    // /health 헬스체크
    if (path === '/health') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          timestamp: Date.now(),
          version: '0.1.0',
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // 루트 경로 - 웹 대시보드
    if (path === '/') {
      const webDir = new URL('../../web/index.html', import.meta.url);
      const file = Bun.file(webDir);
      if (await file.exists()) {
        return new Response(file, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return new Response(
        JSON.stringify({ name: 'spyglass', version: '0.1.0' }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 정적 자산 서빙 (/assets/ prefix → packages/web/assets/)
    if (path.startsWith('/assets/')) {
      const safePath = path.split('?')[0].replace(/\.\./g, '');
      const staticFile = new URL(`../../web${safePath}`, import.meta.url);
      const file = Bun.file(staticFile);
      if (await file.exists()) {
        const ext = safePath.split('.').pop() ?? '';
        const mimeMap: Record<string, string> = {
          js:  'application/javascript',
          css: 'text/css',
          svg: 'image/svg+xml',
          ico: 'image/x-icon',
        };
        return new Response(file, {
          headers: { 'Content-Type': mimeMap[ext] ?? 'application/octet-stream' },
        });
      }
    }

    // favicon 서빙 (하위 호환)
    if (/^\/(favicon\.svg|favicon\.ico)/.test(path)) {
      const fileName = path.split('?')[0].slice(1);
      const staticFile = new URL(`../../web/${fileName}`, import.meta.url);
      const file = Bun.file(staticFile);
      if (await file.exists()) {
        const ext = fileName.split('.').pop();
        const mime = ext === 'svg' ? 'image/svg+xml' : 'image/x-icon';
        return new Response(file, { headers: { 'Content-Type': mime } });
      }
    }

    // 404
    return new Response(
      JSON.stringify({ error: 'Not found', path }),
      {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('[Server] Error handling request:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

// =============================================================================
// 서버 시작/종료
// =============================================================================

/**
 * 서버 시작
 */
export function startServer(options: {
  port?: number;
  host?: string;
  dbPath?: string;
} = {}): ReturnType<typeof Bun.serve> {
  const port = options.port || PORT;
  const host = options.host || HOST;
  const dbPath = options.dbPath || DB_PATH;

  // 이미 실행 중인지 확인
  if (server) {
    console.log(`[Server] Already running on ${HOST}:${PORT}`);
    return server;
  }

  // 진단 로그 디렉토리 정리 — DIAG ON/OFF 무관, 새 서버 라이프사이클은 깨끗한 상태에서 시작
  const cleared = clearDiagLogs();
  if (cleared > 0) {
    console.log(`[Server] Cleared ${cleared} diagnostic log file(s) at ${getDiagLogDir()}`);
  }

  // 데이터베이스 연결
  db = getDatabase({ dbPath });
  console.log(`[Server] Database connected: ${dbPath}`);

  // 일별 유지보수 스케줄 시작 (시작 시 즉시 + 1시간 인터벌로 날짜 변경 감지)
  startMaintenanceSchedule(db);

  // 서버 시작
  server = Bun.serve({
    port,
    hostname: host,
    fetch: handleRequest,
    idleTimeout: 0,  // SSE 연결 유지: Bun 기본값 10초 비활성화
  });

  console.log(`[Server] Running on http://${host}:${port}`);
  console.log(`[Server] Health check: http://${host}:${port}/health`);

  return server;
}

/**
 * 서버 종료
 */
export async function stopServer(): Promise<void> {
  stopMaintenanceSchedule();

  if (server) {
    server.stop();
    server = null;
    console.log('[Server] Stopped');
  }

  if (db) {
    closeDatabase();
    db = null;
    console.log('[Server] Database closed');
  }
}

/**
 * 서버 상태 확인
 */
export function isServerRunning(): boolean {
  return server !== null;
}

// =============================================================================
// CLI 실행
// =============================================================================

if (import.meta.main) {
  // 프로세스 관리 (싱글톤)
  // 운영/임시 인스턴스 분리: 환경변수로 PID 파일 경로 오버라이드 가능
  const pidFile = process.env.SPYGLASS_PID_FILE || `${process.env.HOME}/.spyglass/server.pid`;

  // 명령어 처리
  const command = process.argv[2];

  switch (command) {
    case 'start': {
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

      // PID 파일 저장 (pidFile 디렉토리는 동적으로 결정)
      try {
        const fs = require('fs');
        const path = require('path');
        fs.mkdirSync(path.dirname(pidFile), { recursive: true });
        fs.writeFileSync(pidFile, process.pid.toString());
      } catch {}

      // 종료 시그널 처리
      process.on('SIGINT', async () => {
        console.log('\n[Server] Shutting down...');
        await stopServer();
        try {
          const fs = require('fs');
          if (fs.existsSync(pidFile)) {
            fs.unlinkSync(pidFile);
          }
        } catch {}
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        await stopServer();
        process.exit(0);
      });

      break;
    }

    case 'stop': {
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
      break;
    }

    case 'restart': {
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
      const path = require('path');
      fs.mkdirSync(path.dirname(pidFile), { recursive: true });
      fs.writeFileSync(pidFile, process.pid.toString());
      console.log(`[Server] Restarted (PID: ${process.pid})`);

      process.on('SIGINT', async () => {
        console.log('\n[Server] Shutting down...');
        await stopServer();
        if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        await stopServer();
        process.exit(0);
      });

      break;
    }

    case 'status': {
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
      break;
    }

    default: {
      // 기본: 포그라운드 실행
      startServer();

      process.on('SIGINT', async () => {
        console.log('\n[Server] Shutting down...');
        await stopServer();
        process.exit(0);
      });
    }
  }
}
