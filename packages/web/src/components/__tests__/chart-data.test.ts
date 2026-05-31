/**
 * chart-data.test.ts — 차트 순수 데이터 변환 골든마스터 (P3-01)
 *
 * 원본: assets/js/chart.js 의 모듈 내부 순수 로직(색/카운트/HSL/슬라이스/버킷)을
 *   외부 의존(getComputedStyle/document/Date.now 전역)을 인자로 끌어내 순수화 + 추출.
 *   → bun:test(DOM 하네스 없음)에서 결정론 검증 가능. canvas 명령형(ctx.*)은 단위테스트
 *     불충분이라 본 파일은 "무엇을 그릴지"(spec) 계약만 고정하고, ctx 호출은 수동 verify(Gap).
 *
 * 결정론 전략(renderers.test.ts §환경 mock 계승): Date.now 의존 로직(버킷)은
 *   now 를 인자로 주입받는 순수 함수로 분리해 mock 불필요하게 만든다.
 *
 * 회귀 게이트 귀속(tasks.json P3-01 test_strategy): context-window.test.ts(6 case)는
 *   본 task 명시 회귀 게이트. 본 파일은 신규 데이터 변환 골든마스터(addition).
 */
import { describe, it, expect } from 'bun:test';
import {
  chartModeToDonutMode,
  donutItemCount,
  donutItemKey,
  hexToHsl,
  hslToHex,
  shiftLightness,
  modelColor,
  cacheItemColor,
  typeColor,
  donutItemColor,
  donutTotal,
  computeDonutSlices,
  cacheHitRateLabel,
  cacheCreationOf,
  formatDonutCenter,
  advanceBucketsState,
  recordRequestState,
  computeTimelinePoints,
  TIMELINE_BUCKETS,
  type DonutDatum,
  type ColorContext,
} from '../chart-data';

// 토큰 SSoT(design-tokens.css)를 테스트에서는 명시 주입 — getComputedStyle/document 비의존.
const MODEL_TOKENS = {
  haiku: '#7dd3fc',
  sonnet: '#d97757',
  opus: '#a78bfa',
  external: '#f472b6',
  synthetic: '#6e7681',
  unknown: '#6e7681',
} as const;
const CACHE_TOKENS = { read: '#10B981', creation: '#B794F6', others: '#6E7681' } as const;
const TYPE_COLORS = { prompt: '#d97757', tool_call: '#4ade80', system: '#f59e0b' } as const;

function ctx(items: DonutDatum[]): ColorContext {
  return { modelTokens: MODEL_TOKENS, cacheTokens: CACHE_TOKENS, typeColors: TYPE_COLORS, items };
}

describe('chartModeToDonutMode — chart-policy.js setChartMode 매핑 SSoT', () => {
  it("'default' → 'model' (model 분포)", () => {
    expect(chartModeToDonutMode('default')).toBe('model');
  });
  it("'detail' → 'cache' (캐시 퍼포먼스)", () => {
    expect(chartModeToDonutMode('detail')).toBe('cache');
  });
});

describe('donutItemCount — 모드별 카운트 필드 (chart.js donutItemCount)', () => {
  it("type 모드: d.count", () => {
    expect(donutItemCount({ type: 'prompt', count: 7 }, 'type')).toBe(7);
  });
  it("model 모드: d.request_count", () => {
    expect(donutItemCount({ model: 'claude-opus-4', request_count: 42 }, 'model')).toBe(42);
  });
  it("cache 모드: d.tokens", () => {
    expect(donutItemCount({ label: 'Cached', tokens: 1000 }, 'cache')).toBe(1000);
  });
  it('누락 필드는 0', () => {
    expect(donutItemCount({}, 'type')).toBe(0);
    expect(donutItemCount({}, 'model')).toBe(0);
    expect(donutItemCount({}, 'cache')).toBe(0);
  });
});

describe('donutItemKey — 모드별 키 (chart.js donutItemKey)', () => {
  it('cache: label, 누락 시 "?"', () => {
    expect(donutItemKey({ label: 'Cached' }, 'cache')).toBe('Cached');
    expect(donutItemKey({}, 'cache')).toBe('?');
  });
  it('model: model, 누락 시 "?"', () => {
    expect(donutItemKey({ model: 'kimi-k2' }, 'model')).toBe('kimi-k2');
    expect(donutItemKey({}, 'model')).toBe('?');
  });
  it('type: type, 누락 시 "?"', () => {
    expect(donutItemKey({ type: 'system' }, 'type')).toBe('system');
    expect(donutItemKey({}, 'type')).toBe('?');
  });
});

describe('hexToHsl / hslToHex — HSL 왕복 (chart.js hexToHsl/hslToHex)', () => {
  it('순수 빨강/초록/파랑 hue', () => {
    expect(Math.round(hexToHsl('#ff0000').h)).toBe(0);
    expect(Math.round(hexToHsl('#00ff00').h)).toBe(120);
    expect(Math.round(hexToHsl('#0000ff').h)).toBe(240);
  });
  it('3자리 단축 hex 확장', () => {
    expect(hexToHsl('#fff').l).toBeCloseTo(100, 0);
    expect(hexToHsl('#000').l).toBeCloseTo(0, 0);
  });
  it('잘못된 hex → 안전 폴백 {h:0,s:0,l:50}', () => {
    expect(hexToHsl('zzz')).toEqual({ h: 0, s: 0, l: 50 });
    expect(hexToHsl('')).toEqual({ h: 0, s: 0, l: 50 });
  });
  it('왕복(hex→hsl→hex) 근사 보존', () => {
    const out = hslToHex(hexToHsl('#a78bfa'));
    // 라운딩 오차 ±2/255 허용
    expect(out).toMatch(/^#[0-9a-f]{6}$/);
    const a = hexToHsl('#a78bfa');
    const b = hexToHsl(out);
    expect(Math.abs(a.h - b.h)).toBeLessThan(3);
  });
  it('hslToHex 채도/명도 0~100 clamp', () => {
    expect(hslToHex({ h: 0, s: 200, l: 50 })).toMatch(/^#[0-9a-f]{6}$/);
    expect(hslToHex({ h: 0, s: -50, l: 50 })).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('shiftLightness — lightness 단계 (chart.js shiftLightness)', () => {
  it('음수 delta 는 더 어둡게', () => {
    const base = hexToHsl('#a78bfa').l;
    const shifted = hexToHsl(shiftLightness('#a78bfa', -8)).l;
    expect(shifted).toBeLessThan(base);
  });
  it('하한 20 clamp (과도하게 어두워지지 않음)', () => {
    const l = hexToHsl(shiftLightness('#111111', -100)).l;
    expect(l).toBeGreaterThanOrEqual(19.5);
  });
  it('상한 95 clamp', () => {
    const l = hexToHsl(shiftLightness('#eeeeee', +100)).l;
    expect(l).toBeLessThanOrEqual(95.5);
  });
});

describe('modelColor — modelClassOf SSoT + variant (chart.js modelColor)', () => {
  it('분류별 base 토큰', () => {
    expect(modelColor('claude-3-5-haiku', 0, [{ model: 'claude-3-5-haiku' }], MODEL_TOKENS)).toBe(MODEL_TOKENS.haiku);
    expect(modelColor('claude-sonnet-4-5', 0, [{ model: 'claude-sonnet-4-5' }], MODEL_TOKENS)).toBe(MODEL_TOKENS.sonnet);
    expect(modelColor('claude-opus-4-7', 0, [{ model: 'claude-opus-4-7' }], MODEL_TOKENS)).toBe(MODEL_TOKENS.opus);
    expect(modelColor('kimi-k2', 0, [{ model: 'kimi-k2' }], MODEL_TOKENS)).toBe(MODEL_TOKENS.external);
  });
  it('synthetic/unknown 은 variant 미적용(항상 base)', () => {
    const items = [{ model: 'synthetic' }, { model: 'synthetic' }];
    expect(modelColor('synthetic', 1, items, MODEL_TOKENS)).toBe(MODEL_TOKENS.synthetic);
    const u = [{ model: 'weird-x' }, { model: 'weird-y' }];
    expect(modelColor('weird-y', 1, u, MODEL_TOKENS)).toBe(MODEL_TOKENS.unknown);
  });
  it('같은 카테고리 i번째(i>0)는 darker variant', () => {
    const items = [{ model: 'claude-opus-4-7' }, { model: 'claude-opus-4-1' }];
    const first = modelColor('claude-opus-4-7', 0, items, MODEL_TOKENS);
    const second = modelColor('claude-opus-4-1', 1, items, MODEL_TOKENS);
    expect(first).toBe(MODEL_TOKENS.opus);          // rank 0 = base
    expect(second).not.toBe(first);                  // rank 1 = darker
    expect(hexToHsl(second).l).toBeLessThan(hexToHsl(first).l);
  });
});

describe('cacheItemColor — 안정 id 기반 (chart.js cacheItemColor)', () => {
  it('id: cache/hit/hit-rate → read 토큰', () => {
    expect(cacheItemColor({ id: 'cache' }, CACHE_TOKENS)).toBe(CACHE_TOKENS.read);
    expect(cacheItemColor({ id: 'hit' }, CACHE_TOKENS)).toBe(CACHE_TOKENS.read);
    expect(cacheItemColor({ id: 'hit-rate' }, CACHE_TOKENS)).toBe(CACHE_TOKENS.read);
  });
  it('id: creation → creation 토큰', () => {
    expect(cacheItemColor({ id: 'creation' }, CACHE_TOKENS)).toBe(CACHE_TOKENS.creation);
  });
  it('id: others/total/input → others 토큰', () => {
    expect(cacheItemColor({ id: 'others' }, CACHE_TOKENS)).toBe(CACHE_TOKENS.others);
    expect(cacheItemColor({ id: 'total' }, CACHE_TOKENS)).toBe(CACHE_TOKENS.others);
    expect(cacheItemColor({ id: 'input' }, CACHE_TOKENS)).toBe(CACHE_TOKENS.others);
  });
  it('id 없을 때 라벨 폴백(레거시 호출자)', () => {
    expect(cacheItemColor({ label: 'Cached' }, CACHE_TOKENS)).toBe(CACHE_TOKENS.read);
    expect(cacheItemColor({ label: 'Uncached' }, CACHE_TOKENS)).toBe(CACHE_TOKENS.others);
    expect(cacheItemColor({ label: 'Cache Write' }, CACHE_TOKENS)).toBe(CACHE_TOKENS.creation);
  });
});

describe('typeColor — TYPE_COLORS lookup', () => {
  it('타입별 색, 미지정 타입은 dim 폴백', () => {
    expect(typeColor({ type: 'prompt' }, TYPE_COLORS)).toBe(TYPE_COLORS.prompt);
    expect(typeColor({ type: 'tool_call' }, TYPE_COLORS)).toBe(TYPE_COLORS.tool_call);
    expect(typeColor({ type: 'unknown-x' }, TYPE_COLORS)).toBe('#888888');
  });
});

describe('donutItemColor — 모드 디스패치 (chart.js donutItemColor)', () => {
  it('cache 모드 → cacheItemColor', () => {
    expect(donutItemColor({ id: 'creation' }, 0, 'cache', ctx([]))).toBe(CACHE_TOKENS.creation);
  });
  it('model 모드 → modelColor', () => {
    const items: DonutDatum[] = [{ model: 'claude-opus-4-7' }];
    expect(donutItemColor(items[0], 0, 'model', ctx(items))).toBe(MODEL_TOKENS.opus);
  });
  it('type 모드 → typeColor', () => {
    expect(donutItemColor({ type: 'system' }, 0, 'type', ctx([]))).toBe(TYPE_COLORS.system);
  });
});

describe('donutTotal — 모드별 합', () => {
  it('type 모드 count 합', () => {
    expect(donutTotal([{ count: 3 }, { count: 5 }], 'type')).toBe(8);
  });
  it('빈 배열은 0', () => {
    expect(donutTotal([], 'type')).toBe(0);
  });
});

describe('computeDonutSlices — 슬라이스 spec (drawDonut 호출 계약)', () => {
  it('각 슬라이스 비율 합 = 2π (시작 -π/2)', () => {
    const data: DonutDatum[] = [{ type: 'prompt', count: 1 }, { type: 'system', count: 3 }];
    const slices = computeDonutSlices(data, 'type', ctx(data));
    expect(slices.length).toBe(2);
    expect(slices[0].startAngle).toBeCloseTo(-Math.PI / 2, 6);
    const span = slices.reduce((s, sl) => s + (sl.endAngle - sl.startAngle), 0);
    expect(span).toBeCloseTo(Math.PI * 2, 6);
    // 1:3 비율 → 90°:270°
    expect(slices[0].endAngle - slices[0].startAngle).toBeCloseTo(Math.PI / 2, 6);
  });
  it('빈 데이터 → 빈 슬라이스(호출자가 empty ring 처리)', () => {
    expect(computeDonutSlices([], 'type', ctx([]))).toEqual([]);
  });
  it('슬라이스 색은 donutItemColor 와 일치', () => {
    const data: DonutDatum[] = [{ type: 'prompt', count: 1 }];
    const slices = computeDonutSlices(data, 'type', ctx(data));
    expect(slices[0].color).toBe(TYPE_COLORS.prompt);
  });
});

describe('cacheHitRateLabel — 경계 라벨 (drawDonut hit-rate-precision)', () => {
  it('99 초과 100 미만 → ">99%"', () => {
    expect(cacheHitRateLabel(9995, 10000)).toBe('>99%');
  });
  it('0 초과 1 미만 → "<1%"', () => {
    expect(cacheHitRateLabel(5, 10000)).toBe('<1%');
  });
  it('정상 구간은 반올림 정수 %', () => {
    expect(cacheHitRateLabel(2500, 10000)).toBe('25%');
    expect(cacheHitRateLabel(0, 10000)).toBe('0%');
    expect(cacheHitRateLabel(10000, 10000)).toBe('100%');
  });
  it('denom 0 안전(1로 폴백)', () => {
    expect(cacheHitRateLabel(0, 0)).toBe('0%');
  });
});

describe('cacheCreationOf — creation 추출 우선순위 (drawDonut ?? 체인)', () => {
  it('_cacheCreation 메타 우선', () => {
    expect(cacheCreationOf([{ _cacheCreation: 123 }, { id: 'creation', tokens: 999 }])).toBe(123);
  });
  it('id=creation 의 tokens 차순위', () => {
    expect(cacheCreationOf([{ id: 'creation', tokens: 50 }])).toBe(50);
  });
  it("label='Cache Write' 의 tokens 차순위", () => {
    expect(cacheCreationOf([{ label: 'Cache Write', tokens: 70 }])).toBe(70);
  });
  it('없으면 0', () => {
    expect(cacheCreationOf([{ id: 'others', tokens: 1 }])).toBe(0);
  });
});

describe('formatDonutCenter — total 중앙 표기 (drawDonut)', () => {
  it('1000 이상은 k 단위 소수1', () => {
    expect(formatDonutCenter(1500)).toBe('1.5k');
    expect(formatDonutCenter(1000)).toBe('1.0k');
  });
  it('1000 미만은 그대로', () => {
    expect(formatDonutCenter(999)).toBe('999');
    expect(formatDonutCenter(0)).toBe('0');
  });
});

describe('타임라인 버킷 — Date.now 인자 주입 순수화 (chart.js advanceBuckets/recordRequest)', () => {
  it('TIMELINE_BUCKETS = 30', () => {
    expect(TIMELINE_BUCKETS).toBe(30);
  });
  it('advanceBucketsState: last=-1 초기화는 시프트 없이 last 만 세팅', () => {
    const buckets = Array(TIMELINE_BUCKETS).fill(0);
    const r = advanceBucketsState(buckets, -1, 100);
    expect(r.lastBucketMinute).toBe(100);
    expect(r.buckets).toEqual(buckets);
  });
  it('advanceBucketsState: 분 차이만큼 좌측 시프트 + 우측 0 채움', () => {
    const buckets = [1, 2, 3, ...Array(TIMELINE_BUCKETS - 3).fill(0)];
    const r = advanceBucketsState(buckets, 100, 102); // diff=2
    expect(r.buckets.length).toBe(TIMELINE_BUCKETS);
    expect(r.buckets.slice(0, 1)).toEqual([3]); // 앞 2칸 밀려나감
    expect(r.buckets[TIMELINE_BUCKETS - 1]).toBe(0);
    expect(r.lastBucketMinute).toBe(102);
  });
  it('advanceBucketsState: diff<=0 이면 변경 없음', () => {
    const buckets = [5, ...Array(TIMELINE_BUCKETS - 1).fill(0)];
    const r = advanceBucketsState(buckets, 100, 100);
    expect(r.buckets).toEqual(buckets);
    expect(r.lastBucketMinute).toBe(100);
  });
  it('advanceBucketsState: diff>BUCKETS 는 전체 클리어', () => {
    const buckets = [1, 2, 3, ...Array(TIMELINE_BUCKETS - 3).fill(0)];
    const r = advanceBucketsState(buckets, 0, 1000);
    expect(r.buckets).toEqual(Array(TIMELINE_BUCKETS).fill(0));
  });
  it('recordRequestState: 마지막 버킷 +1 (현재 분 동일 가정)', () => {
    const buckets = Array(TIMELINE_BUCKETS).fill(0);
    const r = recordRequestState(buckets, 100, 100);
    expect(r.buckets[TIMELINE_BUCKETS - 1]).toBe(1);
    expect(r.lastBucketMinute).toBe(100);
  });
  it('computeTimelinePoints: n개 점, x 등간격, y 는 maxVal 정규화', () => {
    const buckets = [0, 5, 10];
    const pts = computeTimelinePoints(buckets, { padL: 0, padR: 0, padT: 0, padB: 0, width: 100, height: 100 });
    expect(pts.length).toBe(3);
    expect(pts[0].x).toBeCloseTo(0, 6);
    expect(pts[2].x).toBeCloseTo(100, 6);
    // max=10 → 10 의 y 는 top(0), 0 의 y 는 bottom(height)
    expect(pts[2].y).toBeCloseTo(0, 6);
    expect(pts[0].y).toBeCloseTo(100, 6);
  });
});
