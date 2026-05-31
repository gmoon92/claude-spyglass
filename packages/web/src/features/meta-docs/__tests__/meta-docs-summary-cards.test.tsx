/**
 * meta-docs-summary-cards.test.tsx — MetaDocsSummaryCards 좌측 요약 카드 + behavior mini-bar (vanilla→React 배선)
 *
 * 원본: meta-docs-view.js renderLeftSummaryCards(:399) + computeRowCounts(:430).
 *   - 카드 3개(사용/미사용/orphan) 카운트 SSoT(computeRowCounts) + display 필터 클릭 전이.
 *   - behavior mini-bar(type별 invocations 합) — ds-bar SSoT 재사용.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { MetaDocsSummaryCards } from '../MetaDocsSummaryCards';
import type { MetaDocRow, DisplayFilter } from '../meta-docs-sort';

beforeAll(() => {
  (globalThis as { window?: { I18n?: unknown } }).window ??= {};
  (globalThis as { window: { I18n?: unknown } }).window.I18n = { t: (k: string) => k };
});

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
    const html = renderToStaticMarkup(createElement(MetaDocsSummaryCards, { rows: ROWS, onSelectDisplay: noop }));
    // used = invocations>0 → 3, unused = id!=null && inv==0 → 1, orphan = id==null → 1
    expect(html).toContain('meta-docs-summary-card--used');
    expect(html).toContain('meta-docs-summary-card--unused');
    expect(html).toContain('meta-docs-summary-card--orphan');
    expect(html).toContain('>3<'); // used value
  });
  it('카드 display 필터 계약 보존(data-meta-filter/data-value)', () => {
    const html = renderToStaticMarkup(createElement(MetaDocsSummaryCards, { rows: ROWS, onSelectDisplay: noop }));
    expect(html).toContain('data-meta-filter="display"');
    expect(html).toContain('data-value="unused"');
    expect(html).toContain('data-value="orphan"');
  });
  it('behavior mini-bar — type별 invocations 합 + ds-bar SSoT', () => {
    const html = renderToStaticMarkup(createElement(MetaDocsSummaryCards, { rows: ROWS, onSelectDisplay: noop }));
    expect(html).toContain('meta-docs-summary-bars');
    expect(html).toContain('ds-bar-track'); // Bar 컴포넌트 재사용
    expect(html).toContain('ds-bar-fill');
    // 그룹 라벨 노출(agent/skill/command)
    expect(html).toContain('agent');
    expect(html).toContain('command');
  });
  it('빈 rows → mini-bar 미렌더(카드만)', () => {
    const html = renderToStaticMarkup(createElement(MetaDocsSummaryCards, { rows: [], onSelectDisplay: noop }));
    expect(html).toContain('meta-docs-summary-cards');
    expect(html).not.toContain('meta-docs-summary-bars');
  });
});
