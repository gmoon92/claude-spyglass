/**
 * disk-space.test.ts — 디스크 가드 SSoT 동작 검증.
 *
 * 검증 항목:
 *   1. 임계 상수 기본값 + env override + 잘못된 값 폴백.
 *   2. getDiskFreeBytes: 실재 경로는 양수, 없는 경로는 null.
 *   3. getDiskStatus: env 로 임계를 조작해 ok/warn/critical/unknown 분류.
 *   4. shouldSuppressNonEssentialWrites: critical 일 때만 true, unknown 은 false(차단 안 함).
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { tmpdir } from 'node:os';
import {
  DEFAULT_DISK_MIN_FREE_MB,
  DEFAULT_DISK_WARN_FREE_MB,
  getDiskMinFreeBytes,
  getDiskWarnFreeBytes,
  getDiskFreeBytes,
  getDiskStatus,
  shouldSuppressNonEssentialWrites,
} from '../runtime/disk-space';

const REAL_PATH = tmpdir();
const MISSING_PATH = '/nonexistent-spyglass-disk-guard-xyz-12345';
const MB = 1024 * 1024;

describe('disk-space 임계 상수/env', () => {
  let origMin: string | undefined;
  let origWarn: string | undefined;

  beforeEach(() => {
    origMin = process.env.SPYGLASS_DISK_MIN_FREE_MB;
    origWarn = process.env.SPYGLASS_DISK_WARN_FREE_MB;
    delete process.env.SPYGLASS_DISK_MIN_FREE_MB;
    delete process.env.SPYGLASS_DISK_WARN_FREE_MB;
  });

  afterEach(() => {
    if (origMin === undefined) delete process.env.SPYGLASS_DISK_MIN_FREE_MB;
    else process.env.SPYGLASS_DISK_MIN_FREE_MB = origMin;
    if (origWarn === undefined) delete process.env.SPYGLASS_DISK_WARN_FREE_MB;
    else process.env.SPYGLASS_DISK_WARN_FREE_MB = origWarn;
  });

  test('기본값 200MB / 1024MB', () => {
    expect(DEFAULT_DISK_MIN_FREE_MB).toBe(200);
    expect(DEFAULT_DISK_WARN_FREE_MB).toBe(1024);
    expect(getDiskMinFreeBytes()).toBe(200 * MB);
    expect(getDiskWarnFreeBytes()).toBe(1024 * MB);
  });

  test('유효한 env override 적용', () => {
    process.env.SPYGLASS_DISK_MIN_FREE_MB = '500';
    process.env.SPYGLASS_DISK_WARN_FREE_MB = '2048';
    expect(getDiskMinFreeBytes()).toBe(500 * MB);
    expect(getDiskWarnFreeBytes()).toBe(2048 * MB);
  });

  test('0 / 음수 / non-numeric / 빈 문자열은 default 폴백', () => {
    for (const bad of ['0', '-1', 'abc', '']) {
      process.env.SPYGLASS_DISK_MIN_FREE_MB = bad;
      process.env.SPYGLASS_DISK_WARN_FREE_MB = bad;
      expect(getDiskMinFreeBytes()).toBe(DEFAULT_DISK_MIN_FREE_MB * MB);
      expect(getDiskWarnFreeBytes()).toBe(DEFAULT_DISK_WARN_FREE_MB * MB);
    }
  });
});

describe('getDiskFreeBytes', () => {
  test('실재 경로는 양수 바이트', () => {
    const free = getDiskFreeBytes(REAL_PATH);
    expect(free).not.toBeNull();
    expect(free!).toBeGreaterThan(0);
  });

  test('존재하지 않는 경로는 null', () => {
    expect(getDiskFreeBytes(MISSING_PATH)).toBeNull();
  });
});

describe('getDiskStatus / shouldSuppressNonEssentialWrites', () => {
  let origMin: string | undefined;
  let origWarn: string | undefined;

  beforeEach(() => {
    origMin = process.env.SPYGLASS_DISK_MIN_FREE_MB;
    origWarn = process.env.SPYGLASS_DISK_WARN_FREE_MB;
    delete process.env.SPYGLASS_DISK_MIN_FREE_MB;
    delete process.env.SPYGLASS_DISK_WARN_FREE_MB;
  });

  afterEach(() => {
    if (origMin === undefined) delete process.env.SPYGLASS_DISK_MIN_FREE_MB;
    else process.env.SPYGLASS_DISK_MIN_FREE_MB = origMin;
    if (origWarn === undefined) delete process.env.SPYGLASS_DISK_WARN_FREE_MB;
    else process.env.SPYGLASS_DISK_WARN_FREE_MB = origWarn;
  });

  test('측정 불가 경로 → unknown, suppress=false (차단 안 함)', () => {
    expect(getDiskStatus(MISSING_PATH).status).toBe('unknown');
    expect(shouldSuppressNonEssentialWrites(MISSING_PATH)).toBe(false);
  });

  test('임계를 천문학적으로 키우면 critical → suppress=true', () => {
    // 현재 가용량보다 큰 critical 임계 → 무조건 critical
    process.env.SPYGLASS_DISK_MIN_FREE_MB = String(1024 * 1024 * 1024); // 1PB
    expect(getDiskStatus(REAL_PATH).status).toBe('critical');
    expect(shouldSuppressNonEssentialWrites(REAL_PATH)).toBe(true);
  });

  test('critical 미만이지만 warn 임계가 크면 warn', () => {
    process.env.SPYGLASS_DISK_MIN_FREE_MB = '1';            // critical 사실상 비활성
    process.env.SPYGLASS_DISK_WARN_FREE_MB = String(1024 * 1024 * 1024); // 1PB → warn
    const { status } = getDiskStatus(REAL_PATH);
    expect(status).toBe('warn');
    expect(shouldSuppressNonEssentialWrites(REAL_PATH)).toBe(false); // warn 은 suppress 아님
  });

  test('임계가 작으면 ok', () => {
    process.env.SPYGLASS_DISK_MIN_FREE_MB = '1';
    process.env.SPYGLASS_DISK_WARN_FREE_MB = '2';
    expect(getDiskStatus(REAL_PATH).status).toBe('ok');
  });
});
