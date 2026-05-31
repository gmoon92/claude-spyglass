/**
 * flow-pane.test.tsx — FlowPane 조립체 + SessionLog.flowPane 슬롯 결합 (P3-06)
 *
 * 검증:
 *  - flow-pane <section data-region="flow"> 골격(원본 turn-views.js:982-999) + #turnSpine.
 *  - TurnSpine 임베드(활성 턴 chip-flow) — 동치는 turn-spine-equivalence 가 oracle 로 보증.
 *  - SessionLog 의 flowPane 슬롯에 주입 시 flow-pane 이 log-pane 보다 앞에 온다(SSoT 슬롯 계약).
 */
import './_dom-stub';
import { describe, it, expect, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FlowPane } from '../FlowPane';
import { SessionLog } from '../SessionLog';

beforeAll(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.I18n = { t: (k: string) => k };
});

const r = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

function tool(id: string, tool_name: string, extra: Record<string, unknown> = {}) {
  return { id, type: 'tool_call', turn_id: 't1', timestamp: '2026-04-28T10:01:00Z', tool_name, ...extra };
}

const turns: any = [
  {
    turn_id: 't1',
    turn_index: 2,
    prompt: { preview: 'active prompt' },
    summary: { tokens_input: 10, tokens_output: 20, total_tokens: 30, tool_call_count: 7 },
    items: [{ kind: 'tool', request: tool('a1', 'Read') }],
  },
  {
    turn_id: 't0',
    turn_index: 1,
    prompt: { preview: 'older prompt' },
    summary: { total_tokens: 10 },
    items: [{ kind: 'tool', request: tool('a0', 'Bash') }],
  },
];

describe('FlowPane 골격', () => {
  it('flow-pane section + #turnSpine + flow-head 포함', () => {
    const html = r(<FlowPane turns={turns} activeTurnId="t1" sessionTotalTokens={40} />);
    expect(html).toContain('class="flow-pane"');
    expect(html).toContain('data-region="flow"');
    expect(html).toContain('id="turnSpine"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('id="flowHeadActive"');
    // 활성 턴 메타 — 복잡도 mid(tool_call_count 7), 비용 30/40=75%.
    expect(html).toContain('complexity-mid');
    expect(html).toContain('<span id="fhCost">75%</span>');
  });

  it('활성 turn-line(is-active) + chip-flow 임베드', () => {
    const html = r(<FlowPane turns={turns} activeTurnId="t1" sessionTotalTokens={40} />);
    expect(html).toContain('turn-line is-active');
    expect(html).toContain('class="chip-flow"');
    expect(html).toContain('data-chip-key="tool:Read"');
  });

  it('프롤로그가 있으면 flow-pane 앞에 prologue 카드', () => {
    const prologue: any = [{ id: 'p1', type: 'tool_call', tool_name: 'Read', timestamp: '2026-04-28T09:00:00Z' }];
    const html = r(<FlowPane turns={turns} activeTurnId="t1" sessionTotalTokens={40} prologue={prologue} />);
    const prologueIdx = html.indexOf('turn-prologue-card');
    const flowIdx = html.indexOf('class="flow-pane"');
    expect(prologueIdx).toBeGreaterThanOrEqual(0);
    expect(prologueIdx).toBeLessThan(flowIdx);
  });

  it('활성 reminder 가 있으면 fhExtra 안에 sysrem 칩', () => {
    const html = r(
      <FlowPane turns={turns} activeTurnId="t1" sessionTotalTokens={40} activeReminders={['rem one']} />,
    );
    expect(html).toContain('id="turn-sysrem-chip-2"'); // 활성 turn_index 2
  });
});

describe('SessionLog.flowPane 슬롯 결합', () => {
  it('flow-pane 이 log-pane 보다 앞에 렌더된다', () => {
    const flowPane = <FlowPane turns={turns} activeTurnId="t1" sessionTotalTokens={40} />;
    const html = r(<SessionLog activeTurn={turns[0]} flowPane={flowPane} />);
    const flowIdx = html.indexOf('class="flow-pane"');
    const logIdx = html.indexOf('class="log-pane"');
    expect(flowIdx).toBeGreaterThanOrEqual(0);
    expect(logIdx).toBeGreaterThan(flowIdx);
    // log-pane 표 골격(col-resize 안정 노드)도 함께.
    expect(html).toContain('id="turnLogTable"');
    expect(html).toContain('id="turnLogBody"');
  });
});
