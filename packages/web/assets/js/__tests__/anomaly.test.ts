/**
 * anomaly.test.ts — 클라이언트 anomaly 표시 헬퍼 테스트
 *
 * @description
 *   anomaly-bloated-sys ADR-003 적용으로 클라이언트 계산 로직(`detectAnomalies`)이 폐기됨.
 *   기존 spike/loop/slow 산식·임계 검증 케이스는 서버 단위 테스트로 이관:
 *     - packages/server/src/metrics/calculators/__tests__/anomaly.test.ts (T-21)
 *
 *   본 파일은 표시 매핑 헬퍼(`getAnomalyFlagsForRow`)만 가볍게 검증한다.
 *   서버가 채운 `bloated_sys` / `agent_spike` 필드를 Set<string> 으로 정확히 변환하는지 확인.
 *
 * @see packages/web/assets/js/anomaly.js
 * @see .claude/docs/plans/anomaly-bloated-sys/adr.md ADR-003
 */

import { describe, it, expect } from 'bun:test';
import { getAnomalyFlagsForRow } from '../anomaly.js';

describe('getAnomalyFlagsForRow — bloated_sys 매핑 (ADR-001/003)', () => {
  it('stage="warn" → "bloated-sys-warn" 플래그', () => {
    const row = {
      id: 'r1',
      bloated_sys: { stage: 'warn', pct: 0.18, system_tokens: 1000 },
    };
    const flags = getAnomalyFlagsForRow(row);
    expect(flags.has('bloated-sys-warn')).toBe(true);
    expect(flags.has('bloated-sys-critical')).toBe(false);
  });

  it('stage="critical" → "bloated-sys-critical" 플래그', () => {
    const row = {
      id: 'r1',
      bloated_sys: { stage: 'critical', pct: 0.82, system_tokens: 9000 },
    };
    const flags = getAnomalyFlagsForRow(row);
    expect(flags.has('bloated-sys-critical')).toBe(true);
    expect(flags.has('bloated-sys-warn')).toBe(false);
  });

  it('stage=null → 플래그 없음', () => {
    const row = {
      id: 'r1',
      bloated_sys: { stage: null, pct: 0.05, system_tokens: 100 },
    };
    const flags = getAnomalyFlagsForRow(row);
    expect(flags.size).toBe(0);
  });

  it('bloated_sys 필드 자체가 없으면 무시', () => {
    const row = { id: 'r1' };
    const flags = getAnomalyFlagsForRow(row);
    expect(flags.size).toBe(0);
  });
});

describe('getAnomalyFlagsForRow — agent_spike 매핑 (ADR-002/003)', () => {
  it('stage="spike" → "agent-spike" 플래그', () => {
    const row = {
      id: 'r1',
      agent_spike: { stage: 'spike', multiplier: 12, child_token_sum: 30000 },
    };
    const flags = getAnomalyFlagsForRow(row);
    expect(flags.has('agent-spike')).toBe(true);
  });

  it('stage=null → 플래그 없음', () => {
    const row = {
      id: 'r1',
      agent_spike: { stage: null, multiplier: 2 },
    };
    const flags = getAnomalyFlagsForRow(row);
    expect(flags.size).toBe(0);
  });

  it('agent_spike 필드 자체가 없으면 무시', () => {
    const row = { id: 'r1' };
    const flags = getAnomalyFlagsForRow(row);
    expect(flags.size).toBe(0);
  });
});

describe('getAnomalyFlagsForRow — 복수 플래그 + 엣지 케이스', () => {
  it('bloated-sys + agent-spike 동시 부여 가능', () => {
    const row = {
      id: 'r1',
      bloated_sys: { stage: 'critical' },
      agent_spike: { stage: 'spike', multiplier: 15 },
    };
    const flags = getAnomalyFlagsForRow(row);
    expect(flags.has('bloated-sys-critical')).toBe(true);
    expect(flags.has('agent-spike')).toBe(true);
  });

  it('null/undefined row 안전 처리', () => {
    expect(getAnomalyFlagsForRow(null).size).toBe(0);
    expect(getAnomalyFlagsForRow(undefined).size).toBe(0);
  });
});
