/**
 * spyglass Server
 *
 * @description Bun HTTP 서버 - API + SSE 스트리밍
 * @see docs/planning/03-adr.md - ADR-001 (글로벌 데몬)
 */

import { Database } from 'bun:sqlite';
import {
  SpyglassDatabase,
  getDatabase,
  closeDatabase,
  getDefaultDbPath,
} from '@spyglass/storage';
import { collectHandler } from './collect';
import { apiRouter } from './api';
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
      // 데이터 수신 후 SSE 브로드캐스트
      if (result.status === 200) {
        broadcastUpdate({ type: 'new_request', timestamp: Date.now() });
      }
      return result;
    }

    // /events SSE 엔드포인트
    if (path === '/events') {
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

    // 루트 경로
    if (path === '/') {
      return new Response(
        JSON.stringify({
          name: 'spyglass',
          version: '0.1.0',
          endpoints: {
            collect: 'POST /collect',
            events: 'GET /events',
            api: '/api/*',
            health: 'GET /health',
          },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
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
