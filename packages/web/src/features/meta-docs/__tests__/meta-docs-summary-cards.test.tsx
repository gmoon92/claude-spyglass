/**
 * meta-docs-summary-cards.test.tsx — MetaDocsSummaryCards 좌측 요약 카드 + behavior mini-bar (vanilla→React 배선)
 *
 * 원본: meta-docs-view.js renderLeftSummaryCards(:399) + computeRowCounts(:430).
 *   - 카드 3개(사용/미사용/orphan) 카운트 SSoT(computeRowCounts) + display 필터 클릭 전이.
 *   - behavior mini-bar(type별 invocations 합) — obs-panel.js#renderToolCategoriesCard 모드 B 마크업
 *     (obs-cat-bar/obs-meta-row + ds-bar-fill[data-tone]) 재사용. 신규 클래스(meta-docs-summary-bars)는
 *     CSS 부재로 평문 세로 나열 회귀를 유발했어서 폐기됨.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { MetaDocsSummaryCards, MetaDocsBehaviorBars } from '../MetaDocsSummaryCards';
import type { MetaDocRow, DisplayFilter } from '../meta-docs-sort';

// i18n t 는 DI(필수 prop) — 키 passthrough stub. D-1: 전역 window.I18n 비의존.
const t = (k: string) => k;

const ROWS: MetaDocRow[] = [
  { id: 1, type: 'skill', name: 'commit', invocations: 5 }, // used
  { id: 2, type: 'skill', name: 'idle', invocations: 0 }, // unused
  { id: null, type: 'agent', name: 'Explore', invocations: 15 }, // orphan + used
  { id: 3, type: 'command', name: 'cmd', invocations: 2 }, // used
];

const noop = (_: DisplayFilter): void => {
  /* test sink */
};

describe('MetaDocsSummaryCards — 좌측 요약 카드 (원본 renderLeftSummaryCards)', () => {
  it('used/unused/orphan 카운트 렌더(computeRowCounts SSoT)', () => {
    const html = renderToStaticMarkup(createElement(MetaDocsSummaryCards, { rows: ROWS, onSelectDisplay: noop, t }));
    // used = invocations>0 → 3, unused = id!=null && inv==0 → 1, orphan = id==null → 1
    expect(html).toContain('meta-docs-summary-card--used');
    expect(html).toContain('meta-docs-summary-card--unused');
    expect(html).toContain('meta-docs-summary-card--orphan');
    expect(html).toContain('>3<'); // used value
  });
  it('카드 display 필터 계약 보존(data-meta-filter/data-value)', () => {
    const html = renderToStaticMarkup(createElement(MetaDocsSummaryCards, { rows: ROWS, onSelectDisplay: noop, t }));
    expect(html).toContain('data-meta-filter="display"');
    expect(html).toContain('data-value="unused"');
    expect(html).toContain('data-value="orphan"');
  });
  it('요약 카드 컨테이너는 카드만 직계로 — mini-bar 는 분리됨(레거시 #metaDocsToolStats 별도 트랙)', () => {
    // 레거시 #metaDocsSummaryCards{flex-direction:row}+ .card{flex:1 1 0} 가 3카드를 가로 균등 분배하려면
    // 카드가 직계 자식이어야 하고, mini-bar 는 별 트랙(#metaDocsToolStats)에 있어야 함. 카드 컨테이너에 bar 부재 가드.
    const html = renderToStaticMarkup(createElement(MetaDocsSummaryCards, { rows: ROWS, onSelectDisplay: noop, t }));
    expect(html).toContain('id="metaDocsSummaryCards"');
    expect(html).not.toContain('obs-meta-row');
    // 중간 wrapper 제거 회귀 가드(flex 분배 깨짐 방지).
    expect(html).not.toContain('meta-docs-summary-cards-row');
  });
});

describe('MetaDocsBehaviorBars — behavior mini-bar (원본 #metaDocsToolStats / renderToolCategoriesCard 모드 B)', () => {
  it('obs-panel.js#renderToolCategoriesCard 모드 B 마크업(obs-cat-bar/obs-meta-row) 1:1 + 별도 컨테이너', () => {
    const html = renderToStaticMarkup(createElement(MetaDocsBehaviorBars, { rows: ROWS }));
    // 레거시 좌측 툴스탯 컨테이너(#metaDocsToolStats > .obs-panel) — grid row4 트랙.
    expect(html).toContain('id="metaDocsToolStats"');
    expect(html).toContain('meta-docs-tool-stats');
    expect(html).toContain('obs-panel');
    // 컨테이너 + 행 — obs-panel.css 가 grid 스타일을 가진 SSoT 클래스.
    expect(html).toContain('obs-card-tools obs-card-meta-docs');
    expect(html).toContain('obs-meta-row');
    expect(html).toContain('obs-meta-name');
    // fill 이중 클래스 + design-system tone(ds-bar-fill[data-tone=warn]) — bar.css SSoT.
    expect(html).toContain('obs-cat-bar-fill obs-cat-bar-fill--agent ds-bar-fill');
    expect(html).toContain('data-tone="warn"');
    expect(html).toContain('obs-cat-pct');
    // 신규(미정의) 클래스로의 회귀 방지 가드.
    expect(html).not.toContain('meta-docs-summary-bars');
    // 그룹 라벨 노출(agent/skill/command)
    expect(html).toContain('agent');
    expect(html).toContain('command');
  });
  it('빈 rows → null(미렌더 — grid 트랙 0px)', () => {
    const html = renderToStaticMarkup(createElement(MetaDocsBehaviorBars, { rows: [] }));
    expect(html).toBe('');
  });
});
