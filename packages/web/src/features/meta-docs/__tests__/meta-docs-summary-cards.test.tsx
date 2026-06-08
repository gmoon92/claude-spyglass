/**
 * meta-docs-summary-cards.test.tsx — MetaDocsSummaryCards 좌측 요약 카드 + behavior mini-bar (vanilla→React 배선)
 *
 * 원본: meta-docs-view.js renderLeftSummaryCards(:399) + computeRowCounts(:430).
 *   - 카드 3개(사용/미사용/orphan) 카운트 SSoT(computeRowCounts) + display 필터 클릭 전이.
 *   - behavior 랭킹 mini-bar(문서별 invocations Top N) — 과거 type 고정 합산 폐기, 실제 문서 랭킹으로 전환.
 *     마크업(obs-cat-bar/obs-meta-row + ds-bar-fill[data-tone]) SSoT 재사용 + 선행 ToolIcon(서클/눈알) + 문서명.
 *     신규 클래스(meta-docs-summary-bars)는 CSS 부재로 평문 세로 나열 회귀를 유발했어서 폐기됨.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { MetaDocsSummaryCards, MetaDocsBehaviorBars } from '../MetaDocsSummaryCards';
import type { MetaDocRow, DisplayFilter } from '../meta-docs-sort';

// i18n t 는 컴포넌트가 useTranslation 으로 자체 구독한다(prop 폐기). 테스트는 vitest.setup
//   기본 passthrough(키 그대로 반환)에 의존 — 본 단언은 셀렉터/카운트 기반이라 라벨 무관.

const ROWS: MetaDocRow[] = [
  { id: 1, type: 'skill', name: 'commit', invocations: 5 }, // registered + used
  { id: 2, type: 'skill', name: 'idle', invocations: 0 }, // registered + unused
  { id: null, type: 'agent', name: 'Explore', invocations: 15 }, // orphan(미등록) + used → 랭킹 제외
  { id: 3, type: 'command', name: 'cmd', invocations: 2 }, // registered + used
  { id: 4, type: 'agent', name: 'reviewer', invocations: 9 }, // registered agent + used(agent 아이콘 유지)
];

const noop = (_: DisplayFilter): void => {
  /* test sink */
};

describe('MetaDocsSummaryCards — 좌측 요약 카드 (원본 renderLeftSummaryCards)', () => {
  it('used/unused/orphan 카운트 렌더(computeRowCounts SSoT)', () => {
    const html = renderToStaticMarkup(createElement(MetaDocsSummaryCards, { rows: ROWS, onSelectDisplay: noop }));
    // used = invocations>0 → 4(commit,Explore,cmd,reviewer), unused = id!=null && inv==0 → 1(idle), orphan = id==null → 1(Explore)
    expect(html).toContain('meta-docs-summary-card--used');
    expect(html).toContain('meta-docs-summary-card--unused');
    expect(html).toContain('meta-docs-summary-card--orphan');
    expect(html).toContain('>4<'); // used value(카운트는 orphan 포함 — 랭킹만 orphan 제외)
  });
  it('카드 display 필터 계약 보존(data-meta-filter/data-value)', () => {
    const html = renderToStaticMarkup(createElement(MetaDocsSummaryCards, { rows: ROWS, onSelectDisplay: noop }));
    expect(html).toContain('data-meta-filter="display"');
    expect(html).toContain('data-value="unused"');
    expect(html).toContain('data-value="orphan"');
  });
  it('요약 카드 컨테이너는 카드만 직계로 — mini-bar 는 분리됨(레거시 #metaDocsToolStats 별도 트랙)', () => {
    // 레거시 #metaDocsSummaryCards{flex-direction:row}+ .card{flex:1 1 0} 가 3카드를 가로 균등 분배하려면
    // 카드가 직계 자식이어야 하고, mini-bar 는 별 트랙(#metaDocsToolStats)에 있어야 함. 카드 컨테이너에 bar 부재 가드.
    const html = renderToStaticMarkup(createElement(MetaDocsSummaryCards, { rows: ROWS, onSelectDisplay: noop }));
    expect(html).toContain('id="metaDocsSummaryCards"');
    expect(html).not.toContain('obs-meta-row');
    // 중간 wrapper 제거 회귀 가드(flex 분배 깨짐 방지).
    expect(html).not.toContain('meta-docs-summary-cards-row');
  });
});

describe('MetaDocsBehaviorBars — behavior mini-bar (원본 #metaDocsToolStats / renderToolCategoriesCard 모드 B)', () => {
  it('마크업 SSoT(obs-cat-bar/obs-meta-row/ds-bar-fill) 1:1 + 별도 컨테이너 유지', () => {
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
    // 랭킹 계약: type 고정 라벨이 아닌 "top behaviors by invocations" 로 전환.
    expect(html).toContain('aria-label="top behaviors by invocations"');
  });
  it('문서별 invocations 랭킹(desc) — 등록 문서명 + 호출수 노출, unused(0건) 제외', () => {
    const html = renderToStaticMarkup(createElement(MetaDocsBehaviorBars, { rows: ROWS }));
    // 실제 문서명 노출(고정 type 라벨 폐기).
    expect(html).toContain('>reviewer<'); // agent, 9
    expect(html).toContain('>commit<'); // skill, 5
    expect(html).toContain('>cmd<'); // command, 2
    // 호출수(invocations) 노출.
    expect(html).toContain('>9<');
    expect(html).toContain('>5<');
    expect(html).toContain('>2<');
    // invocations===0 문서(idle)는 랭킹에서 제외.
    expect(html).not.toContain('>idle<');
    // 정렬: reviewer(9) → commit(5) → cmd(2) 순(첫 행이 최다 호출).
    expect(html.indexOf('reviewer')).toBeLessThan(html.indexOf('commit'));
    expect(html.indexOf('commit')).toBeLessThan(html.indexOf('cmd'));
  });

  it('미등록(orphan, id==null) 호출은 호출수가 최다여도 랭킹에서 제외', () => {
    const html = renderToStaticMarkup(createElement(MetaDocsBehaviorBars, { rows: ROWS }));
    // Explore 는 orphan(id:null) + 최다 호출(15)이지만 카탈로그 미등록이라 랭킹/막대에 노출되지 않는다.
    expect(html).not.toContain('>Explore<');
    expect(html).not.toContain('>15<');
    // 등록 문서만 남으므로 reviewer(9)가 최상위.
    expect(html.indexOf('reviewer')).toBeGreaterThan(-1);
    expect(html.indexOf('reviewer')).toBeLessThan(html.indexOf('commit'));
  });
  it('각 행 선행에 카탈로그와 동일한 서클(눈알) ToolIcon — agent=bullseye / skill·command=fish-eye', () => {
    const html = renderToStaticMarkup(createElement(MetaDocsBehaviorBars, { rows: ROWS }));
    // metaDocIconName SSoT 경유 ToolIcon — agent → tool-icon-agent, skill·command → tool-icon-skill.
    expect(html).toContain('tool-icon-agent'); // reviewer(등록 agent — orphan Explore 제외 후에도 agent 아이콘 유지)
    expect(html).toContain('tool-icon-skill'); // commit(skill) + cmd(command 은 Skill 합류)
  });
  it('topN 상한 — invocations desc 상위 N 만 노출', () => {
    const many: MetaDocRow[] = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      type: 'skill',
      name: `doc-${String(i).padStart(2, '0')}`,
      invocations: i + 1,
    }));
    const html = renderToStaticMarkup(createElement(MetaDocsBehaviorBars, { rows: many, topN: 3 }));
    const rowCount = (html.match(/obs-meta-row/g) ?? []).length;
    expect(rowCount).toBe(3);
    // 최다 호출(doc-11=12) 포함, 하위(doc-00=1) 제외.
    expect(html).toContain('doc-11');
    expect(html).not.toContain('doc-00');
  });
  it('빈 rows / 사용 문서 0건 → null(미렌더 — grid 트랙 0px)', () => {
    expect(renderToStaticMarkup(createElement(MetaDocsBehaviorBars, { rows: [] }))).toBe('');
    // 모두 invocations 0 → 랭킹 비어 미렌더.
    const allUnused: MetaDocRow[] = [{ id: 1, type: 'skill', name: 'idle', invocations: 0 }];
    expect(renderToStaticMarkup(createElement(MetaDocsBehaviorBars, { rows: allUnused }))).toBe('');
  });
});
