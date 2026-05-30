/**
 * outbox-dlq.test.ts — 그래프 sync DLQ(Dead-Letter Queue) 독성 row 격리 및 복구 회귀 가드
 *
 * 배경 (consistency-hardening P1):
 *   merge 가 반복 실패하는 outbox row(독성 op)가 cursor 를 영구히 막아 그래프 sync 가
 *   freeze 되던 HoL 블로킹을 해소하기 위해, worker 가 실패 row 의 attempts 를 누적해
 *   MAX_OUTBOX_ATTEMPTS 도달 시 dead=1 로 격리하고(readOutboxBatch 가 제외) cursor 를
 *   전진시킨다.
 *
 *   본 테스트는 cursor 전진 정합성의 핵심 primitive 인 recordOutboxFailure / readOutboxBatch
 *   를 직접 검증하여, "독성 row 가 영구히 재시도되어 정체된다"는 우려를 반증한다 —
 *   독성 row 는 MAX tick 내에 반드시 DLQ 되어 read set 에서 사라진다(bounded recovery).
 *
 *   복구 경로 (R1):
 *   dead=1 → dead=0 복구는 cold rebuild 로 불가 (throwAwayAndRebuild 제거됨). 운영자가
 *   명시적으로 resurrectDeadLetters() 를 호출하면 dead=1 row 를 재처리 가능 상태로 reset.
 *   SQLite SSoT(requests/sessions) 에 원천이 남아 있으므로 재처리 시 데이터 손상 0.
 *
 * 격리: 고유 임시 DB 파일, 자체 SpyglassDatabase(autoInit → migration 055 적용), afterEach 정리.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { unlinkSync } from 'fs';
import { SpyglassDatabase, closeDatabase } from '@spyglass/storage';
import {
  recordOutboxFailure,
  readOutboxBatch,
  resurrectDeadLetters,
  readDeadLetters,
  MAX_OUTBOX_ATTEMPTS,
} from '../sync/worker';

const TEST_DB_PATH = `/tmp/spyglass-outbox-dlq-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`;

interface OutboxStateRow {
  id: number;
  attempts: number;
  dead: number;
  last_error: string | null;
}

/** kuzu_outbox 에 한 행 INSERT 후 그 id 반환 (event_id 는 테스트 내 고유). */
function insertOutbox(db: SpyglassDatabase, eventId: string): number {
  db.instance.run(
    "INSERT INTO kuzu_outbox(source, event_id, op) VALUES ('requests', ?, 'insert')",
    [eventId],
  );
  const row = db.instance
    .query('SELECT id FROM kuzu_outbox WHERE event_id = ?')
    .get(eventId) as { id: number };
  return row.id;
}

function getState(db: SpyglassDatabase, id: number): OutboxStateRow {
  return db.instance
    .query('SELECT id, attempts, dead, last_error FROM kuzu_outbox WHERE id = ?')
    .get(id) as OutboxStateRow;
}

describe('kuzu_outbox DLQ — 독성 op 격리 (consistency-hardening P1)', () => {
  let db: SpyglassDatabase;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try {
        unlinkSync(`${TEST_DB_PATH}${ext}`);
      } catch {
        /* ignore */
      }
    }
  });

  it('recordOutboxFailure 는 MAX_OUTBOX_ATTEMPTS 번째 호출에서 정확히 dead=1 (off-by-one 가드)', () => {
    const id = insertOutbox(db, 'evt-1');

    // 1 .. (MAX-1) 회: attempts 누적되나 아직 살아있음.
    for (let attempt = 1; attempt < MAX_OUTBOX_ATTEMPTS; attempt++) {
      const dead = recordOutboxFailure(db.instance, id, new Error(`fail ${attempt}`));
      expect(dead).toBe(false);
      const s = getState(db, id);
      expect(s.attempts).toBe(attempt);
      expect(s.dead).toBe(0);
    }

    // MAX 번째 호출 → dead 전이.
    const deadNow = recordOutboxFailure(db.instance, id, new Error('final boom'));
    expect(deadNow).toBe(true);
    const s = getState(db, id);
    expect(s.attempts).toBe(MAX_OUTBOX_ATTEMPTS);
    expect(s.dead).toBe(1);
    expect(s.last_error).toContain('final boom');
  });

  it('readOutboxBatch 는 dead=1 행을 제외하고 cursor 이후만 id ASC 로 반환', () => {
    const a = insertOutbox(db, 'a');
    const b = insertOutbox(db, 'b');
    const c = insertOutbox(db, 'c');

    // b 를 DLQ 로 격리.
    for (let i = 0; i < MAX_OUTBOX_ATTEMPTS; i++) {
      recordOutboxFailure(db.instance, b, new Error('poison'));
    }
    expect(getState(db, b).dead).toBe(1);

    // cursor=0: dead 인 b 제외하고 a, c 만.
    expect(readOutboxBatch(db.instance, 0, 500).map((r) => r.id)).toEqual([a, c]);
    // cursor=a: a 이후 + dead 제외 → c 만.
    expect(readOutboxBatch(db.instance, a, 500).map((r) => r.id)).toEqual([c]);
  });

  it('bounded recovery — 독성 row 2개는 MAX tick 내 DLQ 되어 read set 에서 사라진다 (영구 정체 반증)', () => {
    // row1, row2 는 매 tick 실패하는 독성 op. row3 는 정상.
    const r1 = insertOutbox(db, 'poison-1');
    const r2 = insertOutbox(db, 'poison-2');
    const r3 = insertOutbox(db, 'healthy');

    // worker tick 의 DB 효과를 MAX 회 시뮬레이트: 매 tick 살아있는 독성 row 에 실패 기록.
    //   (cursor=0 고정으로 둬도, 독성 row 가 dead 되면 read set 에서 빠지는지만 본다.)
    for (let tick = 0; tick < MAX_OUTBOX_ATTEMPTS; tick++) {
      const liveIds = readOutboxBatch(db.instance, 0, 500).map((r) => r.id);
      for (const id of [r1, r2]) {
        if (liveIds.includes(id)) recordOutboxFailure(db.instance, id, new Error('poison'));
      }
    }

    // MAX tick 후: 두 독성 row 는 dead, 살아있는 read set 은 healthy 한 건뿐.
    expect(getState(db, r1).dead).toBe(1);
    expect(getState(db, r2).dead).toBe(1);
    // cursor=0 에서도 독성 row 가 사라졌으므로, 실제 worker 의 cursor 는 이들을 통과해 전진 가능.
    expect(readOutboxBatch(db.instance, 0, 500).map((r) => r.id)).toEqual([r3]);
  });
});

// =============================================================================
// DLQ 복구 경로 (R1) — resurrectDeadLetters / readDeadLetters
// =============================================================================

describe('kuzu_outbox DLQ 복구 경로 — resurrectDeadLetters / readDeadLetters (R1)', () => {
  let db: SpyglassDatabase;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try {
        unlinkSync(`${TEST_DB_PATH}${ext}`);
      } catch {
        /* ignore */
      }
    }
  });

  /** dead=1 상태로 만드는 헬퍼 */
  function makeDead(dbInstance: SpyglassDatabase, eventId: string): number {
    const id = insertOutbox(dbInstance, eventId);
    for (let i = 0; i < MAX_OUTBOX_ATTEMPTS; i++) {
      recordOutboxFailure(dbInstance.instance, id, new Error('poison'));
    }
    return id;
  }

  it('resurrectDeadLetters(db) — dead=1 전체를 dead=0, attempts=0, last_error=NULL 로 reset', () => {
    const d1 = makeDead(db, 'dead-1');
    const d2 = makeDead(db, 'dead-2');

    const count = resurrectDeadLetters(db.instance);

    expect(count).toBe(2);
    const s1 = getState(db, d1);
    const s2 = getState(db, d2);
    expect(s1.dead).toBe(0);
    expect(s1.attempts).toBe(0);
    expect(s1.last_error).toBeNull();
    expect(s2.dead).toBe(0);
    expect(s2.attempts).toBe(0);
    expect(s2.last_error).toBeNull();
  });

  it('resurrectDeadLetters(db) 복구 후 readOutboxBatch 가 해당 row 를 다시 포함한다', () => {
    const dead = makeDead(db, 'dead-resurrected');
    const live = insertOutbox(db, 'live-always');

    // 복구 전: readOutboxBatch 에서 dead row 제외
    expect(readOutboxBatch(db.instance, 0, 500).map((r) => r.id)).not.toContain(dead);

    resurrectDeadLetters(db.instance);

    // 복구 후: dead row 가 다시 read set 에 포함
    expect(readOutboxBatch(db.instance, 0, 500).map((r) => r.id)).toContain(dead);
    expect(readOutboxBatch(db.instance, 0, 500).map((r) => r.id)).toContain(live);
  });

  it('resurrectDeadLetters(db, [id]) — 특정 id 만 복구, 나머지 dead 유지', () => {
    const d1 = makeDead(db, 'dead-selective-1');
    const d2 = makeDead(db, 'dead-selective-2');

    const count = resurrectDeadLetters(db.instance, [d1]);

    expect(count).toBe(1);
    expect(getState(db, d1).dead).toBe(0);
    expect(getState(db, d1).attempts).toBe(0);
    expect(getState(db, d2).dead).toBe(1); // 나머지는 변경 없음
  });

  it('resurrectDeadLetters — dead=0(정상) row 는 건드리지 않는다 (멱등/안전)', () => {
    const live = insertOutbox(db, 'live-safe');
    const dead = makeDead(db, 'dead-safe');

    // live row 의 초기 상태 기록
    const beforeLive = getState(db, live);
    expect(beforeLive.dead).toBe(0);

    resurrectDeadLetters(db.instance);

    // live row 는 변화 없음
    const afterLive = getState(db, live);
    expect(afterLive.attempts).toBe(beforeLive.attempts);
    expect(afterLive.dead).toBe(0);
    // dead row 만 복구됨
    expect(getState(db, dead).dead).toBe(0);
  });

  it('resurrectDeadLetters — dead row 없으면 0 반환 (멱등)', () => {
    insertOutbox(db, 'only-live');
    const count = resurrectDeadLetters(db.instance);
    expect(count).toBe(0);
  });

  it('readDeadLetters(db, limit) — dead=1 목록을 id/source/event_id/attempts/last_error/ts 와 함께 반환', () => {
    const d1 = makeDead(db, 'dlq-list-1');
    const d2 = makeDead(db, 'dlq-list-2');
    insertOutbox(db, 'dlq-list-live'); // live row — 포함되면 안 됨

    const letters = readDeadLetters(db.instance, 100);

    expect(letters.length).toBe(2);
    const ids = letters.map((l) => l.id);
    expect(ids).toContain(d1);
    expect(ids).toContain(d2);

    for (const letter of letters) {
      expect(typeof letter.id).toBe('number');
      expect(letter.source).toBe('requests');
      expect(typeof letter.event_id).toBe('string');
      expect(letter.attempts).toBe(MAX_OUTBOX_ATTEMPTS);
      expect(letter.last_error).toContain('poison');
      expect(typeof letter.ts).toBe('number');
    }
  });

  it('readDeadLetters(db, limit) — limit 으로 반환 개수 제한', () => {
    makeDead(db, 'limit-1');
    makeDead(db, 'limit-2');
    makeDead(db, 'limit-3');

    const letters = readDeadLetters(db.instance, 2);
    expect(letters.length).toBe(2);
  });
});
