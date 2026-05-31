/**
 * meta-docs-tool-stats.test.tsx — MetaDocsToolStats(P3-09 패널 위임) (P4-03)
 *
 * arch §2.2: P4-03 은 tool-stats 컴포넌트를 재구현하지 않고 P3-09 ToolStatsMatrix 를 mount/표시만.
 * 셸이 docs/tools 탭 분기로 mount(view.js:316 loadProjectToolStats). 본 테스트는 위임 계약 + 탭 가시성.
 * 셀렉터 계약(ts-mx-*)은 ToolStatsMatrix(P3-09)에서 이미 고정 — 여기선 mount/empty/ToolIcon 슬롯만.
 */
import { describe, it, expect, beforeAll } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { MetaDocsToolStats } from '../MetaDocsToolStats';
import type { ToolStatRow } from '../../dashboard/tool-stats-sort';

beforeAll(() => {
  (globalThis as { window?: { I18n?: unknown } }).window ??= {};
  (globalThis as { window: { I18n?: unknown } }).window.I18n = { t: (k: string) => k };
});

const STATS: ToolStatRow[] = [
  { tool_name: 'Read', call_count: 10, error_count: 0, total_tokens: 5000, avg_duration_ms: 120 },
  { tool_name: 'mcp__redmine__getIssue', call_count: 3, error_count: 1, total_tokens: 800, avg_duration_ms: 400 },
];

describe('MetaDocsToolStats — P3-09 ToolStatsMatrix 위임 (arch §2.2)', () => {
  it('stats 주입 → ts-mx 매트릭스 mount', () => {
    const html = renderToStaticMarkup(createElement(MetaDocsToolStats, { stats: STATS }));
    expect(html).toContain('ts-mx');
    expect(html).toContain('Read');
  });
  it('빈 stats → no-data 빈 상태(ToolStatsMatrix 위임)', () => {
    const html = renderToStaticMarkup(createElement(MetaDocsToolStats, { stats: [] }));
    expect(html).toContain('state-empty');
  });
  it('ToolIcon 슬롯 주입 → mcp 도구 아이콘 (P3-09 renderIcon 계약)', () => {
    const html = renderToStaticMarkup(createElement(MetaDocsToolStats, { stats: STATS }));
    // mcp__ 도구는 tool-icon-mcp 라우팅(badges ToolIcon).
    expect(html).toContain('tool-icon-mcp');
  });
});
