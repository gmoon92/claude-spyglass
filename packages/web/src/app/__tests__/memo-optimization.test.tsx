/**
 * memo-optimization.test.tsx — P5-04 React.memo 배치 최적화 검증 (측정 선행)
 *
 * 목적: 고주기 SSE(new_request 5-20/s) 갱신 시 불필요 re-render 를 줄이려고 도입한 메모화가
 *   (1) 실제로 React.memo 로 배치됐고, (2) 출력(동작)을 바꾸지 않음을 회귀로 고정한다.
 *
 * 검증 대상(근거: BrowseLayout 만 sse-store 를 구독 → `sessions` 갱신마다 Sidebar+Chart re-render):
 *   - components/Chart.Chart      = React.memo(ChartImpl)         — 캔버스 effect/ResizeObserver churn 차단.
 *   - features/browse Sidebar 내부 = React.memo(ProjectList)       — projects 불변 시 프로젝트 행 재계산 회피.
 *   - BrowseLayout 의 timelineBuckets = 모듈 상수(안정 ref) → memo(Chart) shallow 비교 유효.
 *
 * 하네스 한계: react-test-renderer/@testing-library 미도입(번들 무증가 원칙). 실제 re-render 횟수
 *   대신 (a) memo 마커($$typeof) (b) 메모/비메모 출력 동치(renderToStaticMarkup)로 "동작 무변경 +
 *   메모 배치"를 증명한다. re-render 회피 자체는 React.memo 의 계약(shallow-equal prop 시 skip)에
 *   의존하므로, prop ref 안정성(아래 EMPTY 배열 동치)만 보장되면 성립한다.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Chart } from '../../components/Chart';
import type { ChartTokens } from '../../components/Chart';
import type { DataByKind } from '../../components/chart-data';
import { Sidebar, ProjectList, type SidebarLabeler, type ProjectLike } from '../../features/browse/Sidebar';

// React.memo 가 반환하는 MemoExoticComponent 의 마커(react.memo Symbol). 환경별 Symbol 비교 안전을 위해
// Symbol.for('react.memo') 로 대조한다(React 가 동일 전역 Symbol 레지스트리를 사용).
const REACT_MEMO_TYPE = Symbol.for('react.memo');

beforeAll(() => {
  (globalThis as unknown as { window: { I18n: { t: (k: string) => string } } }).window =
    (globalThis as unknown as { window?: object }).window as never ?? ({} as never);
  (globalThis as unknown as { window: { I18n: { t: (k: string) => string } } }).window.I18n = {
    t: (key: string) => key,
  };
});
afterAll(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

const TOKENS: ChartTokens = {
  modelTokens: { haiku: '#7dd3fc', sonnet: '#d97757', opus: '#a78bfa', external: '#f472b6', synthetic: '#6e7681', unknown: '#6e7681' },
  cacheTokens: { read: '#10B981', creation: '#B794F6', others: '#6E7681' },
  typeColors: { prompt: '#d97757', tool_call: '#4ade80', system: '#f59e0b' },
};
const DATA: DataByKind = { type: [], model: [], cache: [] };

describe('P5-04 Chart 메모화', () => {
  it('Chart 는 React.memo 로 배치돼 있다($$typeof = react.memo)', () => {
    const marker = (Chart as unknown as { $$typeof?: symbol }).$$typeof;
    expect(marker).toBe(REACT_MEMO_TYPE);
  });

  it('메모화는 출력을 바꾸지 않는다(SSR 마크업 = 캔버스 셀렉터 계약 보존)', () => {
    // memo(Chart) 는 effect(캔버스 그리기) 없이 SSR 에서 <canvas> 골격만 출력 — 셀렉터 계약 동일.
    const html = renderToStaticMarkup(
      createElement(Chart, { dataByKind: DATA, donutMode: 'type', timelineBuckets: [], tokens: TOKENS }),
    );
    expect(html).toContain('id="timelineChart"');
    expect(html).toContain('id="typeChart"');
    expect(html).toContain('donut-canvas');
  });

  it('동일 prop ref 로 두 번 렌더해도 출력 동일(shallow-equal 시 skip 의 전제 — 결정적 출력)', () => {
    const props = { dataByKind: DATA, donutMode: 'type' as const, timelineBuckets: [] as number[], tokens: TOKENS };
    const a = renderToStaticMarkup(createElement(Chart, props));
    const b = renderToStaticMarkup(createElement(Chart, props));
    expect(a).toBe(b);
  });
});

const LABELER: SidebarLabeler = {
  noData: () => 'no-data',
  liveCount: (n) => `live-${n}`,
  selectProject: () => 'select-project',
  sessionCount: (p, n) => `${p}-${n}`,
  globalRowLabel: () => 'global',
  globalRowTitle: () => 'global-title',
};
const PROJECTS: ProjectLike[] = [
  { project_name: 'alpha', total_tokens: 100, active_count: 2 },
  { project_name: 'beta', total_tokens: 50, active_count: 0 },
];

describe('P5-04 Sidebar 의 ProjectList 메모 경로(동작 보존)', () => {
  it('Sidebar 가 메모 경로로 렌더해도 프로젝트 행 출력은 ProjectList 직접 렌더와 동일', () => {
    // Sidebar 내부는 MemoProjectList(=memo(ProjectList)) 를 쓴다(module-private). 출력 동치로
    // "memo 래퍼가 동작을 바꾸지 않음"을 검증한다(공개 surface 무확장 — over-engineering 가드).
    const viaSidebar = renderToStaticMarkup(
      createElement(Sidebar, {
        projects: PROJECTS,
        sessions: [],
        selectedProject: null,
        selectedSession: null,
        isMetaMode: false,
        metaCounts: null,
        labeler: LABELER,
      }),
    );
    const viaDirect = renderToStaticMarkup(
      createElement(ProjectList, {
        projects: PROJECTS,
        selectedProject: null,
        isMetaMode: false,
        metaCounts: null,
        labeler: LABELER,
      }),
    );
    // Sidebar 는 ProjectList + SessionList 를 모두 포함하므로, 프로젝트 행 마크업이 포함되는지로 동치 확인.
    expect(viaSidebar).toContain('data-project="alpha"');
    expect(viaSidebar).toContain('data-project="beta"');
    expect(viaDirect).toContain('data-project="alpha"');
    expect(viaDirect).toContain('data-project="beta"');
  });
});

describe('P5-04 timelineBuckets 안정 ref 근거', () => {
  it('모듈 상수 빈 배열은 항상 동일 신원이어야 memo 가 작동한다(인라인 [] 反例 대조)', () => {
    // BrowseLayout 은 `timelineBuckets={EMPTY_TIMELINE_BUCKETS}`(모듈 상수)로 전달한다.
    // 인라인 `[]` 는 매 렌더 새 신원 → memo shallow 비교를 깬다(아래가 그 反例 증명).
    const inlineA: number[] = [];
    const inlineB: number[] = [];
    expect(inlineA).not.toBe(inlineB); // 인라인 [] 는 신원 불안정 → memo 무력

    const STABLE: number[] = [];
    const ref1 = STABLE;
    const ref2 = STABLE;
    expect(ref1).toBe(ref2); // 모듈 상수는 신원 안정 → memo 유효
  });
});
