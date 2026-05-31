// 인프라 모듈 — 에러 표시, 상태 배지, 스크롤 락 (외부 의존 없음)
// Wave 8-B: ↓ 글리프를 svgChevron SVG로 교체 (innerHTML 사용).
import { svgChevron } from './design-system/icons/chevron.js';
import { asEl } from './dom.js';

let _scrollLockNewCount = 0;

export function getScrollLockCount()  { return _scrollLockNewCount; }
export function addScrollLockCount()  { _scrollLockNewCount++; }
export function resetScrollLockCount() { _scrollLockNewCount = 0; }

export function updateScrollLockBanner() {
  const banner = document.getElementById('scrollLockBanner');
  if (!banner) return;
  if (_scrollLockNewCount > 0) {
    const t = window.I18n?.t ?? ((k) => k);
    banner.innerHTML = `${svgChevron({ dir: 'down', size: 10 })} ${t('ui.infra.new-requests-banner', { count: _scrollLockNewCount })}`;
    banner.classList.add('visible');
  } else {
    banner.classList.remove('visible');
  }
}

export function jumpToLatest() {
  const feedBody = document.getElementById('feedBody');
  if (feedBody) feedBody.scrollTo({ top: 0, behavior: 'smooth' });
  _scrollLockNewCount = 0;
  updateScrollLockBanner();
}

/**
 * LIVE 배지 연결 상태 토글 — brand-strip-cleanup ADR-001 이후 no-op.
 *
 * brand-strip 제거로 #liveBadge DOM 노드가 더 이상 존재하지 않으므로 early return.
 * 함수 시그너처는 외부 호출자(showError / clearError) 호환을 위해 보존.
 * SSE 연결 상태는 #errorBanner 및 obs-panel.LivePulse 카드로 일원화됨.
 */
export function setLiveStatus(connected: boolean) {
  const b = document.getElementById('liveBadge');
  if (!b) return; // brand-strip-cleanup ADR-001: liveBadge 노드가 제거되어 사실상 no-op.
  b.className = connected ? 'badge-live' : 'badge-live disconnected';
}

export function showError(msg: string) {
  const t = window.I18n?.t ?? ((k) => k);
  asEl(document.getElementById('errorMsg')).textContent = msg || t('common.server-unavailable');
  asEl(document.getElementById('errorBanner')).classList.add('visible');
  setLiveStatus(false);
}

export function clearError() {
  asEl(document.getElementById('errorBanner')).classList.remove('visible');
  setLiveStatus(true);
}

