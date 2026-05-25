/**
 * circuit-breaker.test.ts — 상태 기계 단위 테스트
 *
 * 검증 항목:
 *   1. 초기 상태는 CLOSED.
 *   2. 연속 3회 실패면 OPEN (cooldown 시작).
 *   3. OPEN 상태에서는 allowsTraffic() = false.
 *   4. cooldown 경과 후 자동 HALF_OPEN.
 *   5. HALF_OPEN 에서 성공 → CLOSED, 실패 → OPEN.
 *   6. 성공 호출은 consecutiveFailures 를 0 으로 리셋.
 *
 * 시간 가속:
 *   Date.now 를 monkey-patch 해서 cooldown 시뮬레이션.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { CircuitBreaker } from '../runtime/circuit-breaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;
  let realNow: () => number;
  let fakeNow: number;

  beforeEach(() => {
    breaker = new CircuitBreaker();
    realNow = Date.now;
    fakeNow = 1_000_000_000_000; // 임의 고정 시각.
    Date.now = () => fakeNow;
  });

  afterEach(() => {
    Date.now = realNow;
  });

  test('초기 상태는 CLOSED', () => {
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.allowsTraffic()).toBe(true);
    expect(breaker.getConsecutiveFailures()).toBe(0);
  });

  test('연속 3회 실패면 OPEN 으로 전이하고 트래픽 차단', () => {
    breaker.recordFailure(new Error('fail 1'));
    breaker.recordFailure(new Error('fail 2'));
    expect(breaker.getState()).toBe('CLOSED'); // 아직 2회.
    breaker.recordFailure(new Error('fail 3'));
    expect(breaker.getState()).toBe('OPEN');
    expect(breaker.allowsTraffic()).toBe(false);
  });

  test('성공 호출은 consecutiveFailures 리셋', () => {
    breaker.recordFailure(new Error('fail 1'));
    breaker.recordFailure(new Error('fail 2'));
    expect(breaker.getConsecutiveFailures()).toBe(2);
    breaker.recordSuccess();
    expect(breaker.getConsecutiveFailures()).toBe(0);
    // 다시 2회 실패해도 OPEN 아님.
    breaker.recordFailure(new Error('fail 3'));
    breaker.recordFailure(new Error('fail 4'));
    expect(breaker.getState()).toBe('CLOSED');
  });

  test('cooldown 경과 후 자동 HALF_OPEN 전이', () => {
    breaker.recordFailure(new Error('1'));
    breaker.recordFailure(new Error('2'));
    breaker.recordFailure(new Error('3'));
    expect(breaker.getState()).toBe('OPEN');

    // 1시간 경과.
    fakeNow += 60 * 60 * 1000 + 1;
    // allowsTraffic 호출이 자동 전이 트리거.
    const allowed = breaker.allowsTraffic();
    expect(allowed).toBe(true);
    expect(breaker.getState()).toBe('HALF_OPEN');
  });

  test('HALF_OPEN 에서 성공 → CLOSED', () => {
    breaker.recordFailure(new Error('1'));
    breaker.recordFailure(new Error('2'));
    breaker.recordFailure(new Error('3'));
    fakeNow += 60 * 60 * 1000 + 1;
    breaker.allowsTraffic(); // HALF_OPEN 전이.

    breaker.recordSuccess();
    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.allowsTraffic()).toBe(true);
  });

  test('HALF_OPEN 에서 실패 → 즉시 OPEN', () => {
    breaker.recordFailure(new Error('1'));
    breaker.recordFailure(new Error('2'));
    breaker.recordFailure(new Error('3'));
    fakeNow += 60 * 60 * 1000 + 1;
    breaker.allowsTraffic(); // HALF_OPEN.
    expect(breaker.getState()).toBe('HALF_OPEN');

    breaker.recordFailure(new Error('half-open fail'));
    expect(breaker.getState()).toBe('OPEN');
    expect(breaker.allowsTraffic()).toBe(false);
  });

  test('fallback rate 5% + 20개 표본 미달이면 OPEN 되지 않음', () => {
    // 표본 적을 때 — 비율만으로 OPEN 되지 않아야.
    for (let i = 0; i < 19; i++) breaker.recordSuccess();
    breaker.recordFailure(new Error('once'));
    expect(breaker.getState()).toBe('CLOSED');
  });
});
