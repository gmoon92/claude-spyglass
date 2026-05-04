// views/default/keyboard.js — 전역 키보드 단축키 + KBD 도움말 모달 (D축)
//
// 변경 이유: 사용자 키 입력 → 액션 디스패치. ESC 우선순위 정책, /·?·1-7 등
// 단축키 정의는 모두 여기에 있다. 검색 박스/필터 바 핸들은 클로저로 받지
// 않고 getter 로 주입받아, 부트스트랩이 모듈 등록 순서를 맘대로 정해도
// 역방향 의존이 생기지 않도록 한다.

import { getRightView, getFeedFilterBar, getDetailFilterBar } from '../../state.js';
import { detailSearchBox } from '../../session-detail.js';
import { KBD_HELP_BACKDROP_ID } from './constants.js';

// ── 도움말 모달 ───────────────────────────────────────────────────────────────
function isKbdHelpVisible() {
  return document.getElementById(KBD_HELP_BACKDROP_ID)?.classList.contains('visible');
}

function showKbdHelp() {
  document.getElementById(KBD_HELP_BACKDROP_ID)?.classList.add('visible');
}

function hideKbdHelp() {
  document.getElementById(KBD_HELP_BACKDROP_ID)?.classList.remove('visible');
}

function toggleKbdHelp() {
  if (isKbdHelpVisible()) hideKbdHelp();
  else showKbdHelp();
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

/**
 * 키보드 단축키 + KBD 도움말 모달 wiring.
 *
 * @param {{
 *   getFeedSearchBox: () => { element: () => HTMLElement } | null,
 *   onCloseDetail: () => void,
 * }} opts
 */
export function wireKeyboard({ getFeedSearchBox, onCloseDetail }) {
  function activeSearchInput() {
    const box = getRightView() === 'detail' ? detailSearchBox : getFeedSearchBox();
    return box?.element() ?? null;
  }

  function activeTypeFilterButtons() {
    return (getRightView() === 'detail' ? getDetailFilterBar() : getFeedFilterBar())?.buttons()
      ?? document.querySelectorAll('.type-filter-btn-none');
  }

  function focusActiveSearch() {
    const el = activeSearchInput();
    if (el) { el.focus(); el.select?.(); }
  }

  function triggerFilterByIndex(idx) {
    const btns = activeTypeFilterButtons();
    if (idx >= 0 && idx < btns.length) btns[idx].click();
  }

  // ESC 우선순위: 모달 → 확장 패널 → 검색 클리어 → detail 닫기
  function handleEscape() {
    if (isKbdHelpVisible()) { hideKbdHelp(); return; }
    const expandRow = document.querySelector('[data-expand-for]');
    if (expandRow) { expandRow.remove(); return; }
    const searchInput = activeSearchInput();
    if (searchInput && searchInput.value) {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (getRightView() === 'detail') { onCloseDetail(); return; }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { handleEscape(); e.preventDefault(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault(); focusActiveSearch(); return;
    }
    if (isTypingTarget(e.target)) return;
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault(); focusActiveSearch(); return;
    }
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault(); toggleKbdHelp(); return;
    }
    if (/^[1-7]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault(); triggerFilterByIndex(parseInt(e.key, 10) - 1); return;
    }
  });

  // KBD help modal trigger·close
  const backdrop = document.getElementById(KBD_HELP_BACKDROP_ID);
  if (backdrop) {
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) hideKbdHelp(); });
  }
  document.getElementById('kbdHelpClose')?.addEventListener('click', hideKbdHelp);
  document.getElementById('btnHelpOpen')?.addEventListener('click', toggleKbdHelp);
}
