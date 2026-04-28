import { describe, it, expect } from 'bun:test';
import { detectAnomalies } from '../anomaly.js';

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

function prompt(id: string, session_id: string, tokens_input: number) {
  return { id, type: 'prompt', session_id, tokens_input, turn_id: null, tool_name: null, duration_ms: 0 };
}

function tool(id: string, turn_id: string, tool_name: string, duration_ms = 0) {
  return { id, type: 'tool_call', session_id: 's1', tokens_input: 0, turn_id, tool_name, duration_ms };
}

// ── spike ─────────────────────────────────────────────────────────────────────

describe('detectAnomalies — spike', () => {
  it('세션 내 평균의 2배 초과 → spike 플래그', () => {
    // arr = [100, 100, 401], avg = 601/3 ≈ 200.33, avg*2 ≈ 400.67
    // 401 > 400.67 → spike
    const reqs = [
      prompt('r1', 's1', 100),
      prompt('r2', 's1', 100),
      prompt('r3', 's1', 401),
    ];
    const map = detectAnomalies(reqs);
    expect(map.get('r3')?.has('spike')).toBe(true);
    expect(map.has('r1')).toBe(false);
    expect(map.has('r2')).toBe(false);
  });

  it('정확히 2배(400) → spike 아님 (> 조건, spike 포함 평균)', () => {
    // arr = [100, 100, 400], avg = 600/3 = 200, avg*2 = 400
    // 400 > 400 → false (strict >)
    const reqs = [
      prompt('r1', 's1', 100),
      prompt('r2', 's1', 100),
      prompt('r3', 's1', 400),
    ];
    const map = detectAnomalies(reqs);
    expect(map.get('r3')?.has('spike')).toBeFalsy();
  });

  it('세션 내 요청 1개 → 비교 기준 없어 spike 없음', () => {
    const reqs = [prompt('r1', 's1', 9999)];
    const map = detectAnomalies(reqs);
    expect(map.has('r1')).toBe(false);
  });

  it('세션이 다르면 독립적으로 평균 계산', () => {
    // s1: [100, 100, 401], avg ≈ 200.33 → r3 spike
    // s2: [500, 500, 1000], avg ≈ 666.7, 1000 < 1333 → no spike
    const reqs = [
      prompt('r1', 's1', 100),
      prompt('r2', 's1', 100),
      prompt('r3', 's1', 401),
      prompt('r4', 's2', 500),
      prompt('r5', 's2', 500),
      prompt('r6', 's2', 1000),
    ];
    const map = detectAnomalies(reqs);
    expect(map.get('r3')?.has('spike')).toBe(true);
    expect(map.get('r6')?.has('spike')).toBeFalsy();
  });
});

// ── loop ──────────────────────────────────────────────────────────────────────

describe('detectAnomalies — loop', () => {
  it('동일 tool 연속 정확히 3회 → 3개 모두 loop 플래그', () => {
    const reqs = [
      tool('t1', 'turn1', 'Bash'),
      tool('t2', 'turn1', 'Bash'),
      tool('t3', 'turn1', 'Bash'),
    ];
    const map = detectAnomalies(reqs);
    expect(map.get('t1')?.has('loop')).toBe(true);
    expect(map.get('t2')?.has('loop')).toBe(true);
    expect(map.get('t3')?.has('loop')).toBe(true);
  });

  it('동일 tool 연속 4회 → 4개 모두 loop 플래그', () => {
    const reqs = [
      tool('t1', 'turn1', 'Read'),
      tool('t2', 'turn1', 'Read'),
      tool('t3', 'turn1', 'Read'),
      tool('t4', 'turn1', 'Read'),
    ];
    const map = detectAnomalies(reqs);
    ['t1', 't2', 't3', 't4'].forEach(id =>
      expect(map.get(id)?.has('loop')).toBe(true)
    );
  });

  it('동일 tool 연속 2회 → loop 없음', () => {
    const reqs = [
      tool('t1', 'turn1', 'Bash'),
      tool('t2', 'turn1', 'Bash'),
    ];
    const map = detectAnomalies(reqs);
    expect(map.get('t1')?.has('loop')).toBeFalsy();
    expect(map.get('t2')?.has('loop')).toBeFalsy();
  });

  it('tool이 중간에 달라지면 streak 초기화', () => {
    // AA B AA → 어느 쪽도 3회 미달
    const reqs = [
      tool('t1', 'turn1', 'Bash'),
      tool('t2', 'turn1', 'Bash'),
      tool('t3', 'turn1', 'Read'),
      tool('t4', 'turn1', 'Bash'),
      tool('t5', 'turn1', 'Bash'),
    ];
    const map = detectAnomalies(reqs);
    ['t1', 't2', 't3', 't4', 't5'].forEach(id =>
      expect(map.get(id)?.has('loop')).toBeFalsy()
    );
  });

  it('turn_id가 다르면 독립적으로 streak 계산', () => {
    // turn1: 2회, turn2: 3회
    const reqs = [
      tool('t1', 'turn1', 'Bash'),
      tool('t2', 'turn1', 'Bash'),
      tool('t3', 'turn2', 'Read'),
      tool('t4', 'turn2', 'Read'),
      tool('t5', 'turn2', 'Read'),
    ];
    const map = detectAnomalies(reqs);
    expect(map.get('t1')?.has('loop')).toBeFalsy();
    expect(map.get('t2')?.has('loop')).toBeFalsy();
    expect(map.get('t3')?.has('loop')).toBe(true);
    expect(map.get('t4')?.has('loop')).toBe(true);
    expect(map.get('t5')?.has('loop')).toBe(true);
  });
});

// ── slow ──────────────────────────────────────────────────────────────────────

describe('detectAnomalies — slow', () => {
  it('duration_ms가 P95 초과 → slow 플래그', () => {
    const reqs = [tool('t1', 'turn1', 'Bash', 1001)];
    const map = detectAnomalies(reqs, 1000);
    expect(map.get('t1')?.has('slow')).toBe(true);
  });

  it('duration_ms가 P95 정확히 같음 → slow 아님 (> 조건)', () => {
    const reqs = [tool('t1', 'turn1', 'Bash', 1000)];
    const map = detectAnomalies(reqs, 1000);
    expect(map.get('t1')?.has('slow')).toBeFalsy();
  });

  it('duration_ms가 P95 미만 → slow 없음', () => {
    const reqs = [tool('t1', 'turn1', 'Bash', 999)];
    const map = detectAnomalies(reqs, 1000);
    expect(map.get('t1')?.has('slow')).toBeFalsy();
  });

  it('p95DurationMs가 null → slow 검사 안 함', () => {
    const reqs = [tool('t1', 'turn1', 'Bash', 9999999)];
    const map = detectAnomalies(reqs, null);
    expect(map.get('t1')?.has('slow')).toBeFalsy();
  });
});

// ── 엣지 케이스 ──────────────────────────────────────────────────────────────

describe('detectAnomalies — 엣지 케이스', () => {
  it('빈 배열 → 빈 Map 반환', () => {
    const map = detectAnomalies([]);
    expect(map.size).toBe(0);
  });

  it('단일 요청 → 이상 없음', () => {
    const map = detectAnomalies([prompt('r1', 's1', 9999)], 1);
    expect(map.size).toBe(0);
  });

  it('하나의 요청에 여러 플래그 동시 가능', () => {
    // loop + slow 동시
    const reqs = [
      tool('t1', 'turn1', 'Bash', 2000),
      tool('t2', 'turn1', 'Bash', 2000),
      tool('t3', 'turn1', 'Bash', 2000),
    ];
    const map = detectAnomalies(reqs, 1000);
    expect(map.get('t1')?.has('loop')).toBe(true);
    expect(map.get('t1')?.has('slow')).toBe(true);
  });
});
