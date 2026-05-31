/**
 * context-chart.test.tsx — 누적 토큰 차트 순수 데이터 + ContextChart 가드 (P3-09)
 *
 * resolveSessionContextWindow/computeContextChartModel/computePoints/bloated-sys 산술 골든마스터.
 * 캔버스 명령형 그리기는 단위 불가(Chart.tsx Gap 동일) → null/ctx-null 가드만 검증.
 */
import { describe, it, expect } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  resolveSessionContextWindow,
  hasValidContextData,
  computeContextChartModel,
  computePoints,
  extractBloatedSysFromTurns,
  bloatedSysBaseline,
  bloatedSysSplit,
  fmtK,
  fmtDelta,
  type ContextTurn,
  type ChartDims,
} from '../context-chart-data';
import { ContextChart, drawContextChartToCanvas } from '../ContextChart';
import { DEFAULT_CONTEXT_WINDOW } from '../context-window';

const turns: ContextTurn[] = [
  { turn_index: 0, prompt: { model: 'claude-opus', context_tokens: 1000, window_max: 1_000_000 } },
  { turn_index: 1, prompt: { model: 'claude-opus', context_tokens: 5000, window_max: 1_000_000 } },
  { turn_index: 2, prompt: { model: 'claude-opus', context_tokens: 12000, window_max: 1_000_000 } },
];

describe('resolveSessionContextWindow', () => {
  it('최신 prompt window_max 채택 + 라벨', () => {
    const cw = resolveSessionContextWindow(turns);
    expect(cw.size).toBe(1_000_000);
    expect(cw.label).toBe('1M');
    expect(cw.model).toBe('claude-opus');
  });
  it('window_max 누락 → 200K 폴백', () => {
    const cw = resolveSessionContextWindow([{ prompt: { model: 'x' } }]);
    expect(cw.size).toBe(DEFAULT_CONTEXT_WINDOW);
  });
  it('prompt 없음 → 200K + model null', () => {
    const cw = resolveSessionContextWindow([{}]);
    expect(cw.size).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(cw.model).toBeNull();
  });
});

describe('hasValidContextData / computeContextChartModel', () => {
  it('유효 데이터 없으면 model null', () => {
    expect(hasValidContextData([])).toBe(false);
    expect(computeContextChartModel([])).toBeNull();
    expect(computeContextChartModel([{ prompt: { model: 'x', context_tokens: 0, tokens_input: 0 } }])).toBeNull();
  });
  it('정렬/값/maxVal/latest/pct 계산', () => {
    const m = computeContextChartModel(turns)!;
    expect(m.values).toEqual([1000, 5000, 12000]);
    expect(m.maxVal).toBe(1_000_000); // window > 데이터
    expect(m.latest).toBe(12000);
    expect(m.pctOfWindow).toBeCloseTo(1.2, 1);
  });
  it('turn_index 역순 입력도 정렬', () => {
    const rev = [...turns].reverse();
    const m = computeContextChartModel(rev)!;
    expect(m.values).toEqual([1000, 5000, 12000]);
  });
});

describe('computePoints — 좌표 산술', () => {
  const dims: ChartDims = { width: 100, height: 80, pad: { top: 4, right: 6, bottom: 4, left: 6 } };
  it('n>1: 첫/마지막 x 가 좌우 끝', () => {
    const m = computeContextChartModel(turns)!;
    const pts = computePoints(m, dims);
    expect(pts).toHaveLength(3);
    expect(pts[0].cx).toBeCloseTo(6, 5); // pad.left
    expect(pts[2].cx).toBeCloseTo(94, 5); // width - pad.right
    expect(pts[1].delta).toBe(4000); // 5000-1000
  });
  it('n===1: 가운데 정렬', () => {
    const m = computeContextChartModel([turns[0]])!;
    const pts = computePoints(m, dims);
    // cW=88, 가운데 = pad.left + cW/2 = 6+44 = 50
    expect(pts[0].cx).toBeCloseTo(50, 5);
    expect(pts[0].delta).toBeNull();
  });
});

describe('bloated_sys 추출/baseline/split', () => {
  const bs = { stage: 'warn', pct: 0.4, system_tokens: 400_000 };
  it('extractBloatedSysFromTurns: prompt/session 레벨, normal 제외', () => {
    expect(extractBloatedSysFromTurns([{ prompt: { model: 'x', bloated_sys: bs } }])).toEqual(bs);
    expect(extractBloatedSysFromTurns([{ bloated_sys: { stage: 'normal' } }])).toBeNull();
    expect(extractBloatedSysFromTurns([])).toBeNull();
  });
  it('baseline: warn/critical + pct + window>0 일 때만 show', () => {
    expect(bloatedSysBaseline(bs, 1_000_000)).toEqual({ show: true, systemTokens: 400_000 });
    expect(bloatedSysBaseline({ stage: 'normal', pct: 0.4 }, 1_000_000).show).toBe(false);
    expect(bloatedSysBaseline(bs, 0).show).toBe(false);
  });
  it('baseline: system_tokens 없으면 pct*window 환산', () => {
    const r = bloatedSysBaseline({ stage: 'critical', pct: 0.5 }, 200_000);
    expect(r.systemTokens).toBe(100_000);
  });
  it('split: sys/user % (pct 0~1 fraction)', () => {
    expect(bloatedSysSplit({ stage: 'warn', pct: 0.4 })).toEqual({ show: true, sys: 40, user: 60 });
    // 과거 별칭(0~100 정수)
    expect(bloatedSysSplit({ stage: 'critical', pct: 75 })).toEqual({ show: true, sys: 75, user: 25 });
    expect(bloatedSysSplit({ stage: 'normal', pct: 0.4 }).show).toBe(false);
  });
});

describe('fmtK / fmtDelta', () => {
  it('fmtK: >=1000 → NK, else 정수', () => {
    expect(fmtK(12000)).toBe('12.0K');
    expect(fmtK(999)).toBe('999');
  });
  it('fmtDelta: 부호 + K', () => {
    expect(fmtDelta(4000)).toBe('+4.0K');
    expect(fmtDelta(-500)).toBe('-500');
  });
});

describe('ContextChart / drawContextChartToCanvas — 가드', () => {
  it('canvas=null no-op', () => {
    expect(() => drawContextChartToCanvas(null, turns)).not.toThrow();
  });
  it('getContext null → no-op', () => {
    const fake = {
      getContext: () => null,
      getBoundingClientRect: () => ({ width: 100, height: 80 }),
      offsetWidth: 100,
      offsetHeight: 80,
      style: {},
      width: 0,
      height: 0,
    } as unknown as HTMLCanvasElement;
    expect(() => drawContextChartToCanvas(fake, turns)).not.toThrow();
  });
  it('빈 데이터 → 그리지 않음(no-op)', () => {
    const fake = { getContext: () => { throw new Error('should not call'); } } as unknown as HTMLCanvasElement;
    expect(() => drawContextChartToCanvas(fake, [])).not.toThrow();
  });
  it('SSR 렌더: #contextGrowthChart canvas 마크업(효과 미발화)', () => {
    const html = renderToStaticMarkup(<ContextChart turns={turns} />);
    expect(html).toContain('id="contextGrowthChart"');
    expect(html).toContain('<canvas');
  });
});
