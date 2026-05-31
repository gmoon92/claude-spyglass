/**
 * Chart.test.tsx — Chart 컴포넌트 계약(DOM 셀렉터/ref/props 주입) 검증 (P3-01)
 *
 * 원본: assets/js/chart.js drawTimeline/drawDonut(canvas getElementById 직접 조회).
 *  - canvas id 셀렉터 계약(arch §2.2): #timelineChart, #typeChart, class="donut-canvas".
 *  - 캔버스 명령형 그리기(ctx.arc/scale/...)는 bun:test(canvas 미구현)에서 단위 불가 →
 *    본 파일은 SSR 마크업(셀렉터/구조) + props 주입 계약만 고정. ctx 호출은 수동 verify(Gap).
 *
 * 전략(search-box.test.tsx 계승): renderToStaticMarkup 으로 마크업 검증.
 *  useLayoutEffect 의 canvas 그리기는 SSR 에서 실행되지 않으므로(React 효과 미발화) throw 없이 통과.
 */
import { describe, it, expect } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { Chart } from '../Chart';
import type { DataByKind } from '../chart-data';
import {
  drawDonutToCanvas,
  drawTimelineToCanvas,
} from '../Chart';

const MODEL_TOKENS = { haiku: '#7dd3fc', sonnet: '#d97757', opus: '#a78bfa', external: '#f472b6', synthetic: '#6e7681', unknown: '#6e7681' };
const CACHE_TOKENS = { read: '#10B981', creation: '#B794F6', others: '#6E7681' };
const TYPE_COLORS = { prompt: '#d97757', tool_call: '#4ade80', system: '#f59e0b' };

const EMPTY_DATA: DataByKind = { type: [], model: [], cache: [] };
const TOKENS = { modelTokens: MODEL_TOKENS, cacheTokens: CACHE_TOKENS, typeColors: TYPE_COLORS };

function render(props: Parameters<typeof Chart>[0]): string {
  return renderToStaticMarkup(createElement(Chart, props));
}

describe('Chart — 캔버스 셀렉터 계약(arch §2.2 보존)', () => {
  it('타임라인/도넛 canvas id·class 마크업 렌더', () => {
    const html = render({ dataByKind: EMPTY_DATA, donutMode: 'model', timelineBuckets: [0, 1, 2], tokens: TOKENS });
    expect(html).toContain('id="timelineChart"');
    expect(html).toContain('id="typeChart"');
    expect(html).toContain('donut-canvas');
  });

  it('SSR(효과 미발화)에서 throw 없이 렌더 — getContext 미호출 안전', () => {
    expect(() =>
      render({ dataByKind: EMPTY_DATA, donutMode: 'cache', timelineBuckets: [], tokens: TOKENS }),
    ).not.toThrow();
  });

  it('canvas 요소는 <canvas> 태그로 출력(ref 부착 대상)', () => {
    const html = render({ dataByKind: EMPTY_DATA, donutMode: 'type', timelineBuckets: [1], tokens: TOKENS });
    expect(html).toContain('<canvas');
  });
});

describe('Chart — props 주입 계약(setSourceData 외부주입 → props)', () => {
  it('dataByKind/donutMode/timelineBuckets prop 을 받아도 throw 없음(데이터 주입 경로)', () => {
    const data: DataByKind = {
      type: [{ type: 'prompt', count: 3 }],
      model: [{ model: 'claude-opus-4-7', request_count: 5 }],
      cache: [{ id: 'creation', tokens: 100, _cacheCreation: 100 }, { id: 'others', tokens: 900 }],
    };
    expect(() => render({ dataByKind: data, donutMode: 'model', timelineBuckets: [0, 2, 4], tokens: TOKENS })).not.toThrow();
    expect(() => render({ dataByKind: data, donutMode: 'cache', timelineBuckets: [0, 2, 4], tokens: TOKENS })).not.toThrow();
  });
});

// ── 명령형 그리기 함수(drawXToCanvas) — null ctx 가드(canvas 미구현/SSR 안전) ──────
describe('drawDonutToCanvas / drawTimelineToCanvas — null 가드(canvas 없음 환경)', () => {
  it('canvas=null 이면 no-op(throw 없음)', () => {
    expect(() => drawDonutToCanvas(null, EMPTY_DATA, 'model', TOKENS)).not.toThrow();
    expect(() => drawTimelineToCanvas(null, [0, 1, 2], { now: 1_700_000_000_000, locale: 'en-US' })).not.toThrow();
  });

  it('getContext 가 null 반환 시 no-op(throw 없음)', () => {
    // bun 환경 stub: getContext → null, parentElement.clientWidth 제공.
    const fakeCanvas = {
      getContext: () => null,
      parentElement: { clientWidth: 300 },
      style: {},
      width: 0,
      height: 0,
    } as unknown as HTMLCanvasElement;
    expect(() => drawDonutToCanvas(fakeCanvas, EMPTY_DATA, 'model', TOKENS)).not.toThrow();
    expect(() => drawTimelineToCanvas(fakeCanvas, [0, 1, 2], { now: 1_700_000_000_000, locale: 'en-US' })).not.toThrow();
  });
});
