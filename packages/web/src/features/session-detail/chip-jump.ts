/**
 * features/session-detail/chip-jump.ts — 칩 클릭 → 활성 턴 로그 행 점프 + 펼침 (React ref 기반)
 *
 * 원본: assets/js/main.js#{findChipTarget, findChipTargetByRequestId, flashChipTarget, handleChipActivation}.
 *
 * React 통일성(P5 정공법):
 *  - 구버전은 `document.getElementById('turnLogBody')` / `document.querySelector('#detailView ...')`
 *    전역 DOM 조회로 타깃을 찾았다 — React 트리 밖 전역 조회라 통일성을 깬다.
 *  - 본 모듈은 호출처(DetailView)가 부착한 **ref 스코프 내에서만** 탐색한다(ChipJumpRefs).
 *    · logBodyRef    = SessionLog 의 tbody#turnLogBody (활성 턴 로그 행)
 *    · detailRootRef = DetailView 루트(#turnUnifiedBody, 구 #detailView 역할) (칩↔칩 2순위)
 *  - 칩(FlowPane subtree)과 타깃 행(SessionLog subtree)은 별개 React subtree라 props 만으로
 *    행의 로컬 펼침 state(RequestRow useState)를 못 건드린다. 이 단절은 expand-store 가 잇는다 —
 *    RequestRow 가 접힌 동안에도 expand 진입점(expander)을 등록하고, chip-jump 는 expandByRid(rid)
 *    로 행 로컬 useState 를 펼친다(펼침 SSoT 단일화 — 펼침 로직 재구현 금지).
 *
 * 정공법 전환(합성 preview.click() 제거):
 *  - 과거엔 타깃 행 안 `[data-expand-id]` 에 합성 click 을 보내 RequestRow.onMsgCellClick 이 자기
 *    useState 를 토글하게 했다(escape-hatch). 그러나 토글이라 "이미 펼쳐진 행" 을 닫지 않으려고
 *    DOM 형제(.prompt-expand-row) 구조를 검사하는 가드가 필요했다.
 *  - 현재는 expand-store.expandByRid(rid) 가 expander(setExpanded(true))를 호출한다 — 토글이 아니라
 *    set-true 라 idempotent: 이미 펼쳐진 행은 무해한 no-op(DOM 형제 가드 불필요, 합성 click 불필요).
 *    타깃 행의 `data-request-id`(RequestRow 가 항상 부여)로 rid 를 얻어 호출한다.
 *
 * @module features/session-detail/chip-jump
 */
import type { RefObject } from 'react';
import { useExpandStore } from '../../stores/expand-store';

/** flash 클래스 노출 시간 — 원본 main.js#CHIP_FLASH_MS(2200) 동치. */
export const CHIP_FLASH_MS = 2200;

/**
 * 칩 점프가 탐색할 ref 모음 — 전역 DOM 조회(getElementById/querySelector) 대체.
 * 호출처(DetailView)가 ref 를 생성해 SessionLog/FlowPane 에 배분한다.
 */
export interface ChipJumpRefs {
  /** 활성 턴 log-pane tbody(#turnLogBody) — SessionLog 가 ref 부착. */
  logBodyRef: RefObject<HTMLElement | null>;
  /** detail 영역 루트(#turnUnifiedBody, 구 #detailView) — 칩↔칩 점프 2순위. DetailView 가 ref 부착. */
  detailRootRef: RefObject<HTMLElement | null>;
}

/**
 * CSS.escape 폴백 — 브라우저는 전역 CSS.escape 를 제공하지만 일부 비-DOM/구형 환경엔 없다.
 * 미존재 시 selector 메타문자만 백슬래시 이스케이프하는 최소 대체(원본 CSS.escape 사용처와 동치 의도).
 */
function cssEscape(value: string): string {
  const c = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS;
  if (c && typeof c.escape === 'function') return c.escape(value);
  return value.replace(/["\\\]\[#.:>+~*^$|=()'`,@ ]/g, '\\$&');
}

/**
 * 칩 키로 활성 턴 log-pane 안 첫 매칭 행을 찾는다. 원본 findChipTarget(main.js:492).
 *  - 1순위: logBodyRef(#turnLogBody) 안 tr[data-chip-key].
 *  - 2순위: detailRootRef 안 같은 키를 가진 일반 노드(칩↔칩 점프).
 */
export function findChipTarget(key: string, refs: ChipJumpRefs): Element | null {
  if (!key) return null;
  const safe = cssEscape(key);
  const row = refs.logBodyRef.current?.querySelector(`tr[data-chip-key="${safe}"]`);
  if (row) return row;
  return refs.detailRootRef.current?.querySelector(`[data-chip-key="${safe}"]`) ?? null;
}

/** request id 로 활성 턴 log-pane 안 정확한 행을 찾는다(그룹 칩). 원본 findChipTargetByRequestId(main.js:513). */
export function findChipTargetByRequestId(rid: string, refs: ChipJumpRefs): Element | null {
  if (!rid) return null;
  return refs.logBodyRef.current?.querySelector(`tr[data-request-id="${cssEscape(rid)}"]`) ?? null;
}

/**
 * 노드를 화면 중앙으로 smooth scroll + row-highlight-flash 부여(2.2초). 원본 flashChipTarget(main.js:528).
 *  - 같은 노드 연타 시 reflow 강제로 애니메이션 재시작.
 */
export function flashChipTarget(el: Element | null): void {
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('row-highlight-flash');
  // reflow 강제 — 애니메이션 재시작(원본 void el.offsetWidth).
  void (el as HTMLElement).offsetWidth;
  el.classList.add('row-highlight-flash');
  setTimeout(() => el.classList.remove('row-highlight-flash'), CHIP_FLASH_MS);
}

/**
 * 칩 활성화 처리 — 타깃 결정 → flash → log-pane 행이면 자동 펼침. 원본 handleChipActivation(main.js:557).
 *  - 타깃 우선순위: data-target-request-id(그룹 칩 정확 지정) → data-chip-key 첫 매칭.
 *  - 타깃이 <tr>(log-pane 행)이면 행의 `data-request-id` 로 expand-store.expandByRid(rid) 를 호출해
 *    RequestRow 의 펼침 useState 를 펼친다. set-true 라 idempotent — 이미 펼쳐졌으면 무해한 no-op.
 *
 * @param chip [data-chip-key] 노드(선택적 data-target-request-id 동반).
 * @param refs 탐색 ref 스코프(DetailView 제공).
 */
export function handleChipActivation(chip: HTMLElement, refs: ChipJumpRefs): void {
  const key = chip.dataset.chipKey || '';
  const targetRid = chip.dataset.targetRequestId || '';
  const target =
    (targetRid && findChipTargetByRequestId(targetRid, refs)) || (key && findChipTarget(key, refs)) || null;
  if (!target) return;
  flashChipTarget(target);

  // log-pane 행이면 점프 후 상세 메시지 자동 펼치기(원본 main.js:568-574).
  //   정공법: 합성 preview.click() 대신 expand-store.expandByRid(rid) 로 행 로컬 useState 를 펼친다.
  //   expander(setExpanded(true))는 idempotent — 이미 펼쳐진 행/미등록 행 모두 안전(no-op).
  if (target.tagName === 'TR') {
    const rid = target.getAttribute('data-request-id') || '';
    if (rid) useExpandStore.getState().expandByRid(rid);
  }
}

/**
 * FlowPane 루트에 칩 클릭 위임을 1회 등록. 원본 initChipActivationDelegation(main.js:585) 의
 * React 대응 — turn-spine / flow-head 어디에 칩이 박혀도 단일 핸들러로 처리한다.
 *  - 마커(.ds-turn-marker)와 turn-line 클릭은 활성 턴 전환(별 핸들러) 소관이라 칩 위임은
 *    [data-chip-key] 노드만 처리한다. <tr>(log-pane 행)은 제외(원본 main.js:594).
 *
 * @param root 위임을 걸 컨테이너(FlowPane section). null 이면 no-op.
 * @param refs 탐색 ref 스코프(DetailView 제공).
 * @returns cleanup — 리스너 제거(useEffect 반환).
 */
export function installChipDelegation(root: HTMLElement | null, refs: ChipJumpRefs): () => void {
  if (!root) return () => {};
  const onClick = (e: Event): void => {
    const t = e.target as HTMLElement | null;
    const chip = t?.closest<HTMLElement>('[data-chip-key]');
    if (!chip || chip.tagName === 'TR') return;
    e.preventDefault();
    e.stopPropagation();
    handleChipActivation(chip, refs);
  };
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target as HTMLElement | null;
    const chip = t?.closest<HTMLElement>('[data-chip-key][role="button"]');
    if (!chip || chip.tagName === 'TR') return;
    e.preventDefault();
    handleChipActivation(chip, refs);
  };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeydown);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKeydown);
  };
}
