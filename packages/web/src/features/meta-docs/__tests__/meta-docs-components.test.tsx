/**
 * meta-docs-components.test.tsx — 카탈로그/검색/필터/배지 마크업 계약 (P4-02)
 *
 * 원본 meta-docs-view.js renderHtml/rowHtml/thHtml/metaDocTypeBadge/renderFilters/searchHtml 의
 * 셀렉터 계약을 renderToStaticMarkup 으로 고정한다. 컨트롤드(props) — store 무참조 leaf.
 * window.I18n 스텁(MetaDocTypeBadge 가 toolIconHtml 경유 ToolIcon 사용, getCollator 의존 없음).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MetaDocsCatalog } from '../MetaDocsCatalog';
import { MetaDocTypeBadge } from '../MetaDocTypeBadge';
import { MetaDocsSearch } from '../MetaDocsSearch';
import { MetaDocsFilterBar } from '../MetaDocsFilterBar';
import type { MetaDocRow } from '../meta-docs-sort';

beforeAll(() => {
  (globalThis as { window?: { I18n?: unknown } }).window ??= {};
  (globalThis as { window: { I18n?: unknown } }).window.I18n = { t: (k: string) => k, getLang: () => 'en' };
});

// vars 보간하는 스텁 — 실제 window.I18n.t 처럼 {placeholder} 를 치환(empty-project 안내가 project 주입 검증).
const t = (key: string, vars?: Record<string, unknown>) => {
  let out = `t:${key}`;
  if (vars) for (const [k, v] of Object.entries(vars)) out += ` ${k}=${String(v)}`;
  return out;
};

const ROWS: MetaDocRow[] = [
  { id: 1, type: 'agent', name: 'designer', source: 'projectSettings', source_root: '/proj/a', file_path: '/proj/a/designer.md', invocations: 12, last_used_at: 1_700_000_000_000, total_tokens: 3400, description: 'desc here' },
  { id: 2, type: 'skill', name: 'committer', source: 'userSettings', source_root: null, invocations: 0, last_used_at: null, total_tokens: 0 },
  { id: null, type: 'skill', name: 'ghost', source: null, source_root: null, invocations: 3, last_used_at: 1_600_000_000_000, total_tokens: 10 },
];

// ── MetaDocTypeBadge ───────────────────────────────────────────────────────────
describe('MetaDocTypeBadge — 타입 칩 SSoT (view.js:811)', () => {
  it('agent → tool-chip-agent + Agent 아이콘 + AGENT 라벨', () => {
    const html = renderToStaticMarkup(<MetaDocTypeBadge type="agent" />);
    expect(html).toContain('tool-chip-agent');
    expect(html).toContain('meta-doc-type-agent');
    expect(html).toContain('AGENT');
    expect(html).toContain('tool-icon-agent'); // ToolIcon('Agent')
  });
  it('skill → tool-chip-skill + SKILL', () => {
    const html = renderToStaticMarkup(<MetaDocTypeBadge type="skill" />);
    expect(html).toContain('tool-chip-skill');
    expect(html).toContain('SKILL');
    expect(html).toContain('tool-icon-skill');
  });
  it('command → skill 색(금색 합류, view.js:815)', () => {
    const html = renderToStaticMarkup(<MetaDocTypeBadge type="command" />);
    expect(html).toContain('tool-chip-skill');
    expect(html).toContain('COMMAND');
  });
});

// ── MetaDocsCatalog ──────────────────────────────────────────────────────────────
describe('MetaDocsCatalog — 테이블 마크업 (view.js:682-704)', () => {
  it('빈 rows → state-empty (global)', () => {
    const html = renderToStaticMarkup(<MetaDocsCatalog rows={[]} t={t} />);
    expect(html).toContain('state-empty');
    expect(html).not.toContain('meta-docs-table');
  });
  it('빈 rows + project 미매칭 → empty-project 안내', () => {
    const html = renderToStaticMarkup(<MetaDocsCatalog rows={[]} project="myproj" matched={false} t={t} />);
    expect(html).toContain('state-empty');
    expect(html).toContain('myproj');
  });
  it('rows → meta-docs-table + 6 thead 컬럼', () => {
    const html = renderToStaticMarkup(<MetaDocsCatalog rows={ROWS} t={t} />);
    expect(html).toContain('meta-docs-table');
    expect((html.match(/data-meta-sort=/g) ?? []).length).toBe(6);
    expect(html).toContain('data-meta-sort="invocations"');
    expect(html).toContain('data-meta-sort="last_used_at"');
  });
  it('행 → meta-doc-row + data-type/data-name (view.js:786)', () => {
    const html = renderToStaticMarkup(<MetaDocsCatalog rows={ROWS} t={t} />);
    expect(html).toContain('data-name="designer"');
    expect(html).toContain('data-type="agent"');
  });
  it('orphan 행(id null) → meta-doc-orphan + 경로 라벨 (orphan 필터에서만 노출)', () => {
    // orphan 은 기본 all 목록에서 제외되므로 orphan 필터로 명시해야 노출된다.
    const html = renderToStaticMarkup(<MetaDocsCatalog rows={ROWS} display="orphan" t={t} />);
    expect(html).toContain('meta-doc-orphan');
    expect(html).toContain('meta-doc-source-orphan');
  });
  it('unused 행(inv 0, id!=null) → meta-doc-unused', () => {
    const html = renderToStaticMarkup(<MetaDocsCatalog rows={ROWS} t={t} />);
    expect(html).toContain('meta-doc-unused');
  });
  it('정렬 상태 prop → 해당 th aria-sort/sort-desc', () => {
    const html = renderToStaticMarkup(
      <MetaDocsCatalog rows={ROWS} sort={{ key: 'invocations', dir: 'desc' }} t={t} />,
    );
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('sort-desc');
  });
  it('정렬 적용 → 행 순서 (invocations desc: designer(12),committer(0); orphan ghost 는 all 에서 제외)', () => {
    const html = renderToStaticMarkup(
      <MetaDocsCatalog rows={ROWS} sort={{ key: 'invocations', dir: 'desc' }} t={t} />,
    );
    const order = [...html.matchAll(/data-name="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['designer', 'committer']);
  });
  it('display=unused 필터 → committer 만', () => {
    const html = renderToStaticMarkup(<MetaDocsCatalog rows={ROWS} display="unused" t={t} />);
    const order = [...html.matchAll(/data-name="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['committer']);
  });
  it('searchTerm 필터 → 비매칭 행 hidden 속성 (view.js:1019 동치)', () => {
    const html = renderToStaticMarkup(<MetaDocsCatalog rows={ROWS} searchTerm="design" t={t} />);
    // designer 만 visible — committer 는 hidden. ghost(orphan)는 all 에서 이미 제외되어 행 자체가 없음.
    expect(html).toContain('data-name="designer"');
    expect(html).toMatch(/data-name="committer"[^>]*hidden/);
    expect(html).not.toContain('data-name="ghost"');
  });
});

// ── MetaDocsSearch ──────────────────────────────────────────────────────────────
describe('MetaDocsSearch — 검색 입력 (view.js:890, P2-08 SearchBox 재사용)', () => {
  it('value prop 반영 + 검색 input 렌더', () => {
    const html = renderToStaticMarkup(<MetaDocsSearch value="abc" placeholder="search…" clearLabel="clear" onSearch={() => {}} />);
    expect(html).toContain('feed-search-input');
    expect(html).toContain('value="abc"');
  });
  it('빈 value → clear 버튼 미노출(visible 없음)', () => {
    const html = renderToStaticMarkup(<MetaDocsSearch value="" placeholder="" clearLabel="clear" onSearch={() => {}} />);
    expect(html).not.toMatch(/feed-search-clear[^"]*visible/);
  });
});

// ── MetaDocsFilterBar ────────────────────────────────────────────────────────────
describe('MetaDocsFilterBar — 타입/표시/includeDeleted (view.js:836-908)', () => {
  it('type/display 그룹 + 버튼 셀렉터 (data-meta-filter)', () => {
    const html = renderToStaticMarkup(
      <MetaDocsFilterBar type="all" display="all" includeDeleted={false} t={t} />,
    );
    expect(html).toContain('data-meta-filter="type"');
    expect(html).toContain('data-meta-filter="display"');
    expect(html).toContain('meta-doc-filter-btn');
  });
  it('active type → 해당 버튼 active + aria-pressed', () => {
    const html = renderToStaticMarkup(
      <MetaDocsFilterBar type="agent" display="all" includeDeleted={false} t={t} />,
    );
    // agent 버튼이 active
    expect(html).toMatch(/data-value="agent"[^>]*class="[^"]*active|class="[^"]*active[^"]*"[^>]*data-value="agent"/);
  });
  it('includeDeleted 토글 체크박스 (data-meta-include-deleted)', () => {
    const html = renderToStaticMarkup(
      <MetaDocsFilterBar type="all" display="all" includeDeleted t={t} />,
    );
    expect(html).toContain('data-meta-include-deleted');
    expect(html).toContain('checked');
  });
  it('showOrphan 기본값(미지정) → orphan 버튼 노출 (기존 동작 보존)', () => {
    const html = renderToStaticMarkup(
      <MetaDocsFilterBar type="all" display="all" includeDeleted={false} t={t} />,
    );
    expect(html).toContain('data-value="orphan"');
  });
  it('showOrphan=false → orphan 버튼 숨김 (0건 시 노이즈 제거)', () => {
    const html = renderToStaticMarkup(
      <MetaDocsFilterBar type="all" display="all" includeDeleted={false} showOrphan={false} t={t} />,
    );
    expect(html).not.toContain('data-value="orphan"');
    // all/unused 는 그대로 노출
    expect(html).toContain('data-value="unused"');
  });
});
