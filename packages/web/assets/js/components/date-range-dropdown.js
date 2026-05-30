// components/date-range-dropdown.js — 날짜 범위 드롭다운 컴포넌트.
//
// 책임 (date-range-filter ADR-005/006):
//   - combobox(trigger) + listbox(menu) + option(item) 패턴 (WAI-ARIA 1.2)
//   - 프리셋 6개: 1h / today / yesterday / 7d / 30d / all  (custom은 T-13에서 footer로 확장)
//   - 키보드: 트리거 Enter/Space=열기, ↑↓=항목 이동(aria-activedescendant), Enter=선택,
//             Esc=닫고 트리거 포커스 복귀, Tab=외부 이동(트랩 금지 — modal 아님)
//   - 외부 클릭 닫기, scroll/resize 시 위치 재계산
//   - 트리거 라벨/aria-selected 동기화는 'cs:active-range-changed' 단일 이벤트 구독
//
// SSoT 관계:
//   - 활성 range:  api.js _activeRange / setActiveRange / getActiveRange
//   - 위치 계산:   util/floating-position.js (positionFloating, attachFloating)
//   - 시각 어휘:   design-system/primitives/dropdown.css (.ds-dropdown*)
//   - i18n 라벨:  ui.main.date-filter.<value>.{label,title} + trigger-aria

import { setActiveRange, getActiveRange } from '../api.js';
import { escHtml } from '../formatters.js';
import { asEl } from '../dom.js';
import { attachFloating } from '../util/floating-position.js';
import { formatDateRangeLabel } from '../i18n-utils.js';

// 프리셋 순서 — 의미 그룹: 최근 → 캘린더(오늘/어제) → 롤링 장기 → 전체
const PRESETS = ['1h', 'today', 'yesterday', '7d', '30d', 'all'];

// Custom Range 90일 가드 (ADR-004)
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/** value에 대응하는 i18n 라벨/타이틀 (지연 평가 — locale 전환 시 즉시 반영). */
function tLabel(value) { return window.I18n.t(`ui.main.date-filter.${value}.label`); }
function tTitle(value) { return window.I18n.t(`ui.main.date-filter.${value}.title`); }
function t(key) { return (typeof window !== 'undefined' && window.I18n?.t?.(key)) || key; }
function tTriggerAria() {
  const aria = window.I18n.t('ui.main.date-filter.trigger-aria');
  return aria || 'Select date range';
}

// ISO YYYY-MM-DD → 로컬 자정 ms (input[type=date]는 항상 ISO 반환)
function isoDateToLocalMs(iso, endOfDay = false) {
  if (!iso) return NaN;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return NaN;
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  if (endOfDay) dt.setHours(23, 59, 59, 999);
  return dt.getTime();
}

// 로컬 Date → YYYY-MM-DD (input[type=date]에 셋팅하는 형식)
function localDateToIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 컨테이너에 드롭다운을 mount. 외부 호출자가 컴포넌트 라이프사이클을 제어 가능하도록
 * dispose 함수를 반환한다 (이벤트 리스너 해제 + DOM 정리).
 *
 * @param {HTMLElement} container
 * @returns {() => void} dispose
 */
export function mountDateRangeDropdown(container) {
  if (!container) return () => {};

  const idBase = 'cs-date-range';
  const triggerId = `${idBase}-trigger`;
  const menuId    = `${idBase}-menu`;

  container.innerHTML = renderShell({ triggerId, menuId });
  const trigger = /** @type {HTMLElement} */ (container.querySelector(`#${triggerId}`));
  const menu    = /** @type {HTMLElement} */ (container.querySelector(`#${menuId}`));
  const labelEl = trigger.querySelector('.ds-dropdown-trigger-label');
  const fromInput = /** @type {HTMLInputElement} */ (menu.querySelector('[data-role="custom-from"]'));
  const toInput   = /** @type {HTMLInputElement} */ (menu.querySelector('[data-role="custom-to"]'));
  const applyBtn  = /** @type {HTMLButtonElement} */ (menu.querySelector('[data-role="custom-apply"]'));
  const warnEl    = /** @type {HTMLElement} */ (menu.querySelector('[data-role="custom-warn"]'));

  /** @type {(() => void) | null} */
  let detachPos = null;
  let activeIdx = -1;
  let isOpen = false;

  // ── 라벨/aria-selected 동기화 ─────────────────────────────────────────────
  function syncFromState() {
    const ar = getActiveRange();
    const isCustom = ar.type === 'custom';
    const value = isCustom ? 'custom' : ar.value;
    labelEl.textContent = isCustom ? formatDateRangeLabel(ar.from, ar.to) : tLabel(value);
    trigger.setAttribute('aria-label', tTriggerAria());
    trigger.setAttribute('title', isCustom ? '' : tTitle(value));
    // 항목 aria-selected — 프리셋 항목 중에서만 (custom 항목 자체는 listbox에 없음)
    for (const item of menu.querySelectorAll('.ds-dropdown-item[role="option"]')) {
      const v = asEl(item).dataset.value;
      item.setAttribute('aria-selected', String(v === value));
    }
  }

  // ── Custom Range 입력 검증 + 경고 갱신 ────────────────────────────────────
  function refreshCustomValidity() {
    const from = isoDateToLocalMs(fromInput.value, false);
    const to   = isoDateToLocalMs(toInput.value, true);
    const fromValid = Number.isFinite(from);
    const toValid   = Number.isFinite(to);
    const orderValid = fromValid && toValid && from <= to;
    applyBtn.disabled = !orderValid;
    // 90일 초과 경고 — Apply는 계속 가능 (가드만 노출)
    if (orderValid && (to - from) > NINETY_DAYS_MS) {
      warnEl.textContent = t('ui.main.date-filter.custom.warn-long-range');
      warnEl.hidden = false;
    } else {
      warnEl.hidden = true;
      warnEl.textContent = '';
    }
  }

  function applyCustomRange() {
    const from = isoDateToLocalMs(fromInput.value, false);
    const to   = isoDateToLocalMs(toInput.value, true);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return;
    setActiveRange({ type: 'custom', from, to });
    closeMenu({ returnFocus: true });
  }

  // ── 항목 활성 하이라이트 (aria-activedescendant) ─────────────────────────
  function setActiveIdx(idx) {
    const items = menu.querySelectorAll('.ds-dropdown-item[role="option"]');
    if (!items.length) return;
    const next = (idx + items.length) % items.length;
    activeIdx = next;
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle('is-active', i === next);
    }
    trigger.setAttribute('aria-activedescendant', items[next].id);
    items[next].scrollIntoView({ block: 'nearest' });
  }

  // ── open / close ─────────────────────────────────────────────────────────
  function openMenu() {
    if (isOpen) return;
    isOpen = true;
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    // 현재 선택을 active 항목으로 시작
    const items = Array.from(menu.querySelectorAll('.ds-dropdown-item[role="option"]'));
    const selIdx = items.findIndex((el) => el.getAttribute('aria-selected') === 'true');
    setActiveIdx(selIdx >= 0 ? selIdx : 0);
    // 위치 계산 + scroll/resize 자동 재배치
    detachPos = attachFloating(trigger, menu, { align: 'end', preferBelow: true });
    // 외부 클릭 / Esc 글로벌 핸들러
    document.addEventListener('mousedown', onDocMousedown, true);
    document.addEventListener('keydown', onDocKeydown, true);
  }

  function closeMenu({ returnFocus = false } = {}) {
    if (!isOpen) return;
    isOpen = false;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    activeIdx = -1;
    if (detachPos) { detachPos(); detachPos = null; }
    document.removeEventListener('mousedown', onDocMousedown, true);
    document.removeEventListener('keydown', onDocKeydown, true);
    if (returnFocus) trigger.focus();
  }

  function selectActiveItem() {
    const items = menu.querySelectorAll('.ds-dropdown-item[role="option"]');
    const item = items[activeIdx];
    if (!item) return;
    if (item.getAttribute('aria-disabled') === 'true') return;
    setActiveRange(asEl(item).dataset.value);
    closeMenu({ returnFocus: true });
  }

  // ── 이벤트 핸들러 ────────────────────────────────────────────────────────
  function onTriggerClick(e) {
    e.preventDefault();
    if (isOpen) closeMenu({ returnFocus: true });
    else openMenu();
  }

  function onTriggerKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) openMenu();
      else if (e.key === 'ArrowDown') setActiveIdx(activeIdx + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) openMenu();
      else setActiveIdx(activeIdx - 1);
    }
  }

  function onMenuClick(e) {
    const item = e.target.closest('.ds-dropdown-item[role="option"]');
    if (!item) return;
    const value = item.dataset.value;
    setActiveRange(value);
    closeMenu({ returnFocus: true });
  }

  function onDocKeydown(e) {
    if (!isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu({ returnFocus: true });
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(activeIdx + 1); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(activeIdx - 1); return; }
    if (e.key === 'Enter')     { e.preventDefault(); selectActiveItem(); return; }
    if (e.key === 'Home')      { e.preventDefault(); setActiveIdx(0); return; }
    if (e.key === 'End') {
      e.preventDefault();
      const items = menu.querySelectorAll('.ds-dropdown-item[role="option"]');
      setActiveIdx(items.length - 1);
    }
  }

  function onDocMousedown(e) {
    if (!isOpen) return;
    if (trigger.contains(e.target) || menu.contains(e.target)) return;
    closeMenu();
  }

  function onRangeChanged() { syncFromState(); }

  // ── 등록 ─────────────────────────────────────────────────────────────────
  trigger.addEventListener('click', onTriggerClick);
  trigger.addEventListener('keydown', onTriggerKeydown);
  menu.addEventListener('click', onMenuClick);
  fromInput.addEventListener('input', refreshCustomValidity);
  toInput.addEventListener('input', refreshCustomValidity);
  applyBtn.addEventListener('click', applyCustomRange);
  document.addEventListener('cs:active-range-changed', onRangeChanged);

  // 사용자 편의 (피드백 반영): Custom Range 기본값을 한 달 전 ~ 오늘로 셋팅.
  // 빈 input보다 잡힌 값이 있으면 Apply 즉시 활성화 + 조정만 하면 되어 UX 향상.
  // 사용자가 한 번 입력하면 그 값을 유지 (open마다 덮어쓰지 않음 — mount 시 1회).
  (function setDefaultCustomDates() {
    const today = new Date();
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);
    fromInput.value = localDateToIso(monthAgo);
    toInput.value   = localDateToIso(today);
  })();

  refreshCustomValidity();
  syncFromState();

  // ── dispose ──────────────────────────────────────────────────────────────
  return () => {
    closeMenu();
    trigger.removeEventListener('click', onTriggerClick);
    trigger.removeEventListener('keydown', onTriggerKeydown);
    menu.removeEventListener('click', onMenuClick);
    fromInput.removeEventListener('input', refreshCustomValidity);
    toInput.removeEventListener('input', refreshCustomValidity);
    applyBtn.removeEventListener('click', applyCustomRange);
    document.removeEventListener('cs:active-range-changed', onRangeChanged);
    container.innerHTML = '';
  };
}

// ── 마크업 렌더 ─────────────────────────────────────────────────────────────
function renderShell({ triggerId, menuId }) {
  const listboxId = `${menuId}-listbox`;
  const optionsHtml = PRESETS.map((value, i) => {
    const optId = `${triggerId}-opt-${i}`;
    const label = escHtml(tLabel(value));
    const title = escHtml(tTitle(value));
    return `<li id="${optId}" role="option" class="ds-dropdown-item" data-value="${value}" aria-selected="false" title="${title}">${label}</li>`;
  }).join('');

  // Custom Range footer (role=group) — listbox 외부 (ADR-005: listbox 내부 input 금지)
  const fromLbl  = escHtml(t('ui.main.date-filter.custom.from'));
  const toLbl    = escHtml(t('ui.main.date-filter.custom.to'));
  const applyLbl = escHtml(t('ui.main.date-filter.custom.apply'));
  const customLbl = escHtml(t('ui.main.date-filter.custom.label'));
  const footerHtml = `
    <div class="ds-dropdown-footer" role="group" aria-label="${customLbl}">
      <label class="ds-dropdown-footer-field">
        <span class="ds-dropdown-footer-label-text">${fromLbl}</span>
        <input type="date" data-role="custom-from" />
      </label>
      <label class="ds-dropdown-footer-field">
        <span class="ds-dropdown-footer-label-text">${toLbl}</span>
        <input type="date" data-role="custom-to" />
      </label>
      <div class="ds-dropdown-footer-warn" data-role="custom-warn" hidden></div>
      <button type="button" class="ds-dropdown-footer-apply" data-role="custom-apply" disabled>${applyLbl}</button>
    </div>
  `;

  return `
    <div class="ds-dropdown" data-component="date-range-dropdown">
      <button
        id="${triggerId}"
        type="button"
        class="ds-dropdown-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded="false"
        aria-controls="${listboxId}"
      ><span class="ds-dropdown-trigger-label"></span></button>
      <div
        id="${menuId}"
        class="ds-dropdown-menu"
        hidden
      ><ul
          id="${listboxId}"
          role="listbox"
          class="ds-dropdown-listbox"
          aria-labelledby="${triggerId}"
        >${optionsHtml}</ul>${footerHtml}</div>
    </div>
  `;
}
