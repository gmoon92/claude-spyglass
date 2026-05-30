/**
 * outbox-dlq.test.ts — 그래프 sync DLQ(Dead-Letter Queue) 독성 row 격리 회귀 가드
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
 * 격리: 고유 임시 DB 파일, 자체 SpyglassDatabase(autoInit → migration 055 적용), afterEach 정리.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { unlinkSync } from 'fs';
import { SpyglassDatabase, closeDatabase } from '@spyglass/storage';
import {
  recordOutboxFailure,
  readOutboxBatch,
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
