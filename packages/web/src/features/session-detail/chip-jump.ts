/**
 * features/session-detail/chip-jump.ts — 칩 클릭 → 활성 턴 로그 행 점프 + 펼침 (레거시 동작 복원)
 *
 * 원본: assets/js/main.js
 *  - findChipTarget(key)            (main.js:492) — #turnLogBody 안 tr[data-chip-key] 우선 매칭.
 *  - findChipTargetByRequestId(rid) (main.js:513) — 그룹 칩 정확 지정(data-target-request-id).
 *  - flashChipTarget(el)            (main.js:528) — scrollIntoView(center) + row-highlight-flash 2.2s.
 *  - handleChipActivation(chip)     (main.js:557) — 타깃 결정 → flash → log-pane 행이면 자동 펼침.
 *
 * React 이식 사유(왜 DOM 위임인가):
 *  - 칩은 turn-spine(FlowPane) 서브트리, 타깃 행은 SessionLog tbody 서브트리 — 별개 React subtree 라
 *    props 만으로 행의 로컬 펼침 state(RequestRow useState)를 건드릴 수 없다.
 *  - 원본도 동일하게 칩 클릭 시 togglePromptExpand 로 "행이 가진 펼침 토글" 을 호출했다.
 *    여기서는 RequestRow 의 펼침 SSoT 를 그대로 재사용하기 위해, 행 안 `[data-expand-id]`
 *    (prompt-preview span)에 합성 click 을 디스패치한다 — RequestRow.onMsgCellClick 이 이를
 *    수신해 자기 useState 를 토글한다(펼침 SSoT 단일화, 펼침 로직 재구현 금지).
 *
 * @module features/session-detail/chip-jump
 */

/** flash 클래스 노출 시간 — 원본 main.js#CHIP_FLASH_MS(2200) 동치. */
export const CHIP_FLASH_MS = 2200;

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
 * 칩 키로 활성 턴 log-pane(#turnLogBody) 안 첫 매칭 행을 찾는다. 원본 findChipTarget(main.js:492).
 *  - 1순위: #turnLogBody 안 tr[data-chip-key].
 *  - 2순위: #detailView 안 같은 키를 가진 일반 노드(칩↔칩 점프).
 */
export function findChipTarget(key: string): Element | null {
  if (!key) return null;
  const safe = cssEscape(key);
  const logBody = document.getElementById('turnLogBody');
  const row = logBody?.querySelector(`tr[data-chip-key="${safe}"]`);
  if (row) return row;
  return document.querySelector(`#detailView [data-chip-key="${safe}"]`);
}

/** request id 로 활성 턴 log-pane 안 정확한 행을 찾는다(그룹 칩). 원본 findChipTargetByRequestId(main.js:513). */
export function findChipTargetByRequestId(rid: string): Element | null {
  if (!rid) return null;
  const logBody = document.getElementById('turnLogBody');
  return logBody?.querySelector(`tr[data-request-id="${cssEscape(rid)}"]`) ?? null;
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
 *  - 타깃이 <tr>(log-pane 행)이면 행 안 `[data-expand-id]` 에 합성 click 을 보내 RequestRow
 *    펼침 토글을 트리거한다. 이미 펼쳐져 있으면(아래 prompt-expand-row 형제 존재) no-op
 *    (원본 dataset.expanded === rid 가드 동치 — 토글 닫힘 회피).
 *
 * @param chip [data-chip-key] 노드(선택적 data-target-request-id 동반).
 */
export function handleChipActivation(chip: HTMLElement): void {
  const key = chip.dataset.chipKey || '';
  const targetRid = chip.dataset.targetRequestId || '';
  const target =
    (targetRid && findChipTargetByRequestId(targetRid)) || (key && findChipTarget(key)) || null;
  if (!target) return;
  flashChipTarget(target);

  // log-pane 행이면 점프 후 상세 메시지 자동 펼치기(원본 main.js:568-574).
  if (target.tagName === 'TR') {
    const tr = target as HTMLTableRowElement;
    // 이미 펼침 행이 바로 뒤에 있으면 닫지 않는다(원본 dataset.expanded 가드 대응).
    const next = tr.nextElementSibling;
    const alreadyExpanded = !!next && next.classList.contains('prompt-expand-row');
    if (alreadyExpanded) return;
    const preview = tr.querySelector<HTMLElement>('[data-expand-id]');
    if (preview) {
      // RequestRow.onMsgCellClick(closest('[data-expand-id]')) 가 수신 → 자기 useState 펼침 토글.
      preview.click();
    }
  }
}

/**
 * FlowPane 루트에 칩 클릭 위임을 1회 등록. 원본 initChipActivationDelegation(main.js:585) 의
 * React 대응 — turn-spine / flow-head 어디에 칩이 박혀도 단일 핸들러로 처리한다.
 *  - 마커(.ds-turn-marker)와 turn-line 클릭은 활성 턴 전환(별 핸들러) 소관이라 칩 위임은
 *    [data-chip-key] 노드만 처리한다. <tr>(log-pane 행)은 제외(원본 main.js:594).
 *
 * @param root 위임을 걸 컨테이너(FlowPane section). null 이면 no-op.
 * @returns cleanup — 리스너 제거(useEffect 반환).
 */
export function installChipDelegation(root: HTMLElement | null): () => void {
  if (!root) return () => {};
  const onClick = (e: Event): void => {
    const t = e.target as HTMLElement | null;
    const chip = t?.closest<HTMLElement>('[data-chip-key]');
    if (!chip || chip.tagName === 'TR') return;
    e.preventDefault();
    e.stopPropagation();
    handleChipActivation(chip);
  };
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target as HTMLElement | null;
    const chip = t?.closest<HTMLElement>('[data-chip-key][role="button"]');
    if (!chip || chip.tagName === 'TR') return;
    e.preventDefault();
    handleChipActivation(chip);
  };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeydown);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKeydown);
  };
}
