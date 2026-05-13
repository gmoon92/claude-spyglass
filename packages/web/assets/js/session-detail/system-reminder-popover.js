/**
 * system-reminder-popover.js — system-reminder 칩 ↔ 팝오버 인터랙션 SSoT.
 *
 * 책임 (디자인 명세 design-spec.md §5):
 *  - 칩 클릭 / Enter / Space → 팝오버 토글 + aria-expanded 동기화.
 *  - 한 시점에 최대 1개 팝오버만 열린 상태 유지 — 새로 열 때 기존은 즉시 닫힘.
 *  - 닫기 트리거: × 버튼, Escape, anchor 외부 mousedown.
 *  - 닫힐 때 focus는 원래 칩으로 복귀 (시각 흐름 유지).
 *  - viewport 오른쪽을 넘어가는 팝오버는 .is-right-anchored modifier로 우정렬 보정.
 *
 * 비책임:
 *  - 마크업 생성: turn-views.js의 buildSystemReminderChip 단일 책임.
 *  - 데이터 dedup/diff: session-detail/system-reminder.js 단일 책임.
 *  - 시각·애니메이션: turn-view.css 룰. JS는 클래스/속성 토글만.
 *
 * 호출자: main.js initSystemReminderPopover() — 부트스트랩 시 1회 등록.
 *
 * 모듈 부수효과: document 레벨 click·mousedown·keydown 리스너 1조만 등록.
 *  - capture 단계 mousedown은 외부 클릭 닫기용 (팝오버 안 클릭은 click 단계에서 처리).
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

let _openPopoverId = null;     // 현재 열린 popover element id (한 시점에 1개)
let _openChipEl    = null;     // 현재 활성 칩 element ref — 닫힐 때 focus 복귀용
let _bound         = false;    // 리스너 중복 등록 방지

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
  // anchor 내부 클릭은 무시 — 토글/닫기 동작은 click 단계에서 처리됨.
  const anchor = e.target.closest?.('.turn-system-reminder-anchor');
  const popover = document.getElementById(_openPopoverId);
  if (anchor && popover && anchor.contains(popover)) return;
  // 외부 클릭으로 판정 — 닫음
  closePopover(_openPopoverId);
}

/**
 * 팝오버 열기 — 기존 열린 팝오버는 먼저 닫고 단일 open 상태 유지.
 *  - aria-expanded 칩 동기화.
 *  - 오른쪽 viewport 넘어가면 .is-right-anchored 부착.
 *  - dialog focus 이동(tabindex=-1).
 */
function openPopover(popoverId, chipEl) {
  if (_openPopoverId && _openPopoverId !== popoverId) {
    closePopover(_openPopoverId);
  }
  const popover = document.getElementById(popoverId);
  if (!popover) return;

  popover.hidden = false;
  // 측정은 render 1프레임 이후가 가장 정확하지만, hidden 해제만으로 즉시 layout이 잡힌다.
  // viewport 우측 8px 안전 마진을 두고 오른쪽 넘침 검사.
  popover.classList.remove('is-right-anchored');
  const rect = popover.getBoundingClientRect();
  if (rect.right > window.innerWidth - 8) {
    popover.classList.add('is-right-anchored');
  }

  chipEl?.setAttribute('aria-expanded', 'true');
  _openPopoverId = popoverId;
  _openChipEl = chipEl ?? null;

  // 다이얼로그 focus — Tab 트랩은 두지 않음(시각적 위계가 명확하고 본문은 비대화형).
  popover.focus({ preventScroll: true });
}

/**
 * 팝오버 닫기 — focus는 원래 칩으로 복귀.
 *  - 인자 popoverId가 현재 open과 다르면 noop (외부에서 잘못 호출 방지).
 */
function closePopover(popoverId) {
  if (!popoverId || _openPopoverId !== popoverId) return;
  const popover = document.getElementById(popoverId);
  if (popover) {
    popover.hidden = true;
    popover.classList.remove('is-right-anchored');
  }
  if (_openChipEl) {
    _openChipEl.setAttribute('aria-expanded', 'false');
    // focus 복귀 — 키보드 사용자의 흐름 유지.
    _openChipEl.focus({ preventScroll: true });
  }
  _openPopoverId = null;
  _openChipEl = null;
}
