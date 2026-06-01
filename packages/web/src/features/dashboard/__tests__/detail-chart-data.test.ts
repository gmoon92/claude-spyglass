/**
 * detail-chart-data.test.ts — detail 모드 차트 데이터 파생 순수 함수 검증.
 *
 * 레거시 대조: session-detail/flat-view.ts(DETAIL_FILTER_CHANGED :164~191) 의 cache 도넛 산식.
 *  - cacheDenom = read + creation + input, 슬라이스: cache=creation / others=denom-creation.
 *  - _cacheCreation 메타 = creation(가운데 hit-rate 분자), tokens<=0 슬라이스 제거.
 */
import { describe, it, expect } from 'vitest';
import { toContextTurns, toCacheRequests, buildCacheDonut, type SessionTurnLike } from '../detail-chart-data';

const LABELS = { cache: 'Cache', others: 'Others' };

describe('toContextTurns', () => {
  it('prompt 필드를 ContextTurn 으로 통과 + turn_index 보존', () => {
    const turns: SessionTurnLike[] = [
      { turn_index: 1, prompt: { context_tokens: 100, model: 'opus', window_max: 1000 } },
      { turn_index: 2, prompt: null },
    ];
    const out = toContextTurns(turns);
    expect(out).toHaveLength(2);
    expect(out[0].turn_index).toBe(1);
    expect(out[0].prompt?.context_tokens).toBe(100);
    expect(out[1].prompt).toBeNull();
  });

  it('null/undefined → 빈 배열', () => {
    expect(toContextTurns(null)).toEqual([]);
    expect(toContextTurns(undefined)).toEqual([]);
  });
});

describe('toCacheRequests', () => {
  it('prompt/tool_calls/responses 를 type 부여해 평탄화', () => {
    const turns: SessionTurnLike[] = [
      {
        prompt: { cache_read_tokens: 500, cache_creation_tokens: 50, tokens_input: 10 },
        tool_calls: [{ tokens_input: 5 }, { tokens_input: 7 }],
        responses: [{ tokens_input: 0 }],
      },
    ];
    const flat = toCacheRequests(turns);
    expect(flat.map((r) => r.type)).toEqual(['prompt', 'tool_call', 'tool_call', 'response']);
    // prompt 만 cache 필드 보유.
    expect(flat[0].cache_read_tokens).toBe(500);
    expect(flat[1].tokens_input).toBe(5);
  });
});

describe('buildCacheDonut — 레거시 flat-view.ts SSoT', () => {
  it('cache=creation / others=denom-creation, _cacheCreation 메타, tokens<=0 제거', () => {
    const turns: SessionTurnLike[] = [
      {
        prompt: { cache_read_tokens: 800, cache_creation_tokens: 20, tokens_input: 180 },
      },
    ];
    // denom = 800 + 20 + 180 = 1000. cache=20, others=980.
    const donut = buildCacheDonut(turns, LABELS);
    expect(donut).toHaveLength(2);
    const cache = donut.find((d) => d.id === 'cache')!;
    const others = donut.find((d) => d.id === 'others')!;
    expect(cache.tokens).toBe(20);
    expect(cache._cacheCreation).toBe(20);
    expect(cache.label).toBe('Cache');
    expect(others.tokens).toBe(980);
    expect(others.label).toBe('Others');
  });

  it('creation=0 → cache 슬라이스 제거(tokens<=0 filter)', () => {
    const turns: SessionTurnLike[] = [
      { prompt: { cache_read_tokens: 100, cache_creation_tokens: 0, tokens_input: 0 } },
    ];
    const donut = buildCacheDonut(turns, LABELS);
    expect(donut.map((d) => d.id)).toEqual(['others']);
    expect(donut[0].tokens).toBe(100);
  });

  it('tool_calls tokens_input 이 분모(others)에 포함됨(레거시 allRequests 분모 재현)', () => {
    const turns: SessionTurnLike[] = [
      {
        prompt: { cache_read_tokens: 0, cache_creation_tokens: 10, tokens_input: 0 },
        tool_calls: [{ tokens_input: 90 }],
      },
    ];
    // denom = 0 + 10 + 90 = 100. cache=10, others=90.
    const donut = buildCacheDonut(turns, LABELS);
    expect(donut.find((d) => d.id === 'cache')!.tokens).toBe(10);
    expect(donut.find((d) => d.id === 'others')!.tokens).toBe(90);
  });

  it('빈 turns → 빈 도넛(모든 슬라이스 tokens=0 제거)', () => {
    expect(buildCacheDonut([], LABELS)).toEqual([]);
    expect(buildCacheDonut(null, LABELS)).toEqual([]);
  });
});
