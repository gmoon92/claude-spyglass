/**
 * storage-redesign-v3 Phase 2 회귀 테스트
 *
 * 보호 대상:
 *  - Migration 040 (events_v3): append-only 트리거가 UPDATE/DELETE 를 차단하는가
 *  - Migration 041 (outbox_pending): UNIQUE event_id idempotent INSERT
 *  - Migration 042 (projection_state): 초기 seed row 가 존재하는가
 *  - Migration 043-045 (request_view / turn_view / agent_chain_view): 테이블 생성 + 인덱스
 *
 * @see .claude/docs/plans/storage-redesign-v3/redesign-plan.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';

function fresh(): Database {
  const db = new Database(':memory:');
  runMigrations(db, false);
  return db;
}

function tableExists(db: Database, name: string): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as { name: string } | undefined;
  return !!row;
}

function triggerExists(db: Database, name: string): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type='trigger' AND name = ?")
    .get(name) as { name: string } | undefined;
  return !!row;
}

function indexExists(db: Database, name: string): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type='index' AND name = ?")
    .get(name) as { name: string } | undefined;
  return !!row;
}

describe('Migration 040 — events_v3 append-only', () => {
  let db: Database;
  beforeEach(() => { db = fresh(); });
  afterEach(() => { db.close(); });

  it('events_v3 테이블과 인덱스가 생성된다', () => {
    expect(tableExists(db, 'events_v3')).toBe(true);
    expect(indexExists(db, 'idx_events_v3_session_ts')).toBe(true);
    expect(indexExists(db, 'idx_events_v3_kind_ts')).toBe(true);
    expect(indexExists(db, 'idx_events_v3_tool_use')).toBe(true);
    expect(indexExists(db, 'idx_events_v3_id_asc')).toBe(true);
  });

  it('append-only 트리거가 등록된다', () => {
    expect(triggerExists(db, 'trg_events_v3_no_update')).toBe(true);
    expect(triggerExists(db, 'trg_events_v3_no_delete')).toBe(true);
  });

  it('INSERT 는 허용된다', () => {
    db.run(
      `INSERT INTO events_v3 (event_id, session_id, timestamp, event_kind, payload_json)
       VALUES ('evt-1', 'sess-1', 1000, 'hook_pre_tool', '{}')`
    );
    const row = db.query('SELECT * FROM events_v3 WHERE event_id = ?').get('evt-1');
    expect(row).toBeTruthy();
  });

  it('UNIQUE event_id 위반 시 INSERT OR IGNORE 로 idempotent 동작한다', () => {
    db.run(
      `INSERT INTO events_v3 (event_id, session_id, timestamp, event_kind, payload_json)
       VALUES ('evt-dup', 'sess-1', 1000, 'hook_pre_tool', '{}')`
    );
    // 같은 event_id 로 두 번째 INSERT — IGNORE 절 사용
    db.run(
      `INSERT OR IGNORE INTO events_v3 (event_id, session_id, timestamp, event_kind, payload_json)
       VALUES ('evt-dup', 'sess-1', 2000, 'hook_post_tool', '{}')`
    );
    const rows = db.query('SELECT * FROM events_v3 WHERE event_id = ?').all('evt-dup');
    expect(rows.length).toBe(1);
  });

  it('UPDATE 시도는 trg_events_v3_no_update 트리거가 차단한다', () => {
    db.run(
      `INSERT INTO events_v3 (event_id, session_id, timestamp, event_kind, payload_json)
       VALUES ('evt-2', 'sess-1', 1000, 'hook_pre_tool', '{}')`
    );
    expect(() => {
      db.run(`UPDATE events_v3 SET payload_json = '{"x":1}' WHERE event_id = 'evt-2'`);
    }).toThrow(/append-only/i);
  });

  it('DELETE 시도는 trg_events_v3_no_delete 트리거가 차단한다', () => {
    db.run(
      `INSERT INTO events_v3 (event_id, session_id, timestamp, event_kind, payload_json)
       VALUES ('evt-3', 'sess-1', 1000, 'hook_pre_tool', '{}')`
    );
    expect(() => {
      db.run(`DELETE FROM events_v3 WHERE event_id = 'evt-3'`);
    }).toThrow(/append-only/i);
  });
});

describe('Migration 041 — outbox_pending', () => {
  let db: Database;
  beforeEach(() => { db = fresh(); });
  afterEach(() => { db.close(); });

  it('테이블과 인덱스가 생성된다', () => {
    expect(tableExists(db, 'outbox_pending')).toBe(true);
    expect(indexExists(db, 'idx_outbox_pending_available')).toBe(true);
    expect(indexExists(db, 'idx_outbox_pending_claimed_at')).toBe(true);
  });

  it('UNIQUE event_id 가 중복 enqueue 를 차단한다', () => {
    db.run(
      `INSERT INTO outbox_pending (event_id, enqueued_at) VALUES ('e1', 1000)`
    );
    expect(() => {
      db.run(`INSERT INTO outbox_pending (event_id, enqueued_at) VALUES ('e1', 2000)`);
    }).toThrow(/UNIQUE/i);
  });

  it('INSERT OR IGNORE 패턴은 idempotent 하다', () => {
    db.run(`INSERT INTO outbox_pending (event_id, enqueued_at) VALUES ('e2', 1000)`);
    db.run(`INSERT OR IGNORE INTO outbox_pending (event_id, enqueued_at) VALUES ('e2', 2000)`);
    const rows = db.query('SELECT * FROM outbox_pending WHERE event_id = ?').all('e2');
    expect(rows.length).toBe(1);
  });
});

describe('Migration 042 — projection_state', () => {
  let db: Database;
  beforeEach(() => { db = fresh(); });
  afterEach(() => { db.close(); });

  it('테이블이 생성되고 초기 seed 가 등록된다', () => {
    expect(tableExists(db, 'projection_state')).toBe(true);

    const rows = db
      .query('SELECT projection_name, last_event_id FROM projection_state ORDER BY projection_name')
      .all() as Array<{ projection_name: string; last_event_id: number }>;

    const names = rows.map((r) => r.projection_name);
    expect(names).toContain('request_view');
    expect(names).toContain('turn_view');
    expect(names).toContain('agent_chain_view');

    // 초기 watermark = 0
    for (const r of rows) {
      expect(r.last_event_id).toBe(0);
    }
  });

  it('watermark advance 는 UPDATE 로 가능하다 (append-only 아님)', () => {
    db.run(
      `UPDATE projection_state
       SET last_event_id = 100, last_advanced_at = 1234567
       WHERE projection_name = 'request_view'`
    );
    const row = db
      .query('SELECT last_event_id, last_advanced_at FROM projection_state WHERE projection_name = ?')
      .get('request_view') as { last_event_id: number; last_advanced_at: number };
    expect(row.last_event_id).toBe(100);
    expect(row.last_advanced_at).toBe(1234567);
  });
});

describe('Migration 043 — request_view', () => {
  let db: Database;
  beforeEach(() => { db = fresh(); });
  afterEach(() => { db.close(); });

  it('테이블과 핵심 인덱스가 생성된다', () => {
    expect(tableExists(db, 'request_view')).toBe(true);
    expect(indexExists(db, 'idx_request_view_session_ts')).toBe(true);
    expect(indexExists(db, 'idx_request_view_type_ts')).toBe(true);
    expect(indexExists(db, 'idx_request_view_tool_use')).toBe(true);
    expect(indexExists(db, 'idx_request_view_parent_tool_use')).toBe(true);
  });

  it('id PK 가 INSERT OR REPLACE 멱등 upsert 를 지원한다', () => {
    db.run(
      `INSERT INTO request_view (id, session_id, timestamp, type, status, source_event_id, updated_at)
       VALUES ('r1', 's1', 1000, 'prompt', 'ok', 1, 1)`
    );
    // 같은 id 로 REPLACE
    db.run(
      `INSERT OR REPLACE INTO request_view (id, session_id, timestamp, type, status, source_event_id, updated_at)
       VALUES ('r1', 's1', 1000, 'prompt', 'error', 2, 2)`
    );
    const row = db.query('SELECT status FROM request_view WHERE id = ?').get('r1') as { status: string };
    expect(row.status).toBe('error');
  });
});

describe('Migration 044 — turn_view', () => {
  let db: Database;
  beforeEach(() => { db = fresh(); });
  afterEach(() => { db.close(); });

  it('테이블과 인덱스가 생성된다', () => {
    expect(tableExists(db, 'turn_view')).toBe(true);
    expect(indexExists(db, 'idx_turn_view_session')).toBe(true);
    expect(indexExists(db, 'idx_turn_view_session_started')).toBe(true);
    expect(indexExists(db, 'idx_turn_view_status')).toBe(true);
  });

  it('(session_id, turn_id) PK 가 멱등 upsert 를 지원한다', () => {
    db.run(
      `INSERT INTO turn_view (session_id, turn_id, started_at, source_event_id, updated_at)
       VALUES ('s1', 't1', 1000, 1, 1)`
    );
    db.run(
      `INSERT OR REPLACE INTO turn_view (session_id, turn_id, started_at, source_event_id, updated_at, tool_call_count)
       VALUES ('s1', 't1', 1000, 5, 5, 3)`
    );
    const row = db
      .query('SELECT tool_call_count FROM turn_view WHERE session_id = ? AND turn_id = ?')
      .get('s1', 't1') as { tool_call_count: number };
    expect(row.tool_call_count).toBe(3);
  });
});

describe('Migration 045 — agent_chain_view', () => {
  let db: Database;
  beforeEach(() => { db = fresh(); });
  afterEach(() => { db.close(); });

  it('테이블과 인덱스가 생성된다', () => {
    expect(tableExists(db, 'agent_chain_view')).toBe(true);
    expect(indexExists(db, 'idx_agent_chain_root')).toBe(true);
    expect(indexExists(db, 'idx_agent_chain_descendant')).toBe(true);
    expect(indexExists(db, 'idx_agent_chain_session')).toBe(true);
  });

  it('(root, descendant) 복합 PK 멱등 upsert', () => {
    db.run(
      `INSERT INTO agent_chain_view (root_tool_use_id, descendant_tool_use_id, session_id, depth, source_event_id, updated_at)
       VALUES ('root-1', 'desc-1', 's1', 1, 1, 1)`
    );
    db.run(
      `INSERT OR REPLACE INTO agent_chain_view (root_tool_use_id, descendant_tool_use_id, session_id, depth, tokens_total, source_event_id, updated_at)
       VALUES ('root-1', 'desc-1', 's1', 1, 999, 2, 2)`
    );
    const row = db
      .query('SELECT tokens_total FROM agent_chain_view WHERE root_tool_use_id = ? AND descendant_tool_use_id = ?')
      .get('root-1', 'desc-1') as { tokens_total: number };
    expect(row.tokens_total).toBe(999);
  });
});
