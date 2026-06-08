/**
 * feed-row-interactions.test.tsx — 피드 행 상호작용 2종 검증.
 *
 *  기능 1) Session 셀 이동 링크: `sess-id-link[data-goto-session]` 클릭 → opts.onGotoSession(id, project)
 *          (stopPropagation). 콜백 미주입 시 무동작(에러 없이).
 *  기능 2) 프롬프트/메시지 펼치기: msg 셀 `prompt-preview[data-expand-id]` 클릭 → 행 바로 아래
 *          `tr.prompt-expand-row[data-expand-for]` 토글. 본문은 _promptCache 의 full text(extract SSoT).
 *
 * 검증 방식: jsdom 에 실제 마운트(react-dom/client) 후 네이티브 click 디스패치 —
 *   원본 위임(closest) 경로를 그대로 재현. (testing-library 미설치라 createRoot+act 사용.)
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RequestRow } from '../RequestRow';
import { ensureDom } from '../../../test-support/ensure-dom';

// 루트 bun test 에는 jsdom 전역이 없으므로 라이브 DOM 을 보장한다(vitest 에서는 no-op).
//   원본 위임(closest) 경로를 그대로 재현하려면 실제 DOM 마운트가 필요하다.
ensureDom();

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

// 테스트 t — useTranslation 출력을 ko 라벨로 고정(vitest.setup __setTestT). afterEach 자동 복원 대응으로 재주입.
beforeEach(() => {
  globalThis.__setTestT?.((key) => {
    const map: Record<string, string> = {
      'session:rows.empty-message': '메시지 없음',
      'ui:main.expand.copy': '복사',
      'ui:main.expand.copied': '✓복사됨',
    };
    return map[key] ?? key;
  });
});

let container: HTMLTableSectionElement;
let root: Root;

beforeEach(() => {
  // tbody 직계에 행을 마운트해야 expand <tr> 가 형제로 붙는다(원본 DOM 구조와 동일).
  const table = document.createElement('table');
  container = document.createElement('tbody');
  table.appendChild(container);
  document.body.appendChild(table);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

// fixture: prompt 행(본문 payload 보유 → contextPreview 가 prompt-preview + _promptCache 채움).
const promptRow = () => ({
  id: 'req-1',
  type: 'prompt',
  session_id: 'sess-abcdef0123456789',
  project_name: 'my-project',
  timestamp: 0,
  payload: JSON.stringify({ prompt: 'full prompt body line one\nline two with detail' }),
  preview: 'full prompt body line one',
});

describe('기능 1 — Session 이동 링크', () => {
  it('sess-id-link 클릭 → onGotoSession(sessionId, projectName)', () => {
    let got: [string, string] | null = null;
    act(() => {
      root.render(
        <RequestRow r={promptRow()} opts={{ showSession: true, onGotoSession: (s, p) => { got = [s, p]; } }} />,
      );
    });
    const link = container.querySelector<HTMLElement>('.sess-id-link[data-goto-session]');
    expect(link).toBeTruthy();
    // 레거시: id.slice(0,12)+'…'
    expect(link!.textContent).toBe('sess-abcdef0' + '…');
    act(() => { link!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(got).toEqual(['sess-abcdef0123456789', 'my-project']);
  });

  it('콜백 미주입 시 클릭해도 무동작(에러 없음)', () => {
    act(() => { root.render(<RequestRow r={promptRow()} opts={{ showSession: true }} />); });
    const link = container.querySelector<HTMLElement>('.sess-id-link');
    expect(() => act(() => { link!.dispatchEvent(new MouseEvent('click', { bubbles: true })); })).not.toThrow();
  });

  it('stopPropagation — 상위 React onClick 으로 전파되지 않음', () => {
    // React 18 합성 이벤트는 root 위임이라, 상위 핸들러도 React onClick 일 때 stopPropagation 이
    // 의미를 갖는다(실사용 시나리오). 네이티브 addEventListener 는 합성 stopPropagation 대상이 아님.
    // 부모 tbody 를 React 가 소유(onClick)해야 합성 stopPropagation 이 의미를 갖는다(실사용 경로).
    // 그래서 이 테스트만 별도 host div 에 table 전체를 React 로 렌더한다.
    let bubbled = false;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const r2 = createRoot(host);
    act(() => {
      r2.render(
        <table>
          <tbody onClick={() => { bubbled = true; }}>
            <RequestRow r={promptRow()} opts={{ showSession: true, onGotoSession: () => {} }} />
          </tbody>
        </table>,
      );
    });
    const link = host.querySelector<HTMLElement>('.sess-id-link')!;
    act(() => { link.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(bubbled).toBe(false);
    act(() => r2.unmount());
    host.remove();
  });
});

describe('기능 2 — 프롬프트/메시지 펼치기', () => {
  it('prompt-preview 클릭 → expand 행 삽입(본문 full text)', () => {
    act(() => { root.render(<RequestRow r={promptRow()} opts={{ showSession: true }} />); });
    expect(container.querySelector('[data-expand-for]')).toBeNull();

    const preview = container.querySelector<HTMLElement>('.prompt-preview[data-expand-id="req-1"]');
    expect(preview).toBeTruthy();
    act(() => { preview!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    const expandRow = container.querySelector<HTMLElement>('tr.prompt-expand-row[data-expand-for="req-1"]');
    expect(expandRow).toBeTruthy();
    expect(expandRow!.querySelector('td')!.getAttribute('colspan')).toBe('10');
    const content = expandRow!.querySelector('.prompt-expand-content');
    expect(content!.textContent).toContain('line two with detail'); // full body(미리보기 60자 절단 이후)
    // expand 행은 메인 행 바로 다음 형제(원본 container.after).
    expect(container.querySelector('tr')!.nextElementSibling).toBe(expandRow);
  });

  it('재클릭 시 닫힘(토글)', () => {
    act(() => { root.render(<RequestRow r={promptRow()} opts={{ showSession: true }} />); });
    const preview = container.querySelector<HTMLElement>('.prompt-preview')!;
    act(() => { preview.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.querySelector('[data-expand-for]')).toBeTruthy();
    const preview2 = container.querySelector<HTMLElement>('.prompt-preview')!;
    act(() => { preview2.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.querySelector('[data-expand-for]')).toBeNull();
  });

  it('복사 버튼 — i18n copy 라벨', () => {
    act(() => { root.render(<RequestRow r={promptRow()} opts={{ showSession: true }} />); });
    act(() => { container.querySelector<HTMLElement>('.prompt-preview')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const btn = container.querySelector('.expand-copy-btn');
    expect(btn).toBeTruthy();
    expect(btn!.textContent).toBe('복사');
  });

  it('expandCols=9 주입 → colspan=9 (세션 상세 9컬럼 테이블 일치)', () => {
    // TurnRows 가 showSession=false 일 때 expandCols=9 를 RequestRow 에 주입한다.
    // colspan 이 테이블 컬럼 수를 초과하면 마지막 컬럼이 테이블 밖으로 밀려 레이아웃이 깨진다.
    act(() => { root.render(<RequestRow r={promptRow()} opts={{ expandCols: 9 }} />); });
    const preview = container.querySelector<HTMLElement>('.prompt-preview[data-expand-id="req-1"]');
    act(() => { preview!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    const expandRow = container.querySelector<HTMLElement>('tr.prompt-expand-row');
    expect(expandRow!.querySelector('td')!.getAttribute('colspan')).toBe('9');
  });
});
