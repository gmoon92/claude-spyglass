/**
 * ErrorBanner.test.tsx — SSE 연결 실패 배너 TSX 동작 동치 (P4-09)
 *
 * 원본: index.html #errorBanner(:117-123, info 아이콘 + 메시지 + retry 버튼).
 *   main.js startSSE onError 시 표출 / onOpen 시 숨김(connectSSE 생명주기 결선).
 *
 * 전략: 마크업/가시성은 renderToStaticMarkup(컴포넌트가 react-i18next useTranslation 직접 구독 →
 *   vitest.setup 기본 passthrough t), retry 배선은 createRoot+act 라이브 렌더 후 DOM click.
 *   신규 계약: visible prop 으로 가시성 선언(원본 el.style.display 명령적 토글 대체).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ensureDom } from '../../test-support/ensure-dom';
import { ErrorBanner } from '../ErrorBanner';

ensureDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ErrorBanner — 가시성 계약', () => {
  it('visible=false 면 렌더하지 않는다(연결 정상 시 숨김)', () => {
    const html = renderToStaticMarkup(<ErrorBanner visible={false} onRetry={() => {}} />);
    expect(html).toBe('');
  });

  it('visible=true 면 .error-banner + retry 버튼을 노출한다(#errorBanner 1:1)', () => {
    const html = renderToStaticMarkup(<ErrorBanner visible onRetry={() => {}} />);
    expect(html).toContain('class="error-banner"');
    expect(html).toContain('retry-btn');
  });

  it('메시지 텍스트를 노출한다(연결 실패 안내)', () => {
    const html = renderToStaticMarkup(<ErrorBanner visible onRetry={() => {}} />);
    // i18n passthrough(key 그대로) → 메시지 키가 마크업에 존재.
    expect(html).toContain('ui:html.error-banner.msg');
  });
});

describe('ErrorBanner — retry 배선', () => {
  let container: HTMLElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
  });

  it('retry 버튼 클릭 시 onRetry 가 호출된다', () => {
    let called = 0;
    act(() => root.render(<ErrorBanner visible onRetry={() => { called += 1; }} />));
    const btn = container.querySelector<HTMLButtonElement>('.retry-btn')!;
    expect(btn).toBeTruthy();
    act(() => btn.click());
    expect(called).toBe(1);
  });
});
