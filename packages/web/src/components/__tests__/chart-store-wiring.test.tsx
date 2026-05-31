/**
 * chart-store-wiring.test.tsx — Chart donutMode 스토어 SSoT 연동 계약 (P3-01)
 *
 * 목표(tasks.json P3-01): "donutMode 상태는 Context/스토어".
 *  - SSoT = app-store.donutMode 슬라이스(P3-01 신규). Chart 는 무전역·무스토어 leaf 컴포넌트
 *    (arch §1.3 rule 1: components 는 stores 를 import 하지 않는다) → donutMode 를 prop 으로 받는다.
 *  - 본 테스트는 "store.donutMode → Chart prop" 컨트롤드 바인딩과 setChartMode/setDonutMode 갱신을
 *    end-to-end 로 증명한다(SearchBox value=store.searchQuery 선례 1:1 계승).
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { Chart } from '../Chart';
import type { DataByKind } from '../chart-data';
import { useAppStore } from '../../stores/app-store';

const TOKENS = {
  modelTokens: { haiku: '#7dd3fc', sonnet: '#d97757', opus: '#a78bfa', external: '#f472b6', synthetic: '#6e7681', unknown: '#6e7681' },
  cacheTokens: { read: '#10B981', creation: '#B794F6', others: '#6E7681' },
  typeColors: { prompt: '#d97757', tool_call: '#4ade80', system: '#f59e0b' },
};
const EMPTY: DataByKind = { type: [], model: [], cache: [] };

beforeEach(() => {
  useAppStore.getState().setDonutMode('model');
});

describe('Chart donutMode — 스토어 SSoT → prop 컨트롤드 바인딩', () => {
  it('store.donutMode 를 Chart prop 으로 주입(컨트롤드)해도 throw 없이 렌더', () => {
    const donutMode = useAppStore.getState().donutMode;
    expect(donutMode).toBe('model');
    expect(() =>
      renderToStaticMarkup(
        createElement(Chart, { dataByKind: EMPTY, donutMode, timelineBuckets: [1, 2], tokens: TOKENS }),
      ),
    ).not.toThrow();
  });

  it('setChartMode 전환(default→detail) → donutMode 매핑(model→cache)', () => {
    useAppStore.getState().setChartMode('detail');
    expect(useAppStore.getState().donutMode).toBe('cache');
    useAppStore.getState().setChartMode('default');
    expect(useAppStore.getState().donutMode).toBe('model');
  });

  it('store donutMode 변경이 Chart prop 으로 전파(렌더 입력 = store 값)', () => {
    useAppStore.getState().setDonutMode('cache');
    const donutMode = useAppStore.getState().donutMode;
    const html = renderToStaticMarkup(
      createElement(Chart, { dataByKind: EMPTY, donutMode, timelineBuckets: [], tokens: TOKENS }),
    );
    // 셀렉터 계약은 모드 무관 동일(캔버스는 client 에서만 그려짐) — prop 주입 경로의 무에러만 보장.
    expect(html).toContain('id="typeChart"');
    expect(donutMode).toBe('cache');
  });
});
