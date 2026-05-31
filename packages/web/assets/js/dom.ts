// @ts-check
// dom.js — DOM narrowing 헬퍼 SSoT (R5).
//
// 목적: checkJs 환경에서 querySelector/getElementById/event.target 결과가
//   Element|EventTarget|null 로 추론되어 HTMLInputElement/HTMLSelectElement 등의
//   전용 프로퍼티 접근 시 TS2339가 발생한다. 표준 DOM 인터페이스를 전역
//   augmentation하면 타입 안전이 붕괴하므로(R5 반려 사유), 호출 지점에서 이 헬퍼로
//   좁힌다.
//
// 런타임 동작: 전부 no-op (인자를 그대로 반환). 타입만 좁히는 JSDoc 캐스팅 래퍼다.
//   따라서 런타임 비용 0, 기존 출력/동작 불변(회귀 0).
//
// 제공 헬퍼: asEl / asInput / asButton / asTableSection / asDetails.
//   그 외 1회성 좁힘(HTMLCanvasElement/HTMLSelectElement/HTMLTableRowElement 등)은
//   호출부 인라인 캐스팅(`/** @type {...} */ (el)`)으로 처리한다 — 공용 헬퍼는
//   2곳 이상에서 재사용되는 케이스만 둔다.
//
// 사용 패턴:
//   const inp = asInput(container.querySelector('input'));   // HTMLInputElement
//   const el  = asEl(e.target);                               // HTMLElement (이벤트 핸들러)
//   const btn = asButton(out.querySelector('button'));        // HTMLButtonElement
//   const d   = asDetails(node);                              // HTMLDetailsElement

/**
 * Element|EventTarget|null → HTMLElement 로 좁힘.
 * dataset / style / hidden / offsetWidth / focus / closest 등 HTMLElement 표면 접근용.
 * @param {EventTarget|Element|null|undefined} el
 * @returns {HTMLElement}
 */
export function asEl(el: EventTarget | Element | null | undefined): HTMLElement {
  return el as unknown as HTMLElement;
}

/**
 * → HTMLInputElement (value / select / disabled).
 * @param {EventTarget|Element|null|undefined} el
 * @returns {HTMLInputElement}
 */
export function asInput(el: EventTarget | Element | null | undefined): HTMLInputElement {
  return el as unknown as HTMLInputElement;
}

/**
 * → HTMLButtonElement (disabled).
 * @param {EventTarget|Element|null|undefined} el
 * @returns {HTMLButtonElement}
 */
export function asButton(el: EventTarget | Element | null | undefined): HTMLButtonElement {
  return el as unknown as HTMLButtonElement;
}

/**
 * → HTMLTableSectionElement (tbody/thead/tfoot: rows / deleteRow / insertRow).
 * @param {EventTarget|Element|null|undefined} el
 * @returns {HTMLTableSectionElement}
 */
export function asTableSection(el: EventTarget | Element | null | undefined): HTMLTableSectionElement {
  return el as unknown as HTMLTableSectionElement;
}

/**
 * → HTMLDetailsElement (open).
 * @param {EventTarget|Element|null|undefined} el
 * @returns {HTMLDetailsElement}
 */
export function asDetails(el: EventTarget | Element | null | undefined): HTMLDetailsElement {
  return el as unknown as HTMLDetailsElement;
}
