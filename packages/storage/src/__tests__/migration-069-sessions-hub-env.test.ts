/**
 * Migration 069 — sessions.orca_terminal / hub_role
 *
 * @description
 *   기존 sessions 행을 보존한 채 컬럼 2개와 부분 인덱스가 additive 로 추가되고,
 *   재실행에 멱등하며, setSessionHubEnv 가 값 있는 필드만 갱신함을 고정한다.
 *
 * @see packages/storage/migrations/069-sessions-hub-env.sql
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { createSession, getSessionById, setSessionHubEnv } from '../queries/session';

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => db.close());

function cols(table: string): Set<string> {
  return new Set((db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name));
}

describe('migration 069 — sessions 허브 환경 태그', () => {
  it('user_version이 69 이상으로 적용된다', () => {
    const v = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
    expect(v).toBeGreaterThanOrEqual(69);
  });

  it('orca_terminal·hub_role 컬럼과 부분 인덱스가 생긴다', () => {
    expect(cols('sessions').has('orca_terminal')).toBe(true);
    expect(cols('sessions').has('hub_role')).toBe(true);
    const idx = db.query(`SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_sessions_orca_terminal'`).get() as { sql: string } | null;
    expect(idx?.sql).toContain('WHERE orca_terminal IS NOT NULL');
  });

  it('기존 행은 보존되고 새 컬럼은 NULL', () => {
    createSession(db, { id: 's1', project_name: 'p', started_at: 1 });
    expect(getSessionById(db, 's1')).toMatchObject({ id: 's1', project_name: 'p', orca_terminal: null, hub_role: null });
  });

  it('멱등 — runMigrations 재실행해도 컬럼이 유지된다', () => {
    runMigrations(db);
    expect(cols('sessions').has('orca_terminal')).toBe(true);
  });

  it('setSessionHubEnv — 값 있는 필드만 갱신, 세션이 없으면 false', () => {
    expect(setSessionHubEnv(db, 'missing', { hub_role: 'worker' })).toBe(false);
    createSession(db, { id: 's2', project_name: 'p', started_at: 1 });
    expect(setSessionHubEnv(db, 's2', { orca_terminal: 'term_a' })).toBe(true);
    expect(setSessionHubEnv(db, 's2', { hub_role: 'worker' })).toBe(true);
    expect(getSessionById(db, 's2')).toMatchObject({ orca_terminal: 'term_a', hub_role: 'worker' });
  });
});
