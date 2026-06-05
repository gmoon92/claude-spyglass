/**
 * filter-result.test.ts — computeDetailFilterResult ≡ flat-view.js#applyDetailFilter 집계 코어 (P3-05)
 *
 * oracle 부재 사유: 원본 applyDetailFilter 는 DOM querySelectorAll(:80) + dispatchEvent(:123)
 *   부수효과와 한 몸이라 순수 호출이 불가하다. 따라서 본 테스트는 flat-view.js:52-120 의 분기를
 *   문서화된 계약(P3-04 §2.1, 주석 :86-114)에 맞춰 직접 고정한다(characterization).
 *   SUB_TYPES/subTypeOf/getAnomalyFlagsForRow 는 동일 SSoT 를 import 하므로 분류·플래그 자체는
 *   원본과 자동 동치.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { computeDetailFilterResult } from '../filter-result';

beforeAll(() => {
  // 루트 bun test(jsdom 부재)용 window 보장. i18n 은 vitest.setup 의 기본 t(passthrough)가 담당.
  (globalThis as any).window = (globalThis as any).window ?? {};
});

const req = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  turn_id: 't1',
  ...extra,
});

describe('countMap / labelMap', () => {
  it('전체 범위 카운트 + system 은 systemHashCount 사용(type 집계 아님)', () => {
    const requests = [
      req('1', 'prompt'),
      req('2', 'tool_call', { tool_name: 'Read' }),
      req('3', 'tool_call', { tool_name: 'Agent', tool_detail: 'x' }),
      req('4', 'tool_call', { tool_name: 'mcp__r__getIssue' }),
      req('5', 'system'),
    ];
    const { countMap, labelMap } = computeDetailFilterResult({
      requests,
      turns: [],
      filter: 'all',
      systemHashCount: 7,
    });
    expect(countMap.all).toBe(5);
    expect(countMap.prompt).toBe(1);
    expect(countMap.tool_call).toBe(3);
    expect(countMap.agent).toBe(1);
    expect(countMap.mcp).toBe(1);
    expect(countMap.system).toBe(7); // type='system' 행 수(1)가 아니라 systemHashCount
    expect(labelMap.all).toBe('All (5)');
    expect(labelMap.system).toBe('system (7)');
    expect(labelMap.agent).toBe('Agent (1)');
  });

  it('활성 턴 좁힘 — activeTurnId 범위로 카운트', () => {
    const requests = [
      req('1', 'tool_call', { tool_name: 'Read', turn_id: 't1' }),
      req('2', 'tool_call', { tool_name: 'Read', turn_id: 't1' }),
      req('3', 'tool_call', { tool_name: 'Read', turn_id: 't2' }),
    ];
    const { countMap } = computeDetailFilterResult({ requests, turns: [], filter: 'all', activeTurnId: 't1' });
    expect(countMap.all).toBe(2); // t1 범위만
  });

  it('활성 턴 매칭 0건 → 전체 폴백(빈 상태 회피)', () => {
    const requests = [req('1', 'tool_call', { tool_name: 'Read', turn_id: 't1' })];
    const { countMap } = computeDetailFilterResult({ requests, turns: [], filter: 'all', activeTurnId: 'tX' });
    expect(countMap.all).toBe(1); // tX 매칭 0 → 전체
  });
});

describe('flatFiltered 분기 (flat-view.js:86-88)', () => {
  const requests = [
    req('1', 'prompt'),
    req('2', 'tool_call', { tool_name: 'Read' }),
    req('3', 'tool_call', { tool_name: 'Agent', tool_detail: 'x' }),
    req('4', 'tool_call', { tool_name: 'Skill', tool_detail: 'y' }),
  ];

  it('all → 전체', () => {
    const { flatFiltered } = computeDetailFilterResult({ requests, turns: [], filter: 'all' });
    expect(flatFiltered.map((r) => r.id)).toEqual(['1', '2', '3', '4']);
  });
  it('type 필터(prompt) → type 일치', () => {
    const { flatFiltered } = computeDetailFilterResult({ requests, turns: [], filter: 'prompt' });
    expect(flatFiltered.map((r) => r.id)).toEqual(['1']);
  });
  it('SUB_TYPES 필터(agent) → subTypeOf 일치', () => {
    const { flatFiltered } = computeDetailFilterResult({ requests, turns: [], filter: 'agent' });
    expect(flatFiltered.map((r) => r.id)).toEqual(['3']);
  });
});

describe('turnFiltered 분기 (flat-view.js:98-102)', () => {
  const turns = [
    { id: 'a', prompt: { id: 'p' }, tool_calls: [{ id: 'tc' }] },
    { id: 'b', prompt: null, tool_calls: [] },
    { id: 'c', prompt: { id: 'p2' }, tool_calls: [] },
  ];
  it('all → 전체', () => {
    const { turnFiltered } = computeDetailFilterResult({ requests: [], turns, filter: 'all' });
    expect(turnFiltered.length).toBe(3);
  });
  it('tool_call → tool_calls>0', () => {
    const { turnFiltered } = computeDetailFilterResult({ requests: [], turns, filter: 'tool_call' });
    expect(turnFiltered.map((t) => t.id)).toEqual(['a']);
  });
  it('prompt → !!prompt', () => {
    const { turnFiltered } = computeDetailFilterResult({ requests: [], turns, filter: 'prompt' });
    expect(turnFiltered.map((t) => t.id)).toEqual(['a', 'c']);
  });
  it('SUB_TYPES(mcp) → tool_calls>0', () => {
    const { turnFiltered } = computeDetailFilterResult({ requests: [], turns, filter: 'mcp' });
    expect(turnFiltered.map((t) => t.id)).toEqual(['a']);
  });
  it('알 수 없는 필터(system) → []', () => {
    const { turnFiltered } = computeDetailFilterResult({ requests: [], turns, filter: 'system' });
    expect(turnFiltered).toEqual([]);
  });
});

describe('anomalyMap (flat-view.js:92-114, ADR-003 서버 채움)', () => {
  it('flat → row.id Set, turn → turn_id OR 집계', () => {
    const requests = [
      req('1', 'tool_call', { tool_name: 'Bash', turn_id: 't1', spike: { stage: 'spike' } }),
      req('2', 'response', { turn_id: 't1', slow: { stage: 'slow' } }),
      req('3', 'tool_call', { tool_name: 'Read', turn_id: 't2' }), // flag 없음
    ];
    const { flatAnomalyMap, turnAnomalyMap } = computeDetailFilterResult({ requests, turns: [], filter: 'all' });

    expect([...flatAnomalyMap.get('1')!]).toEqual(['spike']);
    expect([...flatAnomalyMap.get('2')!]).toEqual(['slow']);
    expect(flatAnomalyMap.has('3')).toBe(false);

    // t1 = spike(1) OR slow(2)
    expect(turnAnomalyMap.get('t1')).toEqual(new Set(['spike', 'slow']));
    expect(turnAnomalyMap.has('t2')).toBe(false);
  });
});
