/**
 * dom-preserve.js — SSE 갱신 시 사용자 인터랙션 보존 유틸 (ADR-007)
 *
 * 책임:
 *   SSE/필터 변경으로 행을 다시 그릴 때, 흩어진 보존 코드(scrollTop, expanded prompt row,
 *   펼친 turn 카드 ID, 검색어 입력값)를 한 함수로 묶어 캡처/복원한다.
 *
 * 호출자:
 *   - main.js prependRequest (전체 피드)
 *   - session-detail/flat-view.js renderDetailRequests
 *   - session-detail/turn-views.js renderTurnCards
 *
 * SSoT 효과:
 *   기존엔 flat-view.js, turn-views.js, default-view.js 셋이 비슷한 보존 로직을
 *   따로 들고 있어 한 곳을 빠뜨리면 회귀가 나기 쉬웠다 (ADR-007 배경).
 *   이 유틸로 시그널 1곳에 모음.
 *
 * 보존 항목:
 *   1. 컨테이너 scrollTop
 *   2. [data-expand-for]로 펼친 prompt expand row의 키 (행 ID)
 *      → fn 실행으로 expand row가 사라지면, expand row 부모의 행 id로 토글 재요청 가능
 *   3. .turn-card[aria-expanded="true"]의 turn-id 집합 (turn 뷰)
 *   4. 검색 input의 값 (있을 때)
 */

/**
 * @typedef {object} PreservedState
 * @property {number} scrollTop
 * @property {Set<string>} expandedRequestIds  - prompt 펼침 행
 * @property {Set<string>} expandedTurnIds     - turn 카드 펼침
 * @property {string|null} searchQuery
 */

/**
 * 컨테이너의 인터랙션 상태를 캡처한다.
 * @param {Element} container
 * @returns {PreservedState}
 */
export function captureInteraction(container) {
  if (!container) {
    return { scrollTop: 0, expandedRequestIds: new Set(), expandedTurnIds: new Set(), searchQuery: null };
  }
  const scrollTop = container.scrollTop ?? 0;

  const expandedRequestIds = new Set();
  container.querySelectorAll('[data-expand-for]').forEach((el) => {
    const id = el.dataset.expandFor;
    if (id) expandedRequestIds.add(id);
  });

  const expandedTurnIds = new Set();
  container.querySelectorAll('.turn-card[aria-expanded="true"]').forEach((el) => {
    const tid = el.dataset.turnId;
    if (tid) expandedTurnIds.add(tid);
  });

  // 검색 input은 컨테이너 외부일 수도 있어 명시 셀렉터로 위 단계에서 잡지 않음.
  // 호출자가 필요시 ctx에 넘기는 방식으로 확장 가능.
  return { scrollTop, expandedRequestIds, expandedTurnIds, searchQuery: null };
}

/**
 * 캡처된 상태를 컨테이너에 복원한다.
 * scrollTop만 자동 복원. expand 상태는 호출자가 토글 함수와 함께 호출해 줘야 한다 (DOM 구조 의존).
 * @param {Element} container
 * @param {PreservedState} state
 */
export function restoreInteraction(container, state) {
  if (!container || !state) return;
  if (state.scrollTop > 0) container.scrollTop = state.scrollTop;
}

/**
 * 가장 흔한 사용 패턴: 캡처 → fn 실행 → 복원.
 * fn 안에서 행을 통째로 다시 그려도 scrollTop은 유지된다.
 *
 * @param {Element} container
 * @param {() => void | Promise<void>} fn
 * @returns {Promise<PreservedState>}  복원에 사용한 상태(호출자가 expand 복원 등을 추가로 처리할 수 있게)
 */
export async function preserveInteraction(container, fn) {
  const state = captureInteraction(container);
  await fn();
  restoreInteraction(container, state);
  return state;
}
