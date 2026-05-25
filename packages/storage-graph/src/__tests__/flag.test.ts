/**
 * flag.test.ts — SPYGLASS_GRAPH_MODE 파싱 검증
 *
 * 본 테스트는 cursor / worker 통합과 분리된 가장 가벼운 단위 — feature flag SSoT 가
 * 안정적인지 확인하는 게이트.
 *
 * 검증 항목:
 *   1. 환경변수 없으면 기본값 'shadow'.
 *   2. 'off' / 'shadow' / 'primary' 모두 인식 (대소문자 무시).
 *   3. 미지원 값은 console.warn 후 'shadow' 폴백.
 *   4. isGraphEnabled() 가 'off' 일 때만 false.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { getGraphMode, isGraphEnabled, resetGraphModeCache } from '../runtime/flag';

describe('SPYGLASS_GRAPH_MODE flag', () => {
  beforeEach(() => {
    delete process.env.SPYGLASS_GRAPH_MODE;
    resetGraphModeCache();
  });

  test('환경변수 없으면 기본값 shadow', () => {
    expect(getGraphMode()).toBe('shadow');
    expect(isGraphEnabled()).toBe(true);
  });

  test('off 모드 인식', () => {
    process.env.SPYGLASS_GRAPH_MODE = 'off';
    resetGraphModeCache();
    expect(getGraphMode()).toBe('off');
    expect(isGraphEnabled()).toBe(false);
  });

  test('primary 모드 인식', () => {
    process.env.SPYGLASS_GRAPH_MODE = 'primary';
    resetGraphModeCache();
    expect(getGraphMode()).toBe('primary');
    expect(isGraphEnabled()).toBe(true);
  });

  test('대소문자 무시', () => {
    process.env.SPYGLASS_GRAPH_MODE = 'OFF';
    resetGraphModeCache();
    expect(getGraphMode()).toBe('off');
  });

  test('미지원 값은 shadow 폴백', () => {
    process.env.SPYGLASS_GRAPH_MODE = 'nonsense';
    resetGraphModeCache();
    expect(getGraphMode()).toBe('shadow');
  });

  test('값은 1회만 파싱되고 캐시됨', () => {
    process.env.SPYGLASS_GRAPH_MODE = 'off';
    resetGraphModeCache();
    expect(getGraphMode()).toBe('off');
    // 캐시 보존 — 환경변수 변경에도 동일 값.
    process.env.SPYGLASS_GRAPH_MODE = 'primary';
    expect(getGraphMode()).toBe('off');
    // 캐시 무효화 시에만 새 값 반영.
    resetGraphModeCache();
    expect(getGraphMode()).toBe('primary');
  });
});
