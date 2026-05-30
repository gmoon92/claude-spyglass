/**
 * app-rail.js — 좌측 앱 모드 rail (ADR-003 left-rail-meta-docs)
 *
 * 책임:
 *  - rail 컨테이너(.app-rail) 안의 모드 버튼 클릭 위임.
 *  - data-app-mode="browse" → applyAppMode('browse')
 *  - data-app-mode="metadocs" → applyAppMode('metadocs') (메타 모드 진입)
 *  - aria-current="page" 토글 (현재 활성 모드 1개).
 *
 * 호출자:
 *  - main.js 진입 시 init() 호출 → rail 클릭 핸들러 등록 + sessionStorage 복원분 반영.
 *
 * 의존성:
 *  - state.js: getAppMode (sessionStorage 복원 결과)
 *  - main.js: applyAppMode (실제 view 가시성 적용 — 주입식으로 받음)
 *
 * 단일 책임:
 *  - rail이 직접 view를 manipulate하지 않음. applyAppMode 콜백에 raw mode 값만 전달.
 *  - CLAUDE.md 캡슐화: 호출 측 분기 없이 raw event → 내부에서 모드 판단.
 */

import { getAppMode } from './state.js';

const RAIL_SELECTOR = '.app-rail';

/**
 * rail 초기화 — 클릭 위임 + 페이지 로드 시 현재 모드에 맞춰 aria-current 설정.
 *
 * @param {(mode: 'browse' | 'metadocs' | 'settings') => void} applyAppMode
 *        main.js의 applyAppMode 헬퍼. rail은 직접 view를 만지지 않고 콜백에 위임.
 */
export function initAppRail(applyAppMode) {
  const rail = document.querySelector(RAIL_SELECTOR);
  if (!rail) return;

  // 클릭 위임 — 버튼 자체에 data-app-mode 속성 부여
  //   settings-page (2026-05-26): 'settings' 모드도 동등하게 위임.
  rail.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-app-mode]');
    if (!btn || !rail.contains(btn)) return;
    const mode = btn.dataset.appMode;
    if (mode !== 'browse' && mode !== 'metadocs' && mode !== 'settings') return;
    applyAppMode(mode);
  });

  // 페이지 로드 시 현재 모드(sessionStorage 복원분 포함)를 aria-current에 반영
  syncRailButtons(rail, getAppMode());
}

/**
 * rail 버튼 aria-current 토글 — applyAppMode 적용 후 호출.
 *
 * @param {'browse' | 'metadocs' | 'settings'} mode
 */
export function setRailActive(mode) {
  const rail = document.querySelector(RAIL_SELECTOR);
  if (!rail) return;
  syncRailButtons(rail, mode);
}

function syncRailButtons(rail, mode) {
  rail.querySelectorAll('[data-app-mode]').forEach(btn => {
    const isActive = btn.dataset.appMode === mode;
    if (isActive) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}
