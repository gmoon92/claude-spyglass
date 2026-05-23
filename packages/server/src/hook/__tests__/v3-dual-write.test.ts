/**
 * v3-dual-write 통합 회귀 테스트.
 *
 * 보호:
 *  - processHookEvent 가 legacy requests 와 함께 events_v3 + outbox_pending 둘 다 채운다.
 *  - dualWriteToV3 실패가 legacy 응답을 막지 않는다 (R5).
 *  - SPYGLASS_DISABLE_V3_WRITE=1 시 v3 측은 noop.
 *  - pre_tool 과 post_tool 이 별 events_v3 row 로 들어간다 (R1 append-only).
 *
 * @see packages/server/src/hook/v3-dual-write.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  runMigrations,
  countEventsBySession,
  countOutboxPending,
  resetV3SchemaCache,
} from '@spyglass/storage';
import { processHookEvent } from '../processor';
import type { NormalizedHookPayload } from '../types';

function makeDb(): Database {
  const db = new Database(':memory:');
  runMigrations(db, false);
  return db;
}

function basePayload(over: Partial<NormalizedHookPayload> = {}): NormalizedHookPayload {
  return {
    id: 'evt-1',
    session_id: 'sess-1',
    project_name: 'spyglass-test',
    timestamp: 1000,
    event_type: 'prompt',
    request_type: 'prompt',
    tokens_input: 10,
    tokens_output: 0,
    tokens_total: 10,
    duration_ms: 0,
    source: 'cli-test',
    ...over,
  };
}

describe('processHookEvent dual-write to events_v3', () => {
  let db: Database;
  beforeEach(() => {
    db = makeDb();
    delete process.env.SPYGLASS_DISABLE_V3_WRITE;
  });
  afterEach(() => {
    db.close();
    delete process.env.SPYGLASS_DISABLE_V3_WRITE;
  });

  it('prompt 1건 처리 후 events_v3 + outbox 에 1행씩 추가된다', () => {
    const result = processHookEvent(db, basePayload());
    expect(result.saved).toBe(true);
    expect(countEventsBySession(db, 'sess-1')).toBe(1);
    expect(countOutboxPending(db).total).toBe(1);
  });

  it('같은 payload.id 재호출은 idempotent — events_v3 1행, outbox 1행 유지', () => {
    processHookEvent(db, basePayload());
    processHookEvent(db, basePayload());
    expect(countEventsBySession(db, 'sess-1')).toBe(1);
    expect(countOutboxPending(db).total).toBe(1);
  });

  it('pre_tool 과 post_tool 은 별 event_id 로 별 events_v3 row 가 된다 (R1)', () => {
    // pre_tool 도착
    const preResult = processHookEvent(
      db,
      basePayload({
        id: 'pre-1',
        event_type: 'pre_tool',
        request_type: 'tool_call',
        tool_name: 'Bash',
        tokens_total: 0,
        payload: JSON.stringify({ tool_use_id: 'use-1' }),
      }),
    );
    expect(preResult.saved).toBe(true);

    // post_tool 도착 (다른 payload.id, 같은 tool_use_id)
    const postResult = processHookEvent(
      db,
      basePayload({
        id: 'tool-1',
        event_type: 'tool',
        request_type: 'tool_call',
        tool_name: 'Bash',
        tokens_input: 100,
        tokens_output: 50,
        tokens_total: 150,
        duration_ms: 200,
        payload: JSON.stringify({ tool_use_id: 'use-1' }),
      }),
    );
    expect(postResult.saved).toBe(true);

    // events_v3 는 2 행 — R1 append-only
    expect(countEventsBySession(db, 'sess-1')).toBe(2);

    const rows = db
      .query(
        `SELECT event_id, event_kind, tool_use_id FROM events_v3
         WHERE session_id = ? ORDER BY id ASC`,
      )
      .all('sess-1') as Array<{ event_id: string; event_kind: string; tool_use_id: string }>;

    expect(rows[0].event_id).toBe('pre-1');
    expect(rows[0].event_kind).toBe('hook_pre_tool');
    expect(rows[0].tool_use_id).toBe('use-1');

    expect(rows[1].event_id).toBe('tool-1');
    expect(rows[1].event_kind).toBe('hook_post_tool');
    expect(rows[1].tool_use_id).toBe('use-1');
  });

  it('SPYGLASS_DISABLE_V3_WRITE=1 이면 v3 쓰기 스킵, legacy 만 진행', () => {
    process.env.SPYGLASS_DISABLE_V3_WRITE = '1';
    const result = processHookEvent(db, basePayload({ id: 'p1' }));
    expect(result.saved).toBe(true);
    // legacy requests 는 저장됨
    const legacy = db.query('SELECT COUNT(*) AS n FROM requests WHERE id = ?').get('p1') as { n: number };
    expect(legacy.n).toBe(1);
    // events_v3 / outbox 는 비어있음
    expect(countEventsBySession(db, 'sess-1')).toBe(0);
    expect(countOutboxPending(db).total).toBe(0);
  });

  it('events_v3 trigger 가 UPDATE 차단을 강제한다 (R1)', () => {
    processHookEvent(db, basePayload({ id: 'evt-trigger-test' }));
    expect(() => {
      db.run(`UPDATE events_v3 SET payload_json = '{"x":1}' WHERE event_id = 'evt-trigger-test'`);
    }).toThrow(/append-only/i);
  });
});

describe('processHookEvent — events_v3 schema 부재 시 silent noop', () => {
  let db: Database;

  beforeEach(() => {
    // 운영 시나리오 흉내 — 마이그레이션 적용 후 events_v3 만 강제 DROP.
    //   (다른 브랜치 v3 schema 가 user_version 을 우리 마이그레이션보다 높게
    //    올려놓고 events_v3 를 만들지 않은 상태와 동일.)
    db = new Database(':memory:');
    runMigrations(db, false);
    db.run('DROP TABLE IF EXISTS events_v3');
    resetV3SchemaCache();
    delete process.env.SPYGLASS_DISABLE_V3_WRITE;
  });
  afterEach(() => {
    db.close();
    resetV3SchemaCache();
  });

  it('events_v3 가 없어도 processHookEvent 가 legacy 만으로 성공한다', () => {
    const result = processHookEvent(db, basePayload({ id: 'no-v3-evt' }));
    expect(result.saved).toBe(true);
    // legacy requests 는 INSERT 됨
    const legacy = db
      .query('SELECT COUNT(*) AS n FROM requests WHERE id = ?')
      .get('no-v3-evt') as { n: number };
    expect(legacy.n).toBe(1);
  });
});
