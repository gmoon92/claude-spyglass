/**
 * Migration 068 — Claude 5 계열 모델 한도 시드
 *
 * @description
 *   마이그레이션이 적용된 빈 DB 에서 getModelMaxTokens() 가 5 계열 모델에 1M 을 돌려주고,
 *   기존 4.x 패턴(200K family 폴백 포함)의 결과는 바뀌지 않음을 고정한다.
 *   관측 최대치가 없는 상태(proxy_requests 비어 있음)로 확인하므로, 값은 시드만의 결과다.
 *
 * @see packages/storage/migrations/068-claude-5-model-limits.sql
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import {
  getModelMaxTokens,
  invalidateModelLimitsCache,
  DEFAULT_MAX_TOKENS,
  EXTENDED_MAX_TOKENS,
} from '@spyglass/storage';

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  invalidateModelLimitsCache();
});
afterEach(() => {
  db.close();
  invalidateModelLimitsCache();
});

describe('migration 068 — Claude 5 모델 한도', () => {
  it('user_version이 68 이상으로 적용된다', () => {
    const v = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
    expect(v).toBeGreaterThanOrEqual(68);
  });

  it.each([
    'claude-fable-5-2',
    'claude-fable-5-1',
    'claude-fable-5',
    'claude-opus-5-5',
    'claude-opus-5',
    'claude-sonnet-5-5',
    'claude-sonnet-5',
    'claude-haiku-5-5',
    'claude-mythos-5-2',
    'claude-opus-4-8',
  ])('%s → 1M (관측치 없이 시드만으로)', (model) => {
    expect(getModelMaxTokens(db, model)).toBe(EXTENDED_MAX_TOKENS);
  });

  it('기존 4.x 시드 결과는 그대로다 (200K family 폴백·1M GA 행)', () => {
    expect(getModelMaxTokens(db, 'claude-opus-4-5')).toBe(200_000);
    expect(getModelMaxTokens(db, 'claude-haiku-4-5')).toBe(200_000);
    expect(getModelMaxTokens(db, 'claude-sonnet-4-5')).toBe(200_000);
    expect(getModelMaxTokens(db, 'claude-opus-4-7')).toBe(1_000_000);
    expect(getModelMaxTokens(db, 'claude-sonnet-4-6')).toBe(1_000_000);
  });

  it('시드에 없는 모델은 여전히 200K 폴백이다', () => {
    expect(getModelMaxTokens(db, 'some-unknown-model')).toBe(DEFAULT_MAX_TOKENS);
  });

  it('멱등 — runMigrations 재실행해도 시드 행 수가 늘지 않는다', () => {
    const count = () => (db.query('SELECT COUNT(*) AS n FROM model_limits').get() as { n: number }).n;
    const before = count();
    runMigrations(db);
    expect(count()).toBe(before);
  });

  it('운영자가 수정한 한도는 덮어쓰지 않는다 (INSERT OR IGNORE)', () => {
    db.run(`UPDATE model_limits SET max_tokens = 500000 WHERE pattern = 'claude-opus-5'`);
    db.run(`PRAGMA user_version = 67`);
    runMigrations(db);
    const row = db.query(`SELECT max_tokens FROM model_limits WHERE pattern = 'claude-opus-5'`).get() as { max_tokens: number };
    expect(row.max_tokens).toBe(500_000);
  });
});
