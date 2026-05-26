/**
 * retention-constants.test.ts — retention SSoT 동작 검증.
 *
 * 검증 항목:
 *   1. env 미지정 → DEFAULT_RETENTION_DAYS (30).
 *   2. 유효한 양의 정수 → 그 값.
 *   3. 0 / 음수 / non-numeric → DEFAULT 폴백 (잘못된 값으로 전체 데이터 즉시 삭제 사고 방지).
 *   4. getRetentionCutoffTs() = now - days * 24h * 1000.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  DEFAULT_RETENTION_DAYS,
  getRetentionDays,
  getRetentionCutoffTs,
} from '../runtime/retention';

describe('SPYGLASS_RETENTION_DAYS', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.SPYGLASS_RETENTION_DAYS;
    delete process.env.SPYGLASS_RETENTION_DAYS;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.SPYGLASS_RETENTION_DAYS;
    } else {
      process.env.SPYGLASS_RETENTION_DAYS = original;
    }
  });

  test('env 미지정 시 기본값 30', () => {
    expect(getRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);
    expect(DEFAULT_RETENTION_DAYS).toBe(30);
  });

  test('유효한 양의 정수 적용', () => {
    process.env.SPYGLASS_RETENTION_DAYS = '7';
    expect(getRetentionDays()).toBe(7);
    process.env.SPYGLASS_RETENTION_DAYS = '365';
    expect(getRetentionDays()).toBe(365);
  });

  test('0 은 default 폴백 (전체 즉시 삭제 사고 방지)', () => {
    process.env.SPYGLASS_RETENTION_DAYS = '0';
    expect(getRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);
  });

  test('음수는 default 폴백 (미래 cutoff → 전체 삭제 사고 방지)', () => {
    process.env.SPYGLASS_RETENTION_DAYS = '-5';
    expect(getRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);
  });

  test('non-numeric 은 default 폴백', () => {
    process.env.SPYGLASS_RETENTION_DAYS = 'abc';
    expect(getRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);
  });

  test('빈 문자열은 default 폴백', () => {
    process.env.SPYGLASS_RETENTION_DAYS = '';
    expect(getRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);
  });
});

describe('getRetentionCutoffTs', () => {
  beforeEach(() => {
    delete process.env.SPYGLASS_RETENTION_DAYS;
  });

  test('now - days * 86400000 (default 30일)', () => {
    const now = 1_700_000_000_000;
    const expected = now - 30 * 24 * 60 * 60 * 1000;
    expect(getRetentionCutoffTs(now)).toBe(expected);
  });

  test('env 값에 따라 cutoff 변동', () => {
    process.env.SPYGLASS_RETENTION_DAYS = '7';
    const now = 1_700_000_000_000;
    const expected = now - 7 * 24 * 60 * 60 * 1000;
    expect(getRetentionCutoffTs(now)).toBe(expected);
  });

  test('인자 없으면 Date.now() 기준 — 호출 시점보다 과거', () => {
    const before = Date.now();
    const cutoff = getRetentionCutoffTs();
    const after = Date.now();
    // 30일 전 ± Date.now() 오차범위 안에 들어와야 함.
    const expectedMin = before - 30 * 24 * 60 * 60 * 1000;
    const expectedMax = after - 30 * 24 * 60 * 60 * 1000;
    expect(cutoff).toBeGreaterThanOrEqual(expectedMin);
    expect(cutoff).toBeLessThanOrEqual(expectedMax);
  });
});
