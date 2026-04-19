// 리사이즈 공통 유틸 — panel-resize.js와 col-resize.js에서 공유
// ADR-004: Auto-fit 측정 로직 공통화 (measureMaxWidth)

/**
 * 주어진 요소 목록에서 가장 넓은 콘텐츠 너비(px)를 반환.
 * overflow:hidden 요소도 잘린 부분 포함 전체 scrollWidth를 반환하므로 별도 DOM 조작 불필요.
 * @param {Iterable<Element>} elements
 * @returns {number}
 */
export function measureMaxWidth(elements) {
  let max = 0;
  for (const el of elements) max = Math.max(max, el.scrollWidth);
  return max;
}
