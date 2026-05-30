/**
 * 서버 라이프사이클 — start/stop/isRunning + 모듈 내부 server·db 상태.
 *
 * 책임:
 *  - Bun.serve 인스턴스 + DB 연결 + 스케줄러 lifecycle 한 곳에서 관리.
 *  - startServer: 부팅 절차(DB 연결, 진단 로그 정리, 유지보수/버전 체크 스케줄, meta-docs sync).
 *  - stopServer: graceful shutdown 시퀀스
 *      1) 스케줄러 정리 (DB 접근 끊기)
 *      2) SSE 클라이언트에 server_shutdown 이벤트 broadcast + 250ms grace
 *      3) closeAllConnections — SSE 연결 정상 close (EventSource RST 회피)
 *      4) await server.stop() — 새 연결 거부 + in-flight HTTP 응답 자연 종료
 *      5) await awaitInFlight — proxy stream 분석/persist/broadcast IIFE 완료 대기
 *      6) DB close
 *
 * 변경 이유:
 *  - 서버 부팅 절차(DB, 진단 로그, 스케줄, Bun.serve 설정) 변경 시 한 곳.
 *  - graceful shutdown 시퀀스(이벤트→close→serve.stop→IIFE→DB) 변경 시도 한 곳.
 *
 * 의존성:
 *  - runtime/config: SHUTDOWN_TIMEOUT_MS
 *  - runtime/in-flight: awaitInFlight (proxy IIFE 추적 완료 대기)
 *  - sse: broadcastUpdate / closeAllConnections (대시보드 종료 알림 + 정리)
 *
 * 호출자:
 *  - daemon.gracefulShutdown (SIGTERM/SIGINT 핸들러)
 *  - server.test (단위 테스트)
 */

import { SpyglassDatabase, getDatabase, closeDatabase } from '@spyglass/storage';
import {
  startGraphSyncWorker,
  stopGraphSyncWorker,
  refreshGraphModeFromFile,
} from '@spyglass/storage-graph';
import { clearDiagLogs, getDiagLogDir, logDiagStatus } from '../diag-log';
import { PORT, HOST, DB_PATH, SHUTDOWN_TIMEOUT_MS, isNonLoopbackHost } from './config';
import { startMaintenanceSchedule, stopMaintenanceSchedule } from './maintenance';
import { handleRequest } from './dispatch';
import { installServerStdioMirror } from './stdio-mirror';
import { awaitInFlight, getInFlightCount } from './in-flight';
import { broadcastUpdate, closeAllConnections } from '../sse';
import {
  bootstrapSync as bootstrapMetaDocsSync,
  syncAllKnownCwds,
  discoverKnownCwds,
} from '@spyglass/meta-docs';
import {
  startVersionCheckSchedule,
  stopVersionCheckSchedule,
} from '../version-checker';

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

  // server-logging pass: stdout/stderr를 ~/.spyglass/logs/server.log에도 미러링.
  //   - 백그라운드 실행 시 crash 사후 추적용. uncaughtException/unhandledRejection도 함께 기록.
  //   - 가장 먼저 install — 이후의 console.log/error가 빠짐없이 파일에 남도록 보장.
  installServerStdioMirror();

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

  // Graph projection sync worker — SPYGLASS_GRAPH_MODE 가 'off' 이면 즉시 no-op.
  //   - native binding 의 lazy import 까지 모두 본 호출 안에서 일어남.
  //   - 실패해도 main loop 영향 없음 — try/catch 흡수 + 회로 OPEN.
  //
  //   PR 1: file source 영속 값 평가 — startServer 가 sync 라 await 불가하므로
  //   fire-and-forget 으로 발사. graph sync worker 가 매 폴링마다 getGraphMode() 를
  //   다시 읽어 분기하므로 ms 단위 지연은 무시 가능 (worker 가 polling 첫 사이클 직전에
  //   mode 가 갱신되도록 가장 먼저 호출).
  void refreshGraphModeFromFile().catch((e) => {
    console.warn('[Server] refreshGraphModeFromFile failed (using env/default):', e);
  });
  try {
    startGraphSyncWorker();
  } catch (e) {
    console.error('[Server] graph sync worker failed to start (continuing without graph):', e);
  }

  // 일별 유지보수 스케줄 시작 (시작 시 즉시 + 1시간 인터벌로 날짜 변경 감지)
  startMaintenanceSchedule(db);

  // 버전 체크 스케줄 시작 (시작 시 즉시 + 1시간 인터벌, updateAvailable === false일 때만 호출)
  startVersionCheckSchedule();

  // v24: Behavior Definitions 카탈로그 부팅 동기화 — 글로벌(`~/.claude`) 1회 스캔.
  //  실패해도 부팅은 성공해야 하므로 try/catch로 격리. project chain은 SessionStart에서 lazy 동기화.
  //  추가로, 알려진 모든 cwd(다른 워크스페이스 포함)를 발견해 카탈로그 모집단을 확장한다.
  //  10개 이상이면 setImmediate 백그라운드로 미뤄 부팅 지연을 막는다.
  try {
    const dbInstance = db.instance;
    const knownCwds = discoverKnownCwds(dbInstance);
    console.log(`[Server] meta-docs known cwds discovered: ${knownCwds.length}`);

    if (knownCwds.length <= 10) {
      // 적으면 동기 부팅 (즉시 일관성 확보).
      bootstrapMetaDocsSync(dbInstance, { activeCwds: knownCwds });
    } else {
      // 많으면 글로벌만 동기 처리, cwd별 동기화는 백그라운드로.
      bootstrapMetaDocsSync(dbInstance);
      setImmediate(() => {
        try {
          syncAllKnownCwds(dbInstance, { force: true });
        } catch (err) {
          console.error('[Server] meta-docs background syncAllKnownCwds failed:', err);
        }
      });
    }
  } catch (e) {
    console.error('[Server] meta-docs bootstrap sync failed:', e);
  }

  // 보안 경고 (consistency-hardening P2.1): loopback 이 아닌 주소에 바인딩하면 평문 at-rest
  //   DB(payload·system_prompts)가 네트워크에 노출될 수 있다. 기동은 막지 않고 경고만 — 운영자가
  //   신뢰 네트워크에서만 의도적으로 사용하도록 한다.
  if (isNonLoopbackHost(host)) {
    console.warn(
      `[Server] WARNING non-loopback bind (${host}) — DB is stored unencrypted at rest. ` +
        `Use only on a trusted network.`,
    );
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
 * 서버 graceful 종료.
 *
 * 시퀀스 (각 단계의 의도):
 *  1. 스케줄러 정리 — startMaintenanceSchedule/startVersionCheckSchedule이 잡고 있는
 *     setInterval을 해제. 이후 단계에서 DB가 닫힌 뒤 콜백이 발화하지 않도록 가장 먼저.
 *  2. server_shutdown 브로드캐스트 + 250ms grace — SSE 클라이언트(대시보드)가
 *     RST 단절이 아닌 명시적 종료 신호를 받게 한다 (EventSource error 이벤트로 인한
 *     불필요한 자동 재연결 시도 회피). grace 짧게 — 사용자 인내심 보호.
 *  3. closeAllConnections — SSE controller.close()로 정상 종료.
 *     `idleTimeout: 0`으로 영구 유지되는 SSE 연결은 server.stop()이 자연 종료까지
 *     무한히 대기할 위험이 있어서 명시 close가 필요 (B 검토).
 *  4. await server.stop() — Bun.serve의 graceful stop. 새 연결 거부 + 활성 HTTP
 *     요청이 응답을 끝낼 때까지 대기.
 *  5. await awaitInFlight — proxy/handler/stream.ts의 fire-and-forget IIFE
 *     (SSE 분석 → DB persist → broadcast)가 남아 있으면 deadline 내에서 대기.
 *     server.stop()은 client 응답만 보장하므로, clone reader의 분석 IIFE는 별도 추적 필요.
 *  6. DB close — IIFE persist까지 끝난 뒤에만 안전.
 *
 * 호출자: daemon.gracefulShutdown. deadline guard는 호출자에서 관리하므로
 * 여기서는 awaitInFlight에 timeout만 전달하고 hang 방지에 집중.
 */
export async function stopServer(): Promise<void> {
  // 1. 스케줄러 정리
  stopMaintenanceSchedule();
  stopVersionCheckSchedule();
  // Graph sync worker — DB close 전에 setInterval/Ladybug connection 정리.
  //   timer 가 살아있으면 DB close 후에도 tick 이 발화해 nullDB 참조 위험.
  try {
    stopGraphSyncWorker();
  } catch (e) {
    console.warn('[Server] graph sync worker stop error:', e);
  }

  // 2. SSE 종료 신호 + 짧은 grace
  try {
    broadcastUpdate({
      type: 'server_shutdown',
      data: { reason: 'graceful', timeoutMs: SHUTDOWN_TIMEOUT_MS },
    });
  } catch (err) {
    console.warn('[Server] shutdown broadcast failed:', err);
  }
  await new Promise((resolve) => setTimeout(resolve, 250));

  // 3. SSE 연결 정상 close
  closeAllConnections();

  // 4. Bun.serve graceful stop (in-flight HTTP 자연 종료 대기)
  if (server) {
    await server.stop();
    server = null;
    console.log('[Server] Stopped');
  }

  // 5. fire-and-forget IIFE 완료 대기 (proxy stream 분석/persist/broadcast)
  const remaining = getInFlightCount();
  if (remaining > 0) {
    console.log(`[Server] Waiting for ${remaining} in-flight background task(s)...`);
  }
  const drained = await awaitInFlight(SHUTDOWN_TIMEOUT_MS);
  if (!drained) {
    console.warn(
      `[Server] ${getInFlightCount()} in-flight task(s) did not finish within ${SHUTDOWN_TIMEOUT_MS}ms`,
    );
  }

  // 6. DB close
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
