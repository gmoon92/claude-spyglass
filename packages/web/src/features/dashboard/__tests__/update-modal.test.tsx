/**
 * update-modal.test.tsx — UpdateBadge / UpdateModal TSX 동작 동치 (P4-09)
 *
 * 원본: index.html #updateBadge(:356-375) + #updateModal(:866-946) + version-check.js
 *   (applyBadgeState/openModal/closeModal/doUpdate 의 DOM-imperative 제어).
 *   controlled React 컴포넌트로 이식 — 순수 상태(resolveBadgeState)는 version-check-logic SSoT 재사용.
 *
 * 전략(무 DOM 하네스): 마크업/모달 토글은 renderToStaticMarkup, 버튼 배선은 onClick 직접 invoke.
 */
import { describe, it, expect } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { UpdateBadge } from '../UpdateBadge';
import { UpdateModal } from '../UpdateModal';

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
const byClassFrag = (frag: string) => (el: ReactElement) => {
  const cls = (el.props as { className?: string })?.className ?? '';
  return typeof cls === 'string' && cls.split(' ').includes(frag);
};
const t = (key: string) => key;

describe('UpdateBadge — 상태별 모디파이어 클래스(applyBadgeState 1:1)', () => {
  it('available 상태 → update-badge--available + 클릭 가능', () => {
    let opened = 0;
    const html = renderToStaticMarkup(
      <UpdateBadge state="available" currentVersion="1.0.0" latestTag="1.1.0" onOpen={() => { opened += 1; }} t={t} />,
    );
    expect(html).toContain('update-badge');
    expect(html).toContain('update-badge--available');
  });

  it('latest 상태 → update-badge--latest', () => {
    const html = renderToStaticMarkup(
      <UpdateBadge state="latest" currentVersion="1.0.0" latestTag="1.0.0" onOpen={() => {}} t={t} />,
    );
    expect(html).toContain('update-badge--latest');
  });

  it('loading 상태 → update-badge--loading', () => {
    const html = renderToStaticMarkup(
      <UpdateBadge state="loading" onOpen={() => {}} t={t} />,
    );
    expect(html).toContain('update-badge--loading');
  });

  it('available 배지 클릭 → onOpen 호출(openModal 결선)', () => {
    let opened = 0;
    const tree = <UpdateBadge state="available" currentVersion="1.0.0" latestTag="1.1.0" onOpen={() => { opened += 1; }} t={t} />;
    const btn = findFirst(tree, byClassFrag('update-badge'));
    expect(btn).toBeTruthy();
    (btn!.props as { onClick: () => void }).onClick();
    expect(opened).toBe(1);
  });
});

describe('UpdateModal — 토글 + 버전 비교', () => {
  it('open=false → .open 클래스 없음(닫힘)', () => {
    const html = renderToStaticMarkup(
      <UpdateModal open={false} currentVersion="1.0.0" latestTag="1.1.0"
        onConfirm={() => {}} onCancel={() => {}} onClose={() => {}} t={t} />,
    );
    // overlay 는 렌더되나 open 모디파이어는 없다(원본 classList .open 토글 1:1).
    expect(html).toContain('update-modal-overlay');
    expect(html).not.toContain('class="update-modal-overlay open"');
  });

  it('open=true → .open + 현재/최신 버전 표시', () => {
    const html = renderToStaticMarkup(
      <UpdateModal open currentVersion="1.0.0" latestTag="1.1.0"
        onConfirm={() => {}} onCancel={() => {}} onClose={() => {}} t={t} />,
    );
    expect(html).toContain('update-modal-overlay open');
    expect(html).toContain('1.0.0'); // 현재
    expect(html).toContain('1.1.0'); // 최신
  });

  it('confirm 버튼 클릭 → onConfirm(doUpdate 결선)', () => {
    let confirmed = 0;
    const tree = (
      <UpdateModal open currentVersion="1.0.0" latestTag="1.1.0"
        onConfirm={() => { confirmed += 1; }} onCancel={() => {}} onClose={() => {}} t={t} />
    );
    const btn = findFirst(tree, byClassFrag('update-modal-btn-primary'));
    expect(btn).toBeTruthy();
    (btn!.props as { onClick: () => void }).onClick();
    expect(confirmed).toBe(1);
  });

  it('cancel / close 버튼 클릭 → 각 콜백', () => {
    let cancelled = 0; let closed = 0;
    const tree = (
      <UpdateModal open currentVersion="1.0.0" latestTag="1.1.0"
        onConfirm={() => {}} onCancel={() => { cancelled += 1; }} onClose={() => { closed += 1; }} t={t} />
    );
    const cancelBtn = findFirst(tree, byClassFrag('update-modal-btn-secondary'));
    const closeBtn = findFirst(tree, byClassFrag('update-modal-close'));
    (cancelBtn!.props as { onClick: () => void }).onClick();
    (closeBtn!.props as { onClick: () => void }).onClick();
    expect(cancelled).toBe(1);
    expect(closed).toBe(1);
  });
});
