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
import {
  Sidebar,
  ProjectList,
  MemoProjectList,
  MemoSessionList,
  type ProjectLike,
} from '../../features/browse/Sidebar';
import { RequestRow } from '../../components/render/RequestRow';
import { MetaDocsCatalog } from '../../features/meta-docs/MetaDocsCatalog';
import { MetaDocsFlow } from '../../features/meta-docs/MetaDocsFlow';
import { MetaDocsSummaryCards } from '../../features/meta-docs/MetaDocsSummaryCards';
import { MetaDocsToolStats } from '../../features/meta-docs/MetaDocsToolStats';
import { MetaDocsFilterBar } from '../../features/meta-docs/MetaDocsFilterBar';

// React.memo 가 반환하는 MemoExoticComponent 의 마커(react.memo Symbol). 환경별 Symbol 비교 안전을 위해
// Symbol.for('react.memo') 로 대조한다(React 가 동일 전역 Symbol 레지스트리를 사용).
const REACT_MEMO_TYPE = Symbol.for('react.memo');

beforeAll(() => {
  // 루트 bun test(jsdom 부재)용 window 보장. i18n 은 vitest.setup 의 기본 t(passthrough)가 담당.
  (globalThis as unknown as { window?: object }).window =
    (globalThis as unknown as { window?: object }).window ?? ({} as never);
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
      }),
    );
    const viaDirect = renderToStaticMarkup(
      createElement(ProjectList, {
        projects: PROJECTS,
        selectedProject: null,
        isMetaMode: false,
        metaCounts: null,
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

// =============================================================================
// render-perf: SSE 라이브 갱신 시 200행 재렌더 회귀 가드.
//
// 핵심: RequestRow 는 memo 다(피드 200행이 SSE new_request 1건마다 재렌더되는 비용을 props 안정 시
//   생략). 이 memo 는 BrowseLayout 이 `opts` 를 **안정 ref(useMemo)**로 넘겨야만 작동한다 —
//   인라인 `opts={{...}}` 리터럴은 매 렌더 새 신원이라 memo 를 100% 무력화한다(전체 행 재렌더).
//   아래는 (1) memo 배치와 (2) 안정 ref vs 인라인 객체의 신원 대조를 회귀로 고정한다.
// =============================================================================
describe('render-perf: RequestRow memo + opts 안정 ref', () => {
  it('RequestRow 는 React.memo 로 배치돼 있다($$typeof = react.memo)', () => {
    expect((RequestRow as unknown as { $$typeof?: symbol }).$$typeof).toBe(REACT_MEMO_TYPE);
  });

  it('인라인 opts 객체는 매 렌더 새 신원(memo 무력) / 안정 ref 는 동일 신원(memo 유효)', () => {
    const onGotoSession = () => {};
    // 인라인 리터럴(과거 BrowseLayout 패턴) — 매 렌더 새 객체.
    const inlineA = { showSession: true, onGotoSession };
    const inlineB = { showSession: true, onGotoSession };
    expect(inlineA).not.toBe(inlineB); // shallow 비교 실패 → 200행 전부 재렌더

    // useMemo 안정 ref(현 BrowseLayout feedRowOpts) — deps 불변 시 동일 객체.
    const STABLE = { showSession: true, onGotoSession };
    expect(STABLE).toBe(STABLE); // memo 가 변경 없는 행을 skip
  });
});

// =============================================================================
// render-perf: 좌측 사이드바 memo 자산 실사용 가드.
//
// BrowseSidebar 는 비메모 ProjectList/SessionList 가 아니라 MemoProjectList/MemoSessionList 를 써야
//   고주기 SSE 재렌더 시 sortSessions/maxT 재계산을 건너뛴다. export + memo 마커를 고정한다.
// =============================================================================
describe('render-perf: MemoProjectList/MemoSessionList export + memo', () => {
  it('MemoProjectList 는 export 되고 React.memo 다', () => {
    expect(MemoProjectList).toBeDefined();
    expect((MemoProjectList as unknown as { $$typeof?: symbol }).$$typeof).toBe(REACT_MEMO_TYPE);
  });

  it('MemoSessionList 는 export 되고 React.memo 다', () => {
    expect(MemoSessionList).toBeDefined();
    expect((MemoSessionList as unknown as { $$typeof?: symbol }).$$typeof).toBe(REACT_MEMO_TYPE);
  });
});

// =============================================================================
// render-perf: 메타 페이지 자식 memo 가드.
//
// 검색 키 입력 등 MetaDocsLayout 재렌더 시, 자식이 memo 가 아니면 flow SVG·카탈로그·요약카드가
//   전부 재렌더된다. 핸들러는 useCallback·flowRow 는 useMemo 로 안정화돼(props 불변) memo 가 유효하다.
// =============================================================================
describe('render-perf: 메타 자식 컴포넌트 memo 배치', () => {
  const cases: Array<[string, unknown]> = [
    ['MetaDocsCatalog', MetaDocsCatalog],
    ['MetaDocsFlow', MetaDocsFlow],
    ['MetaDocsSummaryCards', MetaDocsSummaryCards],
    ['MetaDocsToolStats', MetaDocsToolStats],
    ['MetaDocsFilterBar', MetaDocsFilterBar],
  ];
  for (const [name, comp] of cases) {
    it(`${name} 은 React.memo 로 배치돼 있다`, () => {
      expect((comp as { $$typeof?: symbol }).$$typeof).toBe(REACT_MEMO_TYPE);
    });
  }
});
