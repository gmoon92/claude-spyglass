/**
 * kuzu-outbox-trigger-safety.test.ts — 그래프 sync 트리거의 write 경로 격리 회귀 가드
 *
 * 배경 (plan Step 1b):
 *   049/051 마이그레이션은 `requests`/`sessions` 에 AFTER INSERT/UPDATE 트리거를 붙여
 *   kuzu_outbox 로 sync 이벤트를 적재한다. 트리거 본문이 throw 하면 SQLite 는 부모
 *   DML(=로그 데이터 INSERT/UPDATE)을 **롤백**한다 → 로그/대시보드 데이터 미노출 회귀.
 *
 *   053 마이그레이션이 트리거를 `INSERT OR IGNORE` + `WHEN NEW.id IS NOT NULL` 로
 *   하드닝하여, outbox 쓰기 실패가 메인 write 를 롤백하지 못하게 한다. 본 테스트는
 *   그 불변식을 고정한다 (미래 회귀 방지).
 *
 * 격리: 고유 임시 DB 파일(Date.now()+pid+uuid), 자체 SpyglassDatabase, afterEach 정리.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { unlinkSync } from 'fs';
import { SpyglassDatabase, closeDatabase, createSession, createRequest, getRequestById } from '../index';

const TEST_DB_PATH = `/tmp/spyglass-trigger-safety-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`;
const NOW = 1778904000000;

interface OutboxRow {
  source: string;
  event_id: string;
  op: string;
}

function readOutbox(db: SpyglassDatabase, eventId: string): OutboxRow[] {
  return db.instance
    .query('SELECT source, event_id, op FROM kuzu_outbox WHERE event_id = ? ORDER BY id ASC')
    .all(eventId) as OutboxRow[];
}

function triggerSql(db: SpyglassDatabase, name: string): string {
  const row = db.instance
    .query("SELECT sql FROM sqlite_master WHERE type='trigger' AND name = ?")
    .get(name) as { sql: string } | undefined;
  return row?.sql ?? '';
}

describe('kuzu_outbox 트리거 — write 경로 격리', () => {
  let db: SpyglassDatabase;
  let sessionId: string;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, { id: sessionId, project_name: 'trigger-safety', started_at: NOW });
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

  it('createRequest 후 requests 행이 보존되고 kuzu_outbox insert 행 생성', () => {
    createRequest(db.instance, {
      id: 'req-1',
      session_id: sessionId,
      timestamp: NOW,
      type: 'tool_call',
      tool_name: 'Bash',
      tool_use_id: 'tu-1',
      event_type: 'tool',
    });

    // 메인 write 가 롤백되지 않았다.
    expect(getRequestById(db.instance, 'req-1')).not.toBeNull();
    // 트리거가 outbox 에 insert 이벤트 적재.
    const rows = readOutbox(db, 'req-1');
    expect(rows.some((r) => r.source === 'requests' && r.op === 'insert')).toBe(true);
  });

  it('pre_tool → tool UPDATE 후 requests 행 유지 + outbox insert/update 2행', () => {
    createRequest(db.instance, {
      id: 'req-2',
      session_id: sessionId,
      timestamp: NOW,
      type: 'tool_call',
      tool_name: 'Bash',
      tool_use_id: 'tu-2',
      event_type: 'pre_tool',
    });
    db.instance.prepare(`UPDATE requests SET event_type = 'tool', duration_ms = ? WHERE id = ?`).run(500, 'req-2');

    const row = db.instance.query('SELECT event_type FROM requests WHERE id = ?').get('req-2') as
      | { event_type: string }
      | undefined;
    expect(row?.event_type).toBe('tool');

    const ops = readOutbox(db, 'req-2').map((r) => r.op);
    expect(ops).toContain('insert');
    expect(ops).toContain('update');
  });

  it('트리거 DDL 이 INSERT OR IGNORE + NEW.id 가드로 하드닝됨 (회귀 가드)', () => {
    for (const name of ['trg_requests_to_kuzu_outbox', 'trg_sessions_to_kuzu_outbox', 'trg_requests_pre_to_tool_outbox']) {
      const sql = triggerSql(db, name).toUpperCase();
      expect(sql).not.toBe('');
      expect(sql).toContain('INSERT OR IGNORE');
      expect(sql).toContain('NEW.ID');
    }
  });

  it('outbox 제약 충돌 상황에서도 requests INSERT 가 성공 (롤백 차단)', () => {
    // outbox (source,event_id) 에 UNIQUE 제약을 강제로 부여하여, 트리거 INSERT 가
    // 제약 위반을 일으키는 시나리오를 구성한다. 하드닝(INSERT OR IGNORE)이 없으면
    // 트리거가 throw → 부모 requests INSERT 가 롤백된다.
    db.instance.run('CREATE UNIQUE INDEX ux_outbox_src_evt ON kuzu_outbox(source, event_id)');
    // requests 행이 생기기 전에 동일 event_id 의 outbox 행을 선점 → 트리거 INSERT 와 충돌.
    db.instance.prepare("INSERT INTO kuzu_outbox(source, event_id, op) VALUES ('requests', ?, 'insert')").run('req-dup');

    createRequest(db.instance, {
      id: 'req-dup',
      session_id: sessionId,
      timestamp: NOW,
      type: 'tool_call',
      tool_name: 'Bash',
      tool_use_id: 'tu-dup',
      event_type: 'tool',
    });

    // OR IGNORE 덕분에 트리거 충돌이 무시되고 메인 write 는 살아남는다.
    expect(getRequestById(db.instance, 'req-dup')).not.toBeNull();
  });
});
