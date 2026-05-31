/**
 * flow-meta-characterization.test.tsx — FlowHead/PrologueCard/SystemReminderChip/SessionBadges
 * 특성화 테스트 (P3-06).
 *
 * 배경(§8 — 직접 export oracle 부재):
 *  - 원본 updateFlowHead/renderPrologueCardHtml/buildSystemReminderChip/updateSessionBadges 는
 *    turn-views.js module-private(또는 DOM 변이) 라 직접 oracle 비교가 불가능하다.
 *  - 대신 원본 소스의 분기/마크업을 1:1 미러한 **특성화(characterization)** 로 핵심 불변식을 고정한다:
 *      id/class 골격, 복잡도 톤·비용% 계산식, reminder N=0 미렌더, maxCost/topTool 집계.
 *  - 칩 6분기 자체의 렌더 동치는 turn-spine-equivalence.test.tsx 가 exported oracle 로 보증.
 */
import './_dom-stub';
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

// P5-07: Bun.file(...).text() (bun 전용) → Node fs 포팅. Vitest 는 `new URL(rel, import.meta.url)` 의
//   상대경로를 http base 로 재작성하므로, 테스트 파일 file:// URL 만 변환 후 path.resolve 로 대상 지정.
const readSource = (rel: string): string =>
  readFileSync(resolvePath(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
import { FlowHead } from '../FlowHead';
import { PrologueCard } from '../PrologueCard';
import { SystemReminderChip } from '../SystemReminderChip';
import { SessionBadges } from '../SessionBadges';

beforeAll(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.I18n = {
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}(${JSON.stringify(vars)})` : key,
  };
});

const r = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

// ── FlowHead ──────────────────────────────────────────────────────────────────

describe('FlowHead — 복잡도/비용 분기(updateFlowHead turn-views.js:340-364)', () => {
  it('toolCount>15 → complexity-high(warn)', () => {
    const turn: any = { prompt: { preview: 'p' }, summary: { tool_call_count: 16, total_tokens: 50 } };
    const html = r(<FlowHead activeTurn={turn} sessionTotalTokens={100} />);
    expect(html).toContain('id="fhComplexity"');
    expect(html).toContain('data-tone="warn"');
    expect(html).toContain('complexity-high');
    expect(html).toContain('<span id="fhCost">50%</span>');
  });

  it('5<toolCount<=15 → complexity-mid(info)', () => {
    const turn: any = { prompt: { preview: 'p' }, summary: { tool_call_count: 8, total_tokens: 25 } };
    const html = r(<FlowHead activeTurn={turn} sessionTotalTokens={100} />);
    expect(html).toContain('data-tone="info"');
    expect(html).toContain('complexity-mid');
    expect(html).toContain('<span id="fhCost">25%</span>');
  });

  it('toolCount<=5 → 빈 라벨 + display:none', () => {
    const turn: any = { prompt: { preview: 'p' }, summary: { tool_call_count: 2, total_tokens: 0 } };
    const html = r(<FlowHead activeTurn={turn} sessionTotalTokens={100} />);
    expect(html).toContain('data-tone="neutral"');
    expect(html).toMatch(/id="fhComplexity"[^>]*style="display:none"|style="display:none"[^>]*id="fhComplexity"/);
  });

  it('sessionTotalTokens=0 → 비용 —', () => {
    const turn: any = { prompt: { preview: 'p' }, summary: { tool_call_count: 0, total_tokens: 0 } };
    const html = r(<FlowHead activeTurn={turn} sessionTotalTokens={0} />);
    expect(html).toContain('<span id="fhCost">—</span>');
  });

  it('activeTurn=null → IN/OUT — 골격 유지', () => {
    const html = r(<FlowHead activeTurn={null} sessionTotalTokens={0} />);
    expect(html).toContain('id="fhTokIn">—');
    expect(html).toContain('id="fhTokOut">—');
    expect(html).toContain('id="flowHeadActive"');
  });

  it('extra 슬롯이 fhExtra 안에 주입된다', () => {
    const turn: any = { prompt: { preview: 'p' }, summary: { tool_call_count: 0, total_tokens: 0 } };
    const html = r(<FlowHead activeTurn={turn} sessionTotalTokens={1} extra={<span className="MARK" />} />);
    expect(html).toMatch(/id="fhExtra"[^>]*>.*class="MARK"/);
  });
});

// ── PrologueCard ────────────────────────────────────────────────────────────

describe('PrologueCard — renderPrologueCardHtml(turn-views.js:758)', () => {
  it('빈 prologue → null', () => {
    expect(PrologueCard({ prologue: [] })).toBeNull();
    expect(PrologueCard({ prologue: null })).toBeNull();
  });

  it('행마다 prologue-row + data-type + 시간, transcript 소스 태그', () => {
    const prologue: any = [
      { id: 'x1', type: 'tool_call', tool_name: 'Read', source: 'transcript-assistant-text', timestamp: '2026-04-28T10:00:00Z' },
      { id: 'x2', type: 'response', source: 'log', timestamp: '2026-04-28T10:01:00Z' },
    ];
    const html = r(<PrologueCard prologue={prologue} />);
    expect(html).toContain('class="turn-prologue-card"');
    expect((html.match(/class="prologue-row"/g) || []).length).toBe(2);
    expect(html).toContain('data-type="tool_call"');
    expect(html).toContain('data-type="response"');
    expect(html).toContain('prologue-source-tag'); // transcript + log 둘 다 태그
  });
});

// ── SystemReminderChip ────────────────────────────────────────────────────────

describe('SystemReminderChip — buildSystemReminderChip(turn-views.js:794)', () => {
  it('reminders 빈/null → null(원본 빈 문자열)', () => {
    expect(SystemReminderChip({ turnIndex: 1, reminders: [] })).toBeNull();
    expect(SystemReminderChip({ turnIndex: 1, reminders: null })).toBeNull();
  });

  it('N>0 → 칩 id/popover id/count + pre 본문', () => {
    const html = r(<SystemReminderChip turnIndex={7} reminders={['alpha', 'beta']} />);
    expect(html).toContain('id="turn-sysrem-chip-7"');
    expect(html).toContain('id="turn-sysrem-popover-7"');
    expect(html).toContain('data-sysrem-toggle="turn-sysrem-popover-7"');
    expect(html).toContain('aria-controls="turn-sysrem-popover-7"');
    expect(html).toContain('<span class="turn-system-reminder-count">2</span>');
    expect((html.match(/class="turn-system-reminder-item"/g) || []).length).toBe(2);
    expect(html).toContain('alpha');
    expect(html).toContain('beta');
  });

  it('reminder 본문은 escape 된다(XSS 가드)', () => {
    const html = r(<SystemReminderChip turnIndex={1} reminders={['<script>x</script>']} />);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ── SessionBadges (순환 차단 포함) ──────────────────────────────────────────────

describe('SessionBadges — updateSessionBadges(turn-views.js:839) + 순환 차단', () => {
  const turns: any = [
    { turn_index: 1, summary: { total_tokens: 100 }, tool_calls: [{ tool_name: 'Read' }, { tool_name: 'Read' }] },
    { turn_index: 2, summary: { total_tokens: 300 }, tool_calls: [{ tool_name: 'Bash' }] },
  ];

  it('sessionTotalTokens<=0 → hidden', () => {
    const html = r(<SessionBadges badgeTurns={turns} sessionTotalTokens={0} />);
    expect(html).toContain('detail-agg-badges--hidden');
    expect(html).not.toContain('detail-agg-badge ds-badge');
  });

  it('최고비용 turn(2) + 최다호출 tool(Read×2) 뱃지', () => {
    // window.I18n vars 는 JSON 직렬화 후 React 텍스트 노드라 " → &quot; 로 escape 된다.
    const html = r(<SessionBadges badgeTurns={turns} sessionTotalTokens={400} />);
    expect(html).toContain('max-cost-badge');
    expect(html).toContain('&quot;n&quot;:2'); // turn_index 2 가 최고 비용
    expect(html).toContain('top-tool-badge');
    expect(html).toContain('&quot;name&quot;:&quot;Read&quot;');
    expect(html).toContain('&quot;count&quot;:2');
  });

  it('detail-view 를 import 하지 않는다(순환 차단 — 소스 정적 확인)', async () => {
    const src = readSource('../SessionBadges.tsx');
    expect(src).not.toMatch(/from ['"].*detail-view/);
    expect(src).not.toMatch(/import.*applyBloatedSysHeader/);
  });
});
