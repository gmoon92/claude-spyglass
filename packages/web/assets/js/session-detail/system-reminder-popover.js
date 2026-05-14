/**
 * system-reminder-popover.js — system-reminder 칩 ↔ 팝오버 인터랙션 SSoT.
 *
 * 책임 (디자인 명세 design-spec.md §5):
 *  - 칩 클릭 / Enter / Space → 팝오버 토글 + aria-expanded 동기화.
 *  - 한 시점에 최대 1개 팝오버만 열린 상태 유지 — 새로 열 때 기존은 즉시 닫힘.
 *  - 닫기 트리거: × 버튼, Escape, anchor 외부 mousedown.
 *  - 닫힐 때 focus는 원래 칩으로 복귀 (시각 흐름 유지).
 *  - 팝오버 좌표 계산 — viewport 기준 fixed 배치 + 칩 rect 추종 (positionPopover).
 *    상위 .turn-card의 overflow:hidden 클리핑을 회피하기 위함이다.
 *  - 팝오버 DOM portal — open 시 document.body로 이동, close 시 원래 anchor로 복귀.
 *    transform 조상(.right-view 등)이 자손 fixed의 containing block을 가로채는
 *    회귀를 차단한다.
 *
 * 비책임:
 *  - 마크업 생성: turn-views.js의 buildSystemReminderChip 단일 책임.
 *  - 데이터 dedup/diff: session-detail/system-reminder.js 단일 책임.
 *  - 시각·애니메이션: turn-view.css 룰. JS는 클래스/속성/inline style만 토글.
 *
 * 호출자: main.js initSystemReminderPopover() — 부트스트랩 시 1회 등록.
 *
 * 모듈 부수효과: document 레벨 click·mousedown·keydown 리스너 1조 + window
 *  scroll(capture)·resize 리스너 1조를 등록한다. 후자는 열린 팝오버가 있을 때만
 *  좌표를 재계산하므로 idle 시 비용은 무시 가능.
 *
 *  - capture 단계 mousedown은 외부 클릭 닫기용 (팝오버 안 클릭은 click 단계에서 처리).
 *  - scroll은 capture로 등록해 내부 스크롤 컨테이너(#turnUnifiedBody 등)에서도
 *    버블링 없이 발생하는 이벤트를 잡아낸다.
 *  - 다른 모듈과의 충돌 회피: 셀렉터 [data-sysrem-toggle] / [data-sysrem-close]에만 반응.
 *
 * 이벤트 phase 결정 (정합성 노트):
 *  - 카드 펼침 위임(main.js의 `#detailView` click/keydown)이 bubble 단계로 동작하므로,
 *    같은 document 레벨에서 bubble로 등록하면 detailView가 먼저 처리되어
 *    칩 클릭이 카드 토글까지 일으키는 회귀가 있다.
 *  - 따라서 click·keydown은 **capture 단계**로 부착해 detailView 위임보다 먼저 가로채고,
 *    분기 진입 시 stopPropagation으로 bubble까지 차단한다.
 *  - mousedown은 외부 클릭 닫기 목적이므로 capture 유지(다른 인터랙션보다 우선 처리).
 */

let _openPopoverId      = null;  // 현재 열린 popover element id (한 시점에 1개)
let _openChipEl         = null;  // 현재 활성 칩 element ref — 닫힐 때 focus 복귀용
let _originalParent     = null;  // open 시 body로 portal 하기 전의 원래 부모 (close 시 복귀)
let _originalNextSibling = null; // 원래 위치의 nextSibling — 동일 위치로 insertBefore 하기 위함
let _bound              = false; // 리스너 중복 등록 방지

/**
 * 부트스트랩 시 1회 호출.
 *  - 이미 등록된 상태면 no-op (재진입 안전).
 *  - 본 모듈은 module-level 싱글톤 — 다중 인스턴스 불필요.
 */
export function initSystemReminderPopover() {
  if (_bound) return;
  _bound = true;

  // 1) 칩 클릭 → 토글. capture로 등록해 #detailView의 data-toggle-card bubble 위임보다
  //    먼저 가로챈다. 분기 진입 시 stopPropagation으로 카드 펼침 회귀 차단.
  document.addEventListener('click', onDocumentClick, true);
  // 2) 키보드 활성화 (Enter/Space) — 마찬가지로 capture로 가로채 카드 토글 keydown 위임 회피.
  document.addEventListener('keydown', onDocumentKeydown, true);
  // 3) 외부 클릭 닫기 — capture로 mousedown 잡아 inside 클릭과 분리.
  //    (click이 아닌 mousedown인 이유: focus 이동·드래그 등 다른 인터랙션 전에 닫혀야 자연스럽다.)
  document.addEventListener('mousedown', onDocumentMousedown, true);
  // 4) 스크롤·리사이즈 추종 — 팝오버는 position: fixed 이므로 칩이 움직이면 분리된다.
  //    내부 스크롤 컨테이너에서도 이벤트를 받기 위해 scroll은 capture로 등록한다.
  window.addEventListener('scroll', onViewportShift, true);
  window.addEventListener('resize', onViewportShift);
}

function onDocumentClick(e) {
  // × 버튼 클릭 — popover id 명시
  const closeBtn = e.target.closest('[data-sysrem-close]');
  if (closeBtn) {
    e.preventDefault();
    e.stopPropagation();
    closePopover(closeBtn.dataset.sysremClose);
    return;
  }

  // 칩 클릭 → 토글. data 속성으로 대상 popover id 확보.
  const chip = e.target.closest('[data-sysrem-toggle]');
  if (chip) {
    e.preventDefault();
    e.stopPropagation();
    const popoverId = chip.dataset.sysremToggle;
    if (_openPopoverId === popoverId) {
      closePopover(popoverId);
    } else {
      openPopover(popoverId, chip);
    }
  }
}

function onDocumentKeydown(e) {
  // ESC — 열려 있을 때만 처리
  if (e.key === 'Escape' && _openPopoverId) {
    e.preventDefault();
    e.stopPropagation();
    closePopover(_openPopoverId);
    return;
  }

  // Enter/Space — 포커스가 칩에 있을 때 토글.
  // capture 단계에서 stopPropagation + preventDefault로 detailView 위임(카드 토글)을 차단하고
  // button의 기본 click trigger도 막아 더블 토글을 방지한다.
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
    const chip = e.target.closest?.('[data-sysrem-toggle]');
    if (!chip) return;
    e.preventDefault();
    e.stopPropagation();
    const popoverId = chip.dataset.sysremToggle;
    if (_openPopoverId === popoverId) {
      closePopover(popoverId);
    } else {
      openPopover(popoverId, chip);
    }
  }
}

function onDocumentMousedown(e) {
  if (!_openPopoverId) return;
  // 팝오버는 portal로 body 아래에 떠있을 수 있으므로 anchor 기준이 아닌
  // (팝오버 자신) ∨ (현재 칩) 영역을 inside로 간주한다.
  const popover = document.getElementById(_openPopoverId);
  if (popover && popover.contains(e.target)) return;
  if (_openChipEl && _openChipEl.contains(e.target)) return;
  closePopover(_openPopoverId);
}

/**
 * 팝오버 열기 — 기존 열린 팝오버는 먼저 닫고 단일 open 상태 유지.
 *  - aria-expanded 칩 동기화.
 *  - 팝오버 노드를 document.body로 portal 이동 (transform 조상의 containing block
 *    영향에서 벗어나 position: fixed가 진짜 viewport 기준으로 동작하게 한다).
 *  - positionPopover로 viewport 좌표를 설정.
 *  - dialog focus 이동(tabindex=-1).
 *
 * Portal 사유 (정합성 노트):
 *   `.right-view`(default-view.css)에 `transform: translateX(...)`가 활성/비활성 토글
 *   상태로 걸려 있다. CSS 명세상 transform 적용된 조상은 자손 fixed의 containing
 *   block을 viewport에서 자신으로 가로챈다 — 좌표가 어긋나는 회귀의 직접 원인.
 *   따라서 open 시 노드를 body로 이동하고, close 시 원래 위치로 복귀시킨다.
 */
function openPopover(popoverId, chipEl) {
  if (_openPopoverId && _openPopoverId !== popoverId) {
    closePopover(_openPopoverId);
  }
  const popover = document.getElementById(popoverId);
  if (!popover) return;

  // Portal: 원래 부모 위치를 기록한 뒤 body로 이동. 이미 body 직속이면 no-op.
  if (popover.parentElement && popover.parentElement !== document.body) {
    _originalParent = popover.parentElement;
    _originalNextSibling = popover.nextSibling;
    document.body.appendChild(popover);
  }

  popover.hidden = false;
  positionPopover(popover, chipEl);

  chipEl?.setAttribute('aria-expanded', 'true');
  _openPopoverId = popoverId;
  _openChipEl = chipEl ?? null;

  // 다이얼로그 focus — Tab 트랩은 두지 않음(시각적 위계가 명확하고 본문은 비대화형).
  popover.focus({ preventScroll: true });
}

/**
 * 팝오버 닫기 — focus는 원래 칩으로 복귀, 노드는 원래 anchor 안으로 복귀.
 *  - 인자 popoverId가 현재 open과 다르면 noop (외부에서 잘못 호출 방지).
 *  - 원래 위치 복귀: 다시 열 때 동일 anchor에서 ID 매칭이 가능하도록 보장하고
 *    body에 좀비 노드가 쌓이지 않게 한다.
 *  - inline style(top/left)은 다음 open 시 다시 계산되므로 굳이 비우지 않는다.
 */
function closePopover(popoverId) {
  if (!popoverId || _openPopoverId !== popoverId) return;
  const popover = document.getElementById(popoverId);
  if (popover) {
    popover.hidden = true;
    // Portal 복귀: 원래 부모가 아직 DOM에 있을 때만 안전하게 되돌린다.
    if (_originalParent && _originalParent.isConnected) {
      _originalParent.insertBefore(popover, _originalNextSibling);
    }
  }
  _originalParent = null;
  _originalNextSibling = null;
  if (_openChipEl) {
    _openChipEl.setAttribute('aria-expanded', 'false');
    // focus 복귀 — 키보드 사용자의 흐름 유지.
    _openChipEl.focus({ preventScroll: true });
  }
  _openPopoverId = null;
  _openChipEl = null;
}

/**
 * 팝오버 좌표 계산 (viewport 기준 fixed 배치 SSoT).
 *
 * 배치 규칙:
 *  - 기본: 칩 바로 아래(top = chipRect.bottom + GAP), 칩의 좌측 정렬(left = chipRect.left).
 *  - 우측 넘침: left + popoverWidth가 viewport 우측 마진을 넘으면 우측 끝 - 마진으로 보정.
 *  - 좌측 넘침: 그 보정 결과가 좌측 마진보다 작아지면 좌측 마진으로 clamp.
 *  - 하단 넘침은 별도 처리하지 않는다 — 칩 위로 뒤집어 띄우는 UX 회귀가 더 큼.
 *
 * 호출 시점: open 시 1회 + window scroll(capture) / resize 시.
 *
 * @param {HTMLElement} popover - 가시 상태의 .turn-system-reminder-popover
 * @param {HTMLElement|null|undefined} chipEl - 기준 칩 (없으면 noop)
 */
function positionPopover(popover, chipEl) {
  if (!popover || !chipEl) return;
  const GAP = 4;
  const SAFE = 8;
  const chipRect = chipEl.getBoundingClientRect();
  // hidden 해제 직후 getBoundingClientRect()는 실제 렌더 너비를 반환한다.
  const popoverRect = popover.getBoundingClientRect();
  const width = popoverRect.width;

  let left = chipRect.left;
  if (left + width > window.innerWidth - SAFE) {
    left = window.innerWidth - width - SAFE;
  }
  if (left < SAFE) left = SAFE;

  const top = chipRect.bottom + GAP;
  popover.style.top  = `${top}px`;
  popover.style.left = `${left}px`;
}

/**
 * window scroll(capture) / resize 핸들러 — 열린 팝오버 좌표만 갱신.
 *  - 닫혀 있으면 즉시 return (idle 비용 최소화).
 *  - 칩이 화면 밖으로 스크롤 아웃되어도 시각적으로만 분리될 뿐 인터랙션은 유지된다
 *    (다음 scroll 이벤트에서 재계산되며 다시 정렬됨).
 */
function onViewportShift() {
  if (!_openPopoverId || !_openChipEl) return;
  const popover = document.getElementById(_openPopoverId);
  if (!popover) return;
  positionPopover(popover, _openChipEl);
}
