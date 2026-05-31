/**
 * ErrorBanner.test.tsx — SSE 연결 실패 배너 TSX 동작 동치 (P4-09)
 *
 * 원본: index.html #errorBanner(:117-123, info 아이콘 + 메시지 + retry 버튼).
 *   main.js startSSE onError 시 표출 / onOpen 시 숨김(connectSSE 생명주기 결선).
 *
 * 전략(무 DOM 하네스): 마크업/가시성은 renderToStaticMarkup, retry 배선은 onClick 직접 invoke.
 *   신규 계약: visible prop 으로 가시성 선언(원본 el.style.display 명령적 토글 대체).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { ErrorBanner } from '../ErrorBanner';

function findFirst(node: unknown, pred: (el: ReactElement) => boolean): ReactElement | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const c of node) { const r = findFirst(c, pred); if (r) return r; }
    return null;
  }
  const el = node as ReactElement & { type?: unknown; props?: Record<string, unknown> };
  if (el.props && pred(el)) return el;
  if (typeof el.type === 'function') return findFirst((el.type as (p: unknown) => unknown)(el.props ?? {}), pred);
  if (el.props && el.props.children !== undefined) return findFirst(el.props.children, pred);
  return null;
}

const t = (key: string) => key;

describe('ErrorBanner — 가시성 계약', () => {
  it('visible=false 면 렌더하지 않는다(연결 정상 시 숨김)', () => {
    const html = renderToStaticMarkup(<ErrorBanner visible={false} onRetry={() => {}} t={t} />);
    expect(html).toBe('');
  });

  it('visible=true 면 .error-banner + retry 버튼을 노출한다(#errorBanner 1:1)', () => {
    const html = renderToStaticMarkup(<ErrorBanner visible onRetry={() => {}} t={t} />);
    expect(html).toContain('class="error-banner"');
    expect(html).toContain('retry-btn');
  });

  it('메시지 텍스트를 노출한다(연결 실패 안내)', () => {
    const html = renderToStaticMarkup(<ErrorBanner visible onRetry={() => {}} t={t} />);
    // i18n 스텁(key passthrough) → 메시지 키가 마크업에 존재.
    expect(html).toContain('ui.html.error-banner.msg');
  });
});

describe('ErrorBanner — retry 배선', () => {
  it('retry 버튼 클릭 시 onRetry 가 호출된다', () => {
    let called = 0;
    const tree = <ErrorBanner visible onRetry={() => { called += 1; }} t={t} />;
    const btn = findFirst(tree, (el) => {
      const cls = (el.props as { className?: string })?.className ?? '';
      return typeof cls === 'string' && cls.includes('retry-btn');
    });
    expect(btn).toBeTruthy();
    (btn!.props as { onClick: () => void }).onClick();
    expect(called).toBe(1);
  });
});
