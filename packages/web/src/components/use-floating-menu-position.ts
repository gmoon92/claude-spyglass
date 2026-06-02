/**
 * components/use-floating-menu-position.ts — fixed 플로팅 메뉴 위치 계산기 (hooks leaf)
 *
 * 동기: .ds-dropdown-menu 는 `position:fixed; top:0; left:0` 로 선언되고(dropdown.css §Menu),
 *   "JS positionFloating 이 open/resize/scroll 시 갱신"하는 것을 전제한다. React 포팅(P2-08)에서
 *   이 위치 계산 결선이 누락돼 메뉴가 0,0(화면 좌상단)에 박히던 회귀를 본 훅이 복원한다.
 *   fixed 를 쓰는 이유는 조상(#metaDocsRoot 등)의 overflow:hidden 클리핑을 회피하기 위함 — absolute 불가.
 *
 * 계약:
 *  - open=true 일 때만 트리거 rect 기준으로 메뉴의 fixed top/left 를 인라인 스타일로 설정.
 *  - align='end'(기본): 메뉴 우측을 트리거 우측에 맞춤(우측 끝 트리거의 메뉴가 화면 밖으로 안 넘침).
 *    align='start': 메뉴 좌측을 트리거 좌측에 맞춤.
 *  - viewport 가드: 좌우 8px clamp, 아래 공간 부족 + 위 공간 충분하면 트리거 위로 뒤집기(flip-up).
 *  - resize/scroll(capture) 추종 — 스크롤/리사이즈 시 메뉴가 트리거를 따라 재배치(레거시 동치).
 *  - SSR/rAF 부재 안전: window 없으면 no-op(effect 자체가 client 에서만 의미).
 *
 * 레이어(architecture §1.3): hooks leaf. DateRangeDropdown 호출처(MetaDocsLayout/BrowseLayout)가 소비.
 *
 * @module components/use-floating-menu-position
 */
import { useEffect, useLayoutEffect, type RefObject } from 'react';

/** SSR 가드 — DOM 있으면 layout(깜빡임 없음), 없으면 effect(no-op). */
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' && typeof window.document !== 'undefined' ? useLayoutEffect : useEffect;

export interface FloatingMenuOptions {
  /** 트리거-메뉴 간격(px). 기본 4. */
  gap?: number;
  /** 수평 정렬 — 'end'(메뉴 우측↔트리거 우측, 기본) | 'start'(좌측↔좌측). */
  align?: 'start' | 'end';
}

/**
 * open 시 메뉴(fixed)를 트리거 기준으로 배치하고 resize/scroll 을 추종한다.
 * @param open 메뉴 열림 여부(호출처 state).
 * @param triggerRef 기준 트리거 엘리먼트 ref.
 * @param menuRef 위치를 설정할 메뉴 엘리먼트 ref(fixed).
 */
export function useFloatingMenuPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement>,
  menuRef: RefObject<HTMLElement>,
  opts: FloatingMenuOptions = {},
): void {
  const { gap = 4, align = 'end' } = opts;
  useIsomorphicLayoutEffect(() => {
    if (!open) return undefined;
    const place = (): void => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const r = trigger.getBoundingClientRect();
      const menuW = menu.offsetWidth;
      const menuH = menu.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // 수평: end=우측 정렬, start=좌측 정렬. 좌우 8px viewport 가드.
      let left = align === 'end' ? r.right - menuW : r.left;
      left = Math.max(8, Math.min(left, vw - menuW - 8));
      // 수직: 기본 트리거 아래. 아래가 모자라고 위가 충분하면 위로 뒤집기.
      let top = r.bottom + gap;
      if (top + menuH > vh - 8 && r.top - gap - menuH > 8) top = r.top - gap - menuH;
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
    };
    place();
    window.addEventListener('resize', place);
    // capture=true — 중간 스크롤 컨테이너의 스크롤까지 잡아 메뉴가 트리거를 따라가게 한다.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, gap, align, triggerRef, menuRef]);
}
