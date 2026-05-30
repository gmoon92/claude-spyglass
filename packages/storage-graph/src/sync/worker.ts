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
 *   3) tick 마다: outbox SELECT(dead 제외) → row 단위 enrich→mergeOps → 실패 row 격리
 *      (attempts++/dead) → cursor 정밀 advance(미해결 실패 row 직전까지).
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
/**
 * 한 outbox row 의 merge 가 이 횟수만큼 연속 실패하면 DLQ(dead=1) 로 격리한다
 * (consistency-hardening P1). 격리 후 cursor 가 그 row 를 통과해 HoL 블로킹이 풀린다.
 */
export const MAX_OUTBOX_ATTEMPTS = 5;

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
  /** DLQ(dead=1) 로 격리된 outbox row 수 — 누적 영구 실패 관측 지표 (P1). */
  deadLetterCount: number;
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
    deadLetterCount: readDeadLetterCount(),
  };
}

// =============================================================================
// 본 tick
// =============================================================================

/** runOutboxTick 결과 — 모듈 상태(totalProcessed/lastError) 갱신용. */
export interface OutboxTickResult {
  /** cursor 가 실제로 통과(전진)한 row 수. */
  processed: number;
  /** 이번 tick 의 대표 에러(없으면 null). */
  error: unknown;
}

/** cursor / circuit-breaker 의존성 — 싱글톤 대신 주입받아 단위 테스트 가능하게. */
interface CursorLike {
  current: number;
  advance(id: number): void;
}
interface BreakerLike {
  recordSuccess(): void;
  recordFailure(error?: unknown): void;
}

/**
 * 한 tick 의 outbox 처리 본체 (deps 주입 — 테스트 가능).
 *
 * systemic(시스템 장애) vs poison(진짜 독성 row) 구분 (consistency-hardening P1 보강):
 *   - **Phase 1** — batch 의 각 row 를 enrich→merge 하고 성공/실패만 *수집*한다(이 단계에선
 *     attempts/dead 같은 DLQ 부수효과를 만들지 않는다).
 *   - **Phase 2a — 전량 실패(anySuccess=false)**: Ladybug 연결 단절 등 *시스템 장애*로 간주.
 *     attempts/dead 를 건드리지 않고(=일시 장애에 멀쩡한 row 가 대량 오격리되는 것을 방지)
 *     cursor 를 동결한 채 회로 failure 만 보고한다 → 장애 복구 후 batch 전체 재시도.
 *   - **Phase 2b — 1건 이상 성공(시스템 healthy)**: 실패한 row 는 *시스템이 정상인데도* 실패한
 *     것이므로 진짜 독성으로 확정 → recordOutboxFailure 로 attempts++/dead 격리한다. cursor 는
 *     미해결(dead 아님) 최저 실패 row 직전까지 전진(HoL 은 그 row 에만 국한, ≤MAX tick),
 *     회로는 success 로 보고(독성 1개 때문에 회로를 열지 않음).
 *
 *   Ladybug 트랜잭션은 no-op(롤백 없음)이라 부분 적용이 원래 모델 — 모든 op 가 idempotent
 *   MERGE 라 재시도/부분적용 모두 데이터 손상 0.
 */
export async function runOutboxTick(
  db: Database,
  client: import('../client').LadybugClient,
  cursor: CursorLike,
  breaker: BreakerLike,
): Promise<OutboxTickResult> {
  const batch = readOutboxBatch(db, cursor.current, BATCH_LIMIT);
  if (batch.length === 0) return { processed: 0, error: null };

  // Phase 1 — merge 시도, 결과만 수집(DLQ 부수효과 없음).
  const outcomes: Array<{ row: OutboxRow; error: unknown }> = [];
  let anySuccess = false;
  let firstFailureError: unknown = null;
  for (const row of batch) {
    let rowError: unknown = null;
    try {
      const ops = enrichOutboxRow(row, db);
      const { failed } = await mergeOps(client, ops);
      if (failed.length > 0) rowError = failed[0].error;
    } catch (err) {
      // enrich 자체 throw 도 row 실패로 취급(거의 없음, 방어적).
      rowError = err;
    }
    outcomes.push({ row, error: rowError });
    if (rowError === null) anySuccess = true;
    else if (firstFailureError === null) firstFailureError = rowError;
  }

  // Phase 2a — 전량 실패 = 시스템 장애. DLQ/cursor 손대지 않고 회로만 보고 → 재시도.
  if (!anySuccess) {
    if (firstFailureError !== null && !(firstFailureError instanceof LadybugUnavailableError)) {
      breaker.recordFailure(firstFailureError);
    }
    return { processed: 0, error: firstFailureError };
  }

  // Phase 2b — 시스템 healthy. 실패 row 는 진짜 독성 → DLQ + cursor 정밀 전진.
  let advanceTo = cursor.current;
  let blocked = false;
  let processed = 0;
  for (const { row, error } of outcomes) {
    if (error === null) {
      if (!blocked) {
        advanceTo = row.id;
        processed++;
      }
      continue;
    }
    const becameDead = recordOutboxFailure(db, row.id, error);
    if (becameDead && !blocked) {
      // DLQ 격리됨 — cursor 가 통과해도 안전(이후 readOutboxBatch 가 제외).
      advanceTo = row.id;
      processed++;
    } else if (!becameDead) {
      // 재시도 여지 있음 — 이 row 직전에서 cursor 동결.
      blocked = true;
    }
  }
  if (advanceTo > cursor.current) cursor.advance(advanceTo);
  breaker.recordSuccess();
  return { processed, error: firstFailureError };
}

/**
 * 200ms 주기 호출 래퍼 — 싱글톤(breaker/db/cursor/client)을 묶어 runOutboxTick 에 위임.
 * 회로 OPEN 이면 skip, client 미준비면 cursor 동결 후 return. 동시 tick 방지.
 */
async function tick(): Promise<void> {
  if (tickInFlight) return; // 동시 tick 방지.
  tickInFlight = true;
  try {
    const breaker = getCircuitBreaker();
    if (!breaker.allowsTraffic()) return; // OPEN — 조용히 skip.

    const db = getDatabase().getDb();
    const cursor = getSyncCursor();
    // 빈 큐 빠른 체크 — 큐가 비었으면 native client init(dlopen) 자체를 회피.
    if (readOutboxBatch(db, cursor.current, 1).length === 0) return;

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

    const result = await runOutboxTick(db, client, cursor, breaker);
    totalProcessed += result.processed;
    lastError = result.error;
  } finally {
    tickInFlight = false;
  }
}

// =============================================================================
// SQLite outbox SELECT — 본 모듈만의 책임 (다른 곳에서 outbox 컬럼 모름)
// =============================================================================

// export: DLQ 동작(dead 전이·제외)을 단위 테스트로 검증하기 위해 노출 (worker tick 자체는
// 싱글톤 의존이 많아 직접 테스트가 어렵다 — 본 두 헬퍼가 cursor 전진 정합성의 핵심 primitive).
export function readOutboxBatch(db: Database, afterId: number, limit: number): OutboxRow[] {
  // dead=1 (DLQ 격리) 행은 영구 skip — 부분 인덱스 idx_kuzu_outbox_live(dead=0) 사용.
  const stmt = db.prepare(
    `SELECT id, source, event_id, op, ts
       FROM kuzu_outbox
      WHERE id > ? AND dead = 0
      ORDER BY id ASC
      LIMIT ?`,
  );
  return stmt.all(afterId, limit) as OutboxRow[];
}

/**
 * outbox row 의 merge 실패 기록 — attempts++/last_error 갱신, MAX 도달 시 dead=1.
 * @returns 이번 호출로 dead=1 (DLQ 격리) 가 됐으면 true.
 */
export function recordOutboxFailure(db: Database, id: number, error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  db.prepare(
    `UPDATE kuzu_outbox
        SET attempts   = attempts + 1,
            last_error = ?,
            dead       = CASE WHEN attempts + 1 >= ? THEN 1 ELSE 0 END
      WHERE id = ?`,
  ).run(msg.slice(0, 500), MAX_OUTBOX_ATTEMPTS, id);
  const row = db
    .prepare(`SELECT dead FROM kuzu_outbox WHERE id = ?`)
    .get(id) as { dead: number } | undefined;
  return row?.dead === 1;
}

/** DLQ(dead=1) 격리된 outbox row 수. status 노출용. DB 미준비 시 0. */
function readDeadLetterCount(): number {
  try {
    const db = getDatabase().getDb();
    const row = db
      .prepare(`SELECT COUNT(*) AS c FROM kuzu_outbox WHERE dead = 1`)
      .get() as { c: number } | undefined;
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}
