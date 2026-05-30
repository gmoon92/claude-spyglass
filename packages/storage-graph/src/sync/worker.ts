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

/**
 * 한 tick = (a) traffic allowed 인지 회로 체크 → (b) outbox batch SELECT (dead 제외) →
 * (c) row 단위 enrich → merge → (d) 실패 row 격리(attempts/dead) → (e) cursor 정밀 전진.
 *
 * 실패 격리 정책 (consistency-hardening P1 — HoL 블로킹 제거):
 *   - 각 outbox row 를 id 오름차순으로 개별 enrich→merge. 한 row 의 op 중 하나라도
 *     실패하면 그 row 는 "실패"로 보고 attempts++/last_error 기록. attempts 가
 *     MAX_OUTBOX_ATTEMPTS 에 도달하면 dead=1 로 DLQ 격리(이후 readOutboxBatch 가 제외).
 *   - cursor 는 "아직 살아있는(dead 아님) 최저 실패 row id 직전" 까지만 전진한다.
 *     즉 독성 row 가 dead 가 되기 전까지는 그 앞에서 멈춰 재시도하지만, 그 *앞쪽*의
 *     성공 row 들은 cursor 가 통과시켜 더 이상 재처리되지 않는다.
 *   - Ladybug 트랜잭션은 no-op(롤백 없음)이라 부분 적용이 원래 모델 — 모든 op 가
 *     idempotent MERGE 라 재시도/부분적용 모두 데이터 손상 0.
 *
 * 회로 차단 정책:
 *   - batch 에서 *하나라도* 성공하면 recordSuccess — 정상 트래픽이 흐르므로 독성 row
 *     1개 때문에 회로를 열지 않는다.
 *   - batch 전체가 실패한 경우(=Ladybug 연결 단절 등 시스템 장애)에만 recordFailure —
 *     이때만 회로가 OPEN 으로 가는 것이 옳다.
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
    const readyClient = client;

    let advanceTo = cursor.current; // 이 지점까지 cursor 전진 가능 (성공/dead row 의 최댓값).
    let blocked = false;            // retryable 실패 row 를 만나면 true — 이후 cursor 전진 동결.
    let anySuccess = false;
    let anyFailure = false;
    let firstFailureError: unknown = null;
    let processedThisTick = 0;

    for (const row of batch) {
      // row 단위 enrich — enrich 자체 throw 도 row 실패로 취급(거의 없음, 방어적).
      let rowError: unknown = null;
      try {
        const ops = enrichOutboxRow(row, db);
        const { failed } = await mergeOps(readyClient, ops);
        if (failed.length > 0) rowError = failed[0].error;
      } catch (err) {
        rowError = err;
      }

      if (rowError === null) {
        // row 성공 — 아직 막히지 않았으면 cursor 전진 후보로.
        // (blocked 이후의 성공 row 는 다음 tick 에 재처리되므로 여기선 세지 않는다.)
        anySuccess = true;
        if (!blocked) {
          advanceTo = row.id;
          processedThisTick++;
        }
        continue;
      }

      // row 실패 — attempts++/last_error 기록, MAX 도달 시 dead=1.
      anyFailure = true;
      if (firstFailureError === null) firstFailureError = rowError;
      const becameDead = recordOutboxFailure(db, row.id, rowError);
      if (becameDead && !blocked) {
        // DLQ 격리됨 — 더 이상 재시도 안 하므로 cursor 가 통과해도 안전.
        advanceTo = row.id;
        processedThisTick++;
      } else if (!becameDead) {
        // 재시도 여지 있음 — 이 row 직전에서 cursor 동결(HoL 은 이 row 에만 국한).
        blocked = true;
      }
    }

    if (advanceTo > cursor.current) {
      cursor.advance(advanceTo);
      totalProcessed += processedThisTick;
    }

    // 회로 보고 — 부분 성공이면 success(HoL 해제), 전량 실패면 failure(시스템 장애 신호).
    if (anySuccess) {
      breaker.recordSuccess();
      lastError = anyFailure ? firstFailureError : null;
    } else if (anyFailure) {
      lastError = firstFailureError;
      if (!(firstFailureError instanceof LadybugUnavailableError)) {
        breaker.recordFailure(firstFailureError);
      }
    }
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
