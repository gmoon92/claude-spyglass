/**
 * worker.ts — 200ms 틱 outbox 폴링 워커
 *
 * 책임:
 *   - 부팅 시 1회 lazy connect + DDL apply.
 *   - 200ms 간격으로 outbox 에서 cursor 이후 batch 를 읽어 Ladybug 에 MERGE.
 *   - 회로 차단기 상태 존중 — OPEN 이면 tick no-op.
 *   - 어떤 단계 실패도 main loop 를 죽이지 않는다 (try/catch 흡수 + 회로 보고).
 *
 * 의존성:
 *   - @spyglass/storage (getDatabase — outbox SELECT)
 *   - client.ts (LadybugClient — MERGE 실행)
 *   - runtime/flag (mode 판정)
 *   - runtime/circuit-breaker (실패 보고 + traffic 허용 체크)
 *   - sync/cursor (마지막 처리 id 영속화)
 *   - sync/enrich (outbox row → GraphOp[])
 *   - sync/merge (GraphOp[] → Cypher MERGE)
 *
 * 호출 흐름 (server bootstrap):
 *   1) `startGraphSyncWorker()` — mode 'off' 면 즉시 return (완전 dormant).
 *   2) setInterval(tick, 200ms) 등록.
 *   3) tick 마다: outbox SELECT → enrich → transaction { mergeOps } → cursor.advance.
 *
 * 디자인 결정:
 *   - Bun setInterval 은 main loop tick — worker thread 분리는 추후 측정 후 결정.
 *   - 200ms 안에 끝나야 하는 batch 크기를 BATCH_LIMIT 로 제한 (500). 부하 시 자연스럽게
 *     lag 가 늘지만 main loop 는 봉쇄되지 않는다.
 *   - shutdown 시 `stopGraphSyncWorker()` — Electron before-quit 에서 호출.
 *   - 동시 tick 방지: in-flight 플래그.
 */

import type { Database } from 'bun:sqlite';
import { getDatabase } from '@spyglass/storage';
import { getGraphMode } from '../runtime/flag';
import { getCircuitBreaker } from '../runtime/circuit-breaker';
import { getLadybugClient, closeLadybugClient, LadybugUnavailableError } from '../client';
import { getSyncCursor } from './cursor';
import { enrichOutboxRow, type OutboxRow } from './enrich';
import { mergeOps } from './merge';

// =============================================================================
// 정책 상수
// =============================================================================

const TICK_INTERVAL_MS = 200;
const BATCH_LIMIT = 500;

// =============================================================================
// 모듈 상태
// =============================================================================

let timer: ReturnType<typeof setInterval> | null = null;
let tickInFlight = false;
let totalProcessed = 0;
let lastError: unknown = null;

// =============================================================================
// 외부 인터페이스
// =============================================================================

export interface SyncWorkerStatus {
  running: boolean;
  totalProcessed: number;
  cursor: number;
  lastError: string | null;
  circuitState: ReturnType<ReturnType<typeof getCircuitBreaker>['getState']>;
}

/**
 * 부팅 시점에 한 번 호출. mode='off' 이면 native 모듈 import 자체가 발생하지 않으므로
 * 패키지가 install 안 된 상태에서도 안전.
 */
export function startGraphSyncWorker(): void {
  if (timer !== null) return; // 멱등.
  const mode = getGraphMode();
  if (mode === 'off') {
    console.log(`[graph-sync] worker dormant (SPYGLASS_GRAPH_MODE=off)`);
    return;
  }
  console.log(`[graph-sync] worker starting (mode=${mode}, tick=${TICK_INTERVAL_MS}ms)`);
  // load cursor 즉시 — tick 첫 호출 전에 file IO 끝내 두면 첫 응답이 빠르다.
  getSyncCursor().load();
  timer = setInterval(() => {
    // tick 자체에서 reject 가 일어나도 main loop 가 죽지 않도록 .catch 흡수.
    void tick().catch((err) => {
      lastError = err;
      console.warn(`[graph-sync] uncaught tick error: ${err}`);
    });
  }, TICK_INTERVAL_MS);
}

/** server shutdown hook 에서 호출. 멱등. */
export function stopGraphSyncWorker(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  closeLadybugClient();
}

/** 모니터링 / 진단용 status. */
export function getSyncWorkerStatus(): SyncWorkerStatus {
  return {
    running: timer !== null,
    totalProcessed,
    cursor: getSyncCursor().current,
    lastError:
      lastError === null
        ? null
        : lastError instanceof Error
        ? lastError.message
        : String(lastError),
    circuitState: getCircuitBreaker().getState(),
  };
}

// =============================================================================
// 본 tick
// =============================================================================

/**
 * 한 tick = (a) traffic allowed 인지 회로 체크 → (b) outbox batch SELECT → (c) enrich →
 * (d) Ladybug transaction MERGE → (e) cursor advance.
 *
 * 어느 단계든 실패하면 cursor 미진행 + 회로 보고 + 다음 tick 에서 재시도.
 */
async function tick(): Promise<void> {
  if (tickInFlight) return; // 동시 tick 방지.
  tickInFlight = true;
  try {
    const breaker = getCircuitBreaker();
    if (!breaker.allowsTraffic()) return; // OPEN — 조용히 skip.

    const db = getDatabase().getDb();
    const cursor = getSyncCursor();
    const batch = readOutboxBatch(db, cursor.current, BATCH_LIMIT);
    if (batch.length === 0) return;

    // Ladybug ready 보장 — 첫 tick 에서만 native dlopen + DDL apply.
    let client: import('../client').LadybugClient | null = null;
    try {
      client = await getLadybugClient();
    } catch (err) {
      // connect 실패는 이미 client.ts 가 회로 보고 — worker 는 cursor 미진행 + return.
      lastError = err;
      return;
    }
    if (!client) return; // TS narrowing 보조 — 위 catch 가 return 했으므로 사실상 unreachable.

    const ops = batch.flatMap((row) => enrichOutboxRow(row, db));
    // client 를 클로저로 캡처 — null 검사를 통과한 시점의 reference 를 보존.
    const readyClient = client;

    try {
      await readyClient.transaction(async () => {
        await mergeOps(readyClient, ops);
      });
      cursor.advance(batch[batch.length - 1].id);
      totalProcessed += batch.length;
      breaker.recordSuccess();
      lastError = null;
    } catch (err) {
      // transaction 자체 실패 — 회로 보고 + cursor 미진행 → 다음 tick 재시도.
      lastError = err;
      // LadybugUnavailableError 는 이미 client 에서 회로 보고, 그 외는 여기서 보고.
      if (!(err instanceof LadybugUnavailableError)) {
        breaker.recordFailure(err);
      }
    }
  } finally {
    tickInFlight = false;
  }
}

// =============================================================================
// SQLite outbox SELECT — 본 모듈만의 책임 (다른 곳에서 outbox 컬럼 모름)
// =============================================================================

function readOutboxBatch(db: Database, afterId: number, limit: number): OutboxRow[] {
  const stmt = db.prepare(
    `SELECT id, source, event_id, op, ts
       FROM kuzu_outbox
      WHERE id > ?
      ORDER BY id ASC
      LIMIT ?`,
  );
  return stmt.all(afterId, limit) as OutboxRow[];
}
