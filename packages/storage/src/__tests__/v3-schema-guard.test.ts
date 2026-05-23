/**
 * v3-schema-guard 회귀 테스트.
 *
 * 보호:
 *  - 마이그레이션 적용된 fresh DB → true
 *  - 다른 schema 만 있는 DB (events_v3 미존재) → false
 *  - 결과 캐시 (같은 db 객체 재호출 cheap)
 *  - resetV3SchemaCache 후 재평가
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { v3SchemaAvailable, resetV3SchemaCache } from '../queries/v3/schema-guard';

describe('v3SchemaAvailable', () => {
  beforeEach(() => { resetV3SchemaCache(); });
  afterEach(() => { resetV3SchemaCache(); });

  it('마이그레이션 적용된 DB → true', () => {
    const db = new Database(':memory:');
    runMigrations(db, false);
    expect(v3SchemaAvailable(db)).toBe(true);
    db.close();
  });

  it('events_v3 미존재 DB → false', () => {
    const db = new Database(':memory:');
    // 마이그레이션 적용 안 함 — sqlite 기본 빈 DB
    expect(v3SchemaAvailable(db)).toBe(false);
    db.close();
  });

  it('다른 schema 의 events 테이블만 있어도 events_v3 부재면 false (운영 시나리오)', () => {
    const db = new Database(':memory:');
    // origin/phase/1-storage 흉내: events 테이블만 있고 events_v3 는 없음
    db.run('CREATE TABLE events (id INTEGER PRIMARY KEY, payload TEXT)');
    db.run('CREATE TABLE projection_state (projection_name TEXT PRIMARY KEY, last_processed_event_seq INTEGER)');
    expect(v3SchemaAvailable(db)).toBe(false);
    db.close();
  });

  it('resetV3SchemaCache 후 재평가', () => {
    const db = new Database(':memory:');
    expect(v3SchemaAvailable(db)).toBe(false);

    // 같은 db 에 마이그레이션 적용
    runMigrations(db, false);
    // 캐시된 false 가 남아있어 즉시 호출은 여전히 false
    expect(v3SchemaAvailable(db)).toBe(false);

    // reset 후 재평가 → true
    resetV3SchemaCache();
    expect(v3SchemaAvailable(db)).toBe(true);
    db.close();
  });
});
