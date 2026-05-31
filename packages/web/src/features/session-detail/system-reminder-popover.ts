/**
 * features/session-detail/system-reminder-popover.ts — system-reminder 칩 ↔ 팝오버 SSoT (P3-07)
 *
 * 원본: assets/js/session-detail/system-reminder-popover.js (모듈 싱글톤 + document 전역 리스너).
 * 이식 형태(P3-04 §2.3):
 *  - 좌표 계산 → `computePopoverPosition` 순수 함수(positionPopover:210, viewport clamp).
 *  - open/close/toggle 상태기계 → `createPopoverController`(주입형 DOM) — single-open 불변식·portal·
 *    aria-expanded·focus 복귀. 원본 module-level 싱글톤(_openPopoverId 등)을 클로저 상태로 캡슐화.
 *  - React 와이어링 → `useSystemReminderPopover` 훅: useEffect mount 시 capture 단계 document
 *    click/keydown/mousedown + window scroll(capture)/resize 리스너 부착, unmount 시 cleanup.
 *    원본 `_bound` 싱글톤 가드(:44,52)는 단일 마운트로 자연 해소(§2.3).
 *
 * 마크업/데이터는 비책임 — 칩 마크업은 SystemReminderChip.tsx, dedup 은 lib/system-reminder.ts.
 *
 * @module features/session-detail/system-reminder-popover
 */
import { useEffect } from 'react';

const GAP = 4;
const SAFE = 8;

/** positionPopover 입력 — 칩 rect 의 필요한 필드만. */
export interface ChipRect {
  left: number;
  bottom: number;
}

/** 팝오버 좌표(viewport 기준 fixed). */
export interface PopoverPosition {
  top: number;
  left: number;
}

/**
 * 팝오버 좌표 계산(positionPopover:210 SSoT, 순수 수학).
 *  - 기본: 칩 좌측 정렬(left = chipRect.left), 칩 아래(top = chipRect.bottom + GAP).
 *  - 우측 넘침: left + width > viewportWidth - SAFE → 우측끝 - SAFE.
 *  - 좌측 넘침: 보정 결과 < SAFE → SAFE 로 clamp.
 *  - 하단 넘침은 보정하지 않는다(칩 위 뒤집기 UX 회귀가 더 큼).
 */
export function computePopoverPosition(
  chipRect: ChipRect,
  popoverWidth: number,
  viewportWidth: number,
): PopoverPosition {
  let left = chipRect.left;
  if (left + popoverWidth > viewportWidth - SAFE) {
    left = viewportWidth - popoverWidth - SAFE;
  }
  if (left < SAFE) left = SAFE;
  const top = chipRect.bottom + GAP;
  return { top, left };
}

/** 컨트롤러가 의존하는 최소 DOM 표면(테스트 주입 가능). */
export interface PopoverDom {
  getElementById: (id: string) => PopoverElement | null;
  body: { appendChild: (node: unknown) => void };
  /** viewport 폭(positionPopover clamp). 기본 구현은 window.innerWidth. */
  viewportWidth: () => number;
}

/** 컨트롤러가 다루는 팝오버/칩 노드의 최소 표면. */
export interface PopoverElement {
  id: string;
  hidden: boolean;
  parentElement: unknown;
  nextSibling?: unknown;
  style: { top: string; left: string };
  setAttribute: (k: string, v: string) => void;
  getAttribute: (k: string) => string | null;
  focus: (opts?: { preventScroll?: boolean }) => void;
  getBoundingClientRect: () => { left: number; bottom: number; width: number };
  contains: (target: unknown) => boolean;
}

/**
 * open/close/toggle 상태기계. 원본 module-level 싱글톤을 클로저로 캡슐화 →
 * 한 컨트롤러 인스턴스 = 한 마운트(React 단일 마운트로 _bound 가드 불필요).
 */
export function createPopoverController(dom: PopoverDom) {
  let openId: string | null = null; // 현재 열린 popover id(한 시점 1개)
  let chipEl: PopoverElement | null = null; // 현재 활성 칩 — 닫힐 때 focus 복귀용
  let originalParent: { insertBefore?: (n: unknown, ref: unknown) => void; isConnected?: boolean } | null = null;
  let originalNextSibling: unknown = null;

  function position(popover: PopoverElement, chip: PopoverElement | null): void {
    if (!popover || !chip) return;
    const chipRect = chip.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const pos = computePopoverPosition(
      { left: chipRect.left, bottom: chipRect.bottom },
      popoverRect.width,
      dom.viewportWidth(),
    );
    popover.style.top = `${pos.top}px`;
    popover.style.left = `${pos.left}px`;
  }

  function open(popoverId: string, chip: PopoverElement): void {
    // 기존 열림이 다른 id 면 먼저 닫는다(single-open).
    if (openId && openId !== popoverId) close(openId);
    const popover = dom.getElementById(popoverId);
    if (!popover) return;

    // Portal: 원래 부모 위치 기록 후 body 로 이동(transform 조상 containing-block 회피).
    if (popover.parentElement && popover.parentElement !== (dom.body as unknown)) {
      originalParent = popover.parentElement as typeof originalParent;
      originalNextSibling = popover.nextSibling ?? null;
      dom.body.appendChild(popover);
    }

    popover.hidden = false;
    position(popover, chip);
    chip?.setAttribute('aria-expanded', 'true');
    openId = popoverId;
    chipEl = chip ?? null;
    popover.focus({ preventScroll: true });
  }

  function close(popoverId: string): void {
    if (!popoverId || openId !== popoverId) return; // 현재 open 과 불일치 → noop
    const popover = dom.getElementById(popoverId);
    if (popover) {
      popover.hidden = true;
      // Portal 복귀: 원래 부모가 아직 연결돼 있을 때만 되돌린다.
      if (originalParent && originalParent.isConnected && typeof originalParent.insertBefore === 'function') {
        originalParent.insertBefore(popover, originalNextSibling);
      }
    }
    originalParent = null;
    originalNextSibling = null;
    if (chipEl) {
      chipEl.setAttribute('aria-expanded', 'false');
      chipEl.focus({ preventScroll: true }); // focus 복귀 — 키보드 흐름 유지
    }
    openId = null;
    chipEl = null;
  }

  function toggle(popoverId: string, chip: PopoverElement): void {
    if (openId === popoverId) close(popoverId);
    else open(popoverId, chip);
  }

  /** 외부 mousedown 닫기 판정: 팝오버 ∨ 칩 영역 안이면 inside(true). */
  function isInside(target: unknown): boolean {
    if (!openId) return false;
    const popover = dom.getElementById(openId);
    if (popover && popover.contains(target)) return true;
    if (chipEl && chipEl.contains(target)) return true;
    return false;
  }

  /** 열린 팝오버 좌표만 재계산(scroll/resize). */
  function reposition(): void {
    if (!openId || !chipEl) return;
    const popover = dom.getElementById(openId);
    if (!popover) return;
    position(popover, chipEl);
  }

  return {
    open,
    close,
    toggle,
    isInside,
    reposition,
    openId: () => openId,
  };
}

/** 기본 DOM 어댑터 — 실제 document/window 기반. */
function browserDom(): PopoverDom {
  return {
    getElementById: (id: string) => document.getElementById(id) as unknown as PopoverElement | null,
    body: { appendChild: (n: unknown) => document.body.appendChild(n as Node) },
    viewportWidth: () => window.innerWidth,
  };
}

/**
 * useSystemReminderPopover — 칩↔팝오버 전역 인터랙션 훅(원본 initSystemReminderPopover:51 대체).
 *
 *  - mount 시: capture 단계 document click/keydown/mousedown + window scroll(capture)/resize 부착.
 *    capture 인 이유(원본 §이벤트 phase): #detailView 카드 토글 bubble 위임보다 먼저 가로채
 *    칩 클릭이 카드 펼침까지 일으키는 회귀를 차단(분기 진입 시 stopPropagation).
 *  - unmount 시: 동일 리스너 제거(원본엔 없던 cleanup — React 단일 마운트 계약).
 *  - 셀렉터 [data-sysrem-toggle]/[data-sysrem-close] 에만 반응(다른 인터랙션 충돌 회피).
 */
export function useSystemReminderPopover(): void {
  useEffect(() => {
    const ctl = createPopoverController(browserDom());

    const onClick = (e: Event): void => {
      const t = e.target as Element | null;
      const closeBtn = t?.closest?.('[data-sysrem-close]') as HTMLElement | null;
      if (closeBtn) {
        e.preventDefault();
        e.stopPropagation();
        ctl.close(closeBtn.dataset.sysremClose ?? '');
        return;
      }
      const chip = t?.closest?.('[data-sysrem-toggle]') as HTMLElement | null;
      if (chip) {
        e.preventDefault();
        e.stopPropagation();
        ctl.toggle(chip.dataset.sysremToggle ?? '', chip as unknown as PopoverElement);
      }
    };

    const onKeydown = (e: Event): void => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Escape' && ctl.openId()) {
        e.preventDefault();
        e.stopPropagation();
        ctl.close(ctl.openId()!);
        return;
      }
      if (ke.key === 'Enter' || ke.key === ' ' || ke.key === 'Spacebar') {
        const chip = (e.target as Element | null)?.closest?.('[data-sysrem-toggle]') as HTMLElement | null;
        if (!chip) return;
        e.preventDefault();
        e.stopPropagation();
        ctl.toggle(chip.dataset.sysremToggle ?? '', chip as unknown as PopoverElement);
      }
    };

    const onMousedown = (e: Event): void => {
      if (!ctl.openId()) return;
      if (ctl.isInside((e as MouseEvent).target)) return;
      ctl.close(ctl.openId()!);
    };

    const onViewportShift = (): void => ctl.reposition();

    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('mousedown', onMousedown, true);
    window.addEventListener('scroll', onViewportShift, true);
    window.addEventListener('resize', onViewportShift);

    return () => {
      // 닫힌 상태로 정리 — 좀비 portal 노드 방지.
      const id = ctl.openId();
      if (id) ctl.close(id);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('mousedown', onMousedown, true);
      window.removeEventListener('scroll', onViewportShift, true);
      window.removeEventListener('resize', onViewportShift);
    };
  }, []);
}
