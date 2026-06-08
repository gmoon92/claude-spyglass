/**
 * update-modal.test.tsx — UpdateBadge / UpdateModal TSX 동작 동치 (P4-09)
 *
 * 원본: index.html #updateBadge(:356-375) + #updateModal(:866-946) + version-check.js
 *   (applyBadgeState/openModal/closeModal/doUpdate 의 DOM-imperative 제어).
 *   controlled React 컴포넌트로 이식 — 순수 상태(resolveBadgeState)는 version-check-logic SSoT 재사용.
 *
 * 전략: 마크업/모달 토글은 renderToStaticMarkup(컴포넌트가 react-i18next useTranslation 직접 구독 →
 *   vitest.setup 기본 passthrough t), 버튼 배선은 createRoot+act 라이브 렌더 후 DOM click.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ensureDom } from '../../../test-support/ensure-dom';
import { UpdateBadge } from '../UpdateBadge';
import { UpdateModal } from '../UpdateModal';

ensureDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('UpdateBadge — 상태별 모디파이어 클래스(applyBadgeState 1:1)', () => {
  it('available 상태 → update-badge--available + 클릭 가능', () => {
    const html = renderToStaticMarkup(
      <UpdateBadge state="available" currentVersion="1.0.0" latestTag="1.1.0" onOpen={() => {}} />,
    );
    expect(html).toContain('update-badge');
    expect(html).toContain('update-badge--available');
  });

  it('latest 상태 → update-badge--latest', () => {
    const html = renderToStaticMarkup(
      <UpdateBadge state="latest" currentVersion="1.0.0" latestTag="1.0.0" onOpen={() => {}} />,
    );
    expect(html).toContain('update-badge--latest');
  });

  it('loading 상태 → update-badge--loading', () => {
    const html = renderToStaticMarkup(
      <UpdateBadge state="loading" onOpen={() => {}} />,
    );
    expect(html).toContain('update-badge--loading');
  });
});

describe('UpdateBadge / UpdateModal — 버튼 배선(라이브 렌더)', () => {
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

  it('available 배지 클릭 → onOpen 호출(openModal 결선)', () => {
    let opened = 0;
    act(() =>
      root.render(
        <UpdateBadge state="available" currentVersion="1.0.0" latestTag="1.1.0" onOpen={() => { opened += 1; }} />,
      ),
    );
    const btn = container.querySelector<HTMLButtonElement>('.update-badge')!;
    expect(btn).toBeTruthy();
    act(() => btn.click());
    expect(opened).toBe(1);
  });

  it('confirm 버튼 클릭 → onConfirm(doUpdate 결선)', () => {
    let confirmed = 0;
    act(() =>
      root.render(
        <UpdateModal open currentVersion="1.0.0" latestTag="1.1.0"
          onConfirm={() => { confirmed += 1; }} onCancel={() => {}} onClose={() => {}} />,
      ),
    );
    const btn = container.querySelector<HTMLButtonElement>('.update-modal-btn-primary')!;
    expect(btn).toBeTruthy();
    act(() => btn.click());
    expect(confirmed).toBe(1);
  });

  it('cancel / close 버튼 클릭 → 각 콜백', () => {
    let cancelled = 0; let closed = 0;
    act(() =>
      root.render(
        <UpdateModal open currentVersion="1.0.0" latestTag="1.1.0"
          onConfirm={() => {}} onCancel={() => { cancelled += 1; }} onClose={() => { closed += 1; }} />,
      ),
    );
    const cancelBtn = container.querySelector<HTMLButtonElement>('.update-modal-btn-secondary')!;
    const closeBtn = container.querySelector<HTMLButtonElement>('.update-modal-close')!;
    act(() => cancelBtn.click());
    act(() => closeBtn.click());
    expect(cancelled).toBe(1);
    expect(closed).toBe(1);
  });
});

describe('UpdateModal — 토글 + 버전 비교', () => {
  it('open=false → .open 클래스 없음(닫힘)', () => {
    const html = renderToStaticMarkup(
      <UpdateModal open={false} currentVersion="1.0.0" latestTag="1.1.0"
        onConfirm={() => {}} onCancel={() => {}} onClose={() => {}} />,
    );
    // overlay 는 렌더되나 open 모디파이어는 없다(원본 classList .open 토글 1:1).
    expect(html).toContain('update-modal-overlay');
    expect(html).not.toContain('class="update-modal-overlay open"');
  });

  it('open=true → .open + 현재/최신 버전 표시', () => {
    const html = renderToStaticMarkup(
      <UpdateModal open currentVersion="1.0.0" latestTag="1.1.0"
        onConfirm={() => {}} onCancel={() => {}} onClose={() => {}} />,
    );
    expect(html).toContain('update-modal-overlay open');
    expect(html).toContain('1.0.0'); // 현재
    expect(html).toContain('1.1.0'); // 최신
  });
});
