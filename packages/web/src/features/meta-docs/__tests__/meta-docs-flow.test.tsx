/**
 * meta-docs-flow.test.tsx — MetaDocsFlow 셸 마크업 + activeRow 계약 (P4-03)
 *
 * 원본 meta-docs-flow.js loadFlow 의 명령형 SVG 빌드(makeNodeFO/makeEdgePath/bind*)는
 * document.createElementNS + offsetWidth 동기 측정 의존이라 bun:test(DOM 미구현)에서 단위 불가 →
 * Chart.test.tsx 선례대로 SSR 마크업(셀렉터/구조) + activeRow→loadFlow args 계약(순수)만 고정.
 * 명령형 렌더/줌/팬/드래그/하이라이트는 수동 verify(arch §4.2 suppression-marker 체크리스트).
 *
 * 회귀 게이트: flow-region id(셀렉터 계약), activeRow 단방향(catalog→flow), centerKind 매핑.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { MetaDocsFlow, activeRowToFlowArgs } from '../MetaDocsFlow';

// i18n t 는 DI(필수 prop) — 키 passthrough stub. D-1: 전역 window.I18n 비의존.
const t = (k: string) => k;

describe('MetaDocsFlow — 컨테이너 + 종단상태 셸 (xyflow 재작성)', () => {
  it('flow region 컨테이너 렌더 (metaDocsFlowRegion 셀렉터 계약 — useMetaDocsPanelResize topEl 보존)', () => {
    const html = renderToStaticMarkup(createElement(MetaDocsFlow, { activeRow: null, t }));
    expect(html).toContain('id="metaDocsFlowRegion"');
  });
  it('activeRow 미지정 → empty 종단상태(no-center) — ReactFlow pane 미마운트', () => {
    const html = renderToStaticMarkup(createElement(MetaDocsFlow, { activeRow: null, t }));
    // 빈 flow 는 EmptyState(flow-empty)만 — fetch 전이라 ReactFlow pane 미렌더.
    expect(html).toContain('flow-empty');
    expect(html).toContain('ui.meta-docs-view.flow.empty-no-center'); // t passthrough 키
    expect(html).not.toContain('react-flow__pane');
  });
});

describe('activeRowToFlowArgs — catalog→flow 단방향 계약 (arch §2.2)', () => {
  it('활성 행 → loadFlow args (centerKind/centerName/project)', () => {
    const args = activeRowToFlowArgs(
      { type: 'agent', name: 'designer', id: 1 },
      'projA',
    );
    expect(args).toEqual({ centerKind: 'agent', centerName: 'designer', project: 'projA', depth: 3 });
  });
  it('command type → centerKind command (flow.js fetch center_kind)', () => {
    const args = activeRowToFlowArgs({ type: 'command', name: 'commit', id: 2 }, null);
    expect(args?.centerKind).toBe('command');
    expect(args?.project).toBeNull();
  });
  it('null 행 → null args (빈 flow)', () => {
    expect(activeRowToFlowArgs(null, 'projA')).toBeNull();
  });
  it('orphan(id null) 행도 args 생성 — 호출처가 orphan 무시는 catalog 책임', () => {
    // flow 재중심은 name/type 만 필요. id 무관.
    const args = activeRowToFlowArgs({ type: 'skill', name: 'x', id: null }, null);
    expect(args?.centerName).toBe('x');
  });
});
