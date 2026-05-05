// 인프라 모듈 — 에러 표시, 상태 배지, 스크롤 락 (외부 의존 없음)

let _scrollLockNewCount = 0;

export function getScrollLockCount()  { return _scrollLockNewCount; }
export function addScrollLockCount()  { _scrollLockNewCount++; }
export function resetScrollLockCount() { _scrollLockNewCount = 0; }

export function updateScrollLockBanner() {
  const banner = document.getElementById('scrollLockBanner');
  if (!banner) return;
  if (_scrollLockNewCount > 0) {
    banner.textContent = `↓ 새 요청 ${_scrollLockNewCount}개 — 클릭하여 최신으로 이동`;
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
 * LIVE 배지 연결 상태 토글.
 *
 * 마크업: `<span.badge-live>` 안에 펄스 도트 + 라이브 카운트(#statActive).
 * 연결 시 녹색·도트 펄스, 끊김 시 빨강·정적. "LIVE/OFFLINE" 글자는 펄스 도트가 이미
 * 시각화하므로 제거(시각 노이즈) — 상세 정의는 `data-stat-tooltip="active"` hover에서.
 */
export function setLiveStatus(connected) {
  const b = document.getElementById('liveBadge');
  if (!b) return;
  b.className = connected ? 'badge-live' : 'badge-live disconnected';
}

export function showError(msg) {
  document.getElementById('errorMsg').textContent = msg || '서버에 연결할 수 없습니다.';
  document.getElementById('errorBanner').classList.add('visible');
  setLiveStatus(false);
}

export function clearError() {
  document.getElementById('errorBanner').classList.remove('visible');
  setLiveStatus(true);
}

