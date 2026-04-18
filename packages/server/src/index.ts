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
} from '@spyglass/storage';
import { collectHandler } from './collect';
import { eventsCollectHandler } from './events';
import { apiRouter, invalidateDashboardCache } from './api';
import { sseRouter, broadcastUpdate } from './sse';

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
// 유지보수
// =============================================================================

/**
 * 서버 시작 시 오래된 데이터 정리 및 DB 압축
 * SPYGLASS_RETENTION_DAYS 환경변수로 보존 기간 설정 (기본: 90일)
 */
function runStartupMaintenance(database: SpyglassDatabase): void {
  const retentionDays = parseInt(process.env.SPYGLASS_RETENTION_DAYS ?? '90', 10);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  try {
    const deleted = deleteOldSessions(database.instance, cutoff);
    database.instance.run('PRAGMA VACUUM');
    if (deleted > 0) {
      console.log(`[Maintenance] Deleted ${deleted} sessions older than ${retentionDays} days`);
    }
  } catch (err) {
    console.warn('[Maintenance] Cleanup failed:', err);
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
    // /collect 엔드포인트
    if (path === '/collect') {
      const result = await collectHandler(req, db!);
      // 데이터 수신 후 캐시 무효화 + SSE 브로드캐스트
      if (result.status === 200) {
        invalidateDashboardCache();
        broadcastUpdate({ type: 'new_request' });
      }
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

    // 정적 파일 서빙 (favicon 등 packages/web/ 하위 파일)
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

  // 데이터베이스 연결
  db = getDatabase({ dbPath });
  console.log(`[Server] Database connected: ${dbPath}`);

  // 시작 시 유지보수 (오래된 데이터 정리)
  runStartupMaintenance(db);

  // 서버 시작
  server = Bun.serve({
    port,
    hostname: host,
    fetch: handleRequest,
  });

  console.log(`[Server] Running on http://${host}:${port}`);
  console.log(`[Server] Health check: http://${host}:${port}/health`);

  return server;
}

/**
 * 서버 종료
 */
export async function stopServer(): Promise<void> {
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
  const pidFile = `${process.env.HOME}/.spyglass/server.pid`;

  // 명령어 처리
  const command = process.argv[2];

  switch (command) {
    case 'start': {
      // 이미 실행 중인지 확인
      try {
        const fs = require('fs');
        if (fs.existsSync(pidFile)) {
          const pid = parseInt(fs.readFileSync(pidFile, 'utf-8'), 10);
          try {
            process.kill(pid, 0); // 프로세스 존재 확인
            console.log(`[Server] Already running (PID: ${pid})`);
            process.exit(0);
          } catch {
            // 프로세스가 존재하지 않음, PID 파일 삭제
            fs.unlinkSync(pidFile);
          }
        }
      } catch {}

      // 서버 시작
      startServer();

      // PID 파일 저장
      try {
        const fs = require('fs');
        fs.mkdirSync(`${process.env.HOME}/.spyglass`, { recursive: true });
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
      const { execSync } = require('child_process');

      // PID 파일 또는 포트 점유 프로세스 종료
      let pidToKill: number | null = null;
      if (fs.existsSync(pidFile)) {
        pidToKill = parseInt(fs.readFileSync(pidFile, 'utf-8'), 10);
        fs.unlinkSync(pidFile);
      } else {
        try {
          const out = execSync(`lsof -ti :${PORT}`, { encoding: 'utf-8' }).trim();
          if (out) pidToKill = parseInt(out, 10);
        } catch {}
      }

      if (pidToKill) {
        try {
          process.kill(pidToKill, 'SIGTERM');
          console.log(`[Server] Stopped (PID: ${pidToKill})`);
          // 프로세스가 완전히 종료될 때까지 대기
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 100));
            try { process.kill(pidToKill!, 0); } catch {
              // 프로세스 종료 후 포트 해제 대기 (OS 레벨 정리 시간)
              await new Promise(resolve => setTimeout(resolve, 500));
              break;
            }
          }
        } catch {}
      }

      startServer();
      fs.mkdirSync(`${process.env.HOME}/.spyglass`, { recursive: true });
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
