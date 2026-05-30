/**
 * config-env.test.ts — 환경변수 별칭 해소 + loopback 판정 가드 (P2.1)
 *
 * 배경:
 *   구버전은 오타 `SPGLASS_*` 를 썼다. 정상 철자 `SPYGLASS_*` 로 옮기되 기존 설정이
 *   조용히 기본값으로 폴백하지 않도록 별칭으로 함께 읽는다(신철자 우선). non-loopback
 *   바인딩은 경고 대상이다.
 *
 *   pickEnv / isNonLoopbackHost 는 순수 함수라 직접 단위 검증한다.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { pickEnv, isNonLoopbackHost, LOOPBACK_HOSTS } from '../config';

describe('pickEnv — 신철자 우선 + 구철자 폴백 (P2.1)', () => {
  const KEYS = ['__SPY_TEST_A', '__SPY_TEST_B'];
  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
  });

  it('신철자(첫 키)가 설정되면 그 값을 반환', () => {
    process.env.__SPY_TEST_A = 'new';
    process.env.__SPY_TEST_B = 'old';
    expect(pickEnv('__SPY_TEST_A', '__SPY_TEST_B')).toBe('new');
  });

  it('신철자 미설정 시 구철자(폴백)로 내려감', () => {
    process.env.__SPY_TEST_B = 'old';
    expect(pickEnv('__SPY_TEST_A', '__SPY_TEST_B')).toBe('old');
  });

  it('빈 문자열은 미설정으로 취급하고 다음 키로 폴백', () => {
    process.env.__SPY_TEST_A = '';
    process.env.__SPY_TEST_B = 'old';
    expect(pickEnv('__SPY_TEST_A', '__SPY_TEST_B')).toBe('old');
  });

  it('모두 미설정이면 undefined', () => {
    expect(pickEnv('__SPY_TEST_A', '__SPY_TEST_B')).toBeUndefined();
  });
});

describe('isNonLoopbackHost — loopback 판정 (P2.1)', () => {
  it('loopback 주소는 non-loopback 이 아님', () => {
    for (const h of LOOPBACK_HOSTS) {
      expect(isNonLoopbackHost(h)).toBe(false);
    }
  });

  it('외부 바인딩 주소는 non-loopback 으로 판정', () => {
    for (const h of ['0.0.0.0', '::', '192.168.0.10', '10.0.0.1', 'example.com']) {
      expect(isNonLoopbackHost(h)).toBe(true);
    }
  });
});
