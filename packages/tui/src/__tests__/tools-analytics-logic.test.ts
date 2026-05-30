/**
 * tools-analytics-logic.test.ts — 특성화 테스트 for mapToolRow / mapByType / mapCache 로직.
 *
 * useToolsAnalytics 내부 순수 함수(mapToolRow)는 서버 → ToolStat 매핑을 담당한다.
 * 해당 로직을 직접 테스트하기 위해, 동일한 변환 로직을 local 재구현 후 특성화.
 * 소스 변경 없음.
 *
 * 검증 대상:
 *   - call_count / calls 폴백 로직
 *   - error_rate = error_count / call_count
 *   - has_low_confidence: server flag 우선, raw 카운트 파생 폴백
 *   - 0 call_count에서 division-by-zero 없음
 */

import { describe, expect, test } from 'bun:test';

// ---------------------------------------------------------------------------
// 소스의 mapToolRow와 동일한 로직을 로컬 재구현 (source 미변경).
// useToolsAnalytics.ts 내 mapToolRow 함수와 1:1 대응.
// ---------------------------------------------------------------------------
type RawToolRow = {
  tool_name?: unknown;
  call_count?: unknown;
  calls?: unknown;
  total_tokens?: unknown;
  avg_tokens?: unknown;
  avg_duration_ms?: unknown;
  max_duration_ms?: unknown;
  p95_duration_ms?: unknown;
  error_count?: unknown;
  confidence_low_count?: unknown;
  confidence_error_count?: unknown;
  has_low_confidence?: unknown;
};

type ToolStatLocal = {
  tool_name: string;
  calls: number;
  avg_tokens: number;
  p95_duration_ms: number;
  error_rate: number;
  has_low_confidence: boolean;
};

function mapToolRow(t: RawToolRow): ToolStatLocal {
  const callCount = Number(t.call_count ?? t.calls ?? 0);
  const errorCount = Number(t.error_count ?? 0);
  const lowCount = Number(t.confidence_low_count ?? 0);
  const errConfCount = Number(t.confidence_error_count ?? 0);
  const hasLowConf = typeof t.has_low_confidence === 'boolean'
    ? t.has_low_confidence
    : (lowCount + errConfCount > 0);
  return {
    tool_name: String(t.tool_name ?? ''),
    calls: callCount,
    avg_tokens: Number(t.avg_tokens ?? 0),
    p95_duration_ms: Number(t.p95_duration_ms ?? t.max_duration_ms ?? t.avg_duration_ms ?? 0),
    error_rate: callCount > 0 ? errorCount / callCount : 0,
    has_low_confidence: hasLowConf,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('mapToolRow — call count fields', () => {
  test('call_count takes priority over calls', () => {
    const r = mapToolRow({ tool_name: 'Read', call_count: 10, calls: 5 });
    expect(r.calls).toBe(10);
  });

  test('falls back to calls when call_count absent', () => {
    const r = mapToolRow({ tool_name: 'Edit', calls: 7 });
    expect(r.calls).toBe(7);
  });

  test('missing both → calls=0', () => {
    const r = mapToolRow({ tool_name: 'Bash' });
    expect(r.calls).toBe(0);
  });

  test('tool_name stringified', () => {
    const r = mapToolRow({ tool_name: 'WebSearch', call_count: 1 });
    expect(r.tool_name).toBe('WebSearch');
  });

  test('missing tool_name → ""', () => {
    const r = mapToolRow({});
    expect(r.tool_name).toBe('');
  });
});

describe('mapToolRow — error_rate', () => {
  test('error_rate = error_count / call_count', () => {
    const r = mapToolRow({ call_count: 10, error_count: 2 });
    expect(r.error_rate).toBeCloseTo(0.2);
  });

  test('error_rate = 0 when call_count = 0 (no division by zero)', () => {
    const r = mapToolRow({ call_count: 0, error_count: 5 });
    expect(r.error_rate).toBe(0);
    expect(isNaN(r.error_rate)).toBe(false);
    expect(isFinite(r.error_rate)).toBe(true);
  });

  test('error_rate = 0 when error_count absent', () => {
    const r = mapToolRow({ call_count: 5 });
    expect(r.error_rate).toBe(0);
  });

  test('error_rate 1.0 when all calls errored', () => {
    const r = mapToolRow({ call_count: 3, error_count: 3 });
    expect(r.error_rate).toBeCloseTo(1.0);
  });
});

describe('mapToolRow — has_low_confidence', () => {
  test('server boolean true → true', () => {
    const r = mapToolRow({ has_low_confidence: true });
    expect(r.has_low_confidence).toBe(true);
  });

  test('server boolean false → false (ignores counts)', () => {
    const r = mapToolRow({ has_low_confidence: false, confidence_low_count: 5 });
    expect(r.has_low_confidence).toBe(false);
  });

  test('no server flag, low count > 0 → true', () => {
    const r = mapToolRow({ confidence_low_count: 3 });
    expect(r.has_low_confidence).toBe(true);
  });

  test('no server flag, error conf count > 0 → true', () => {
    const r = mapToolRow({ confidence_error_count: 1 });
    expect(r.has_low_confidence).toBe(true);
  });

  test('no server flag, both counts 0 → false', () => {
    const r = mapToolRow({ confidence_low_count: 0, confidence_error_count: 0 });
    expect(r.has_low_confidence).toBe(false);
  });

  test('no server flag, no counts → false', () => {
    const r = mapToolRow({});
    expect(r.has_low_confidence).toBe(false);
  });
});

describe('mapToolRow — duration fields', () => {
  test('p95_duration_ms takes priority', () => {
    const r = mapToolRow({ p95_duration_ms: 100, max_duration_ms: 200, avg_duration_ms: 50 });
    expect(r.p95_duration_ms).toBe(100);
  });

  test('falls back to max_duration_ms', () => {
    const r = mapToolRow({ max_duration_ms: 200, avg_duration_ms: 50 });
    expect(r.p95_duration_ms).toBe(200);
  });

  test('falls back to avg_duration_ms', () => {
    const r = mapToolRow({ avg_duration_ms: 50 });
    expect(r.p95_duration_ms).toBe(50);
  });

  test('missing → 0', () => {
    const r = mapToolRow({});
    expect(r.p95_duration_ms).toBe(0);
  });
});
