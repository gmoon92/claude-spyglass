/**
 * 서버 라이프사이클 — start/stop/isRunning + 모듈 내부 server·db 상태.
 *
 * 변경 이유: 서버 부팅 절차(DB 연결, 진단 로그 정리, 유지보수 스케줄, Bun.serve 설정) 변경 시 한 곳만 수정.
 */

import { SpyglassDatabase, getDatabase, closeDatabase } from '@spyglass/storage';
import { clearDiagLogs, getDiagLogDir, logDiagStatus } from '../diag-log';
import { PORT, HOST, DB_PATH } from './config';
import { startMaintenanceSchedule, stopMaintenanceSchedule } from './maintenance';
import { handleRequest } from './dispatch';
import { bootstrapSync as bootstrapMetaDocsSync } from '../meta-docs';

/** 서버 인스턴스 */
let server: ReturnType<typeof Bun.serve> | null = null;
let db: SpyglassDatabase | null = null;

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

  // v24: 메타 문서 카탈로그 부팅 동기화 — 글로벌(`~/.claude`) 1회 스캔.
  //  실패해도 부팅은 성공해야 하므로 try/catch로 격리. project chain은 SessionStart에서 lazy 동기화.
  try {
    bootstrapMetaDocsSync(db.instance);
  } catch (e) {
    console.error('[Server] meta-docs bootstrap sync failed:', e);
  }

  // 서버 시작
  server = Bun.serve({
    port,
    hostname: host,
    fetch: (req: Request) => handleRequest(req, db!),
    idleTimeout: 0,  // SSE 연결 유지: Bun 기본값 10초 비활성화
  });

  console.log(`[Server] Running on http://${host}:${port}`);
  console.log(`[Server] Health check: http://${host}:${port}/health`);

  // 진단 로그 모드 상태/활성화 방법을 부팅 배너에 출력 (self-documenting boot message)
  logDiagStatus();

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
