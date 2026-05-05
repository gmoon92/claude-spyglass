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
 * LIVE 배지 연결 상태 갱신 (header-summary-merge ADR-007).
 * SSoT: liveBadge 안의 chip(`#activeCard` / `#statActive`)은 보존하고 라벨/클래스만 토글.
 * 이전엔 innerHTML 통째 덮어쓰기로 chip을 날려서 fetchDashboard 재호출 시 null 참조 에러 발생.
 */
export function setLiveStatus(connected) {
  const b = document.getElementById('liveBadge');
  if (!b) return;
  b.className = connected ? 'badge-live' : 'badge-live disconnected';
  const label = b.querySelector('.badge-live-label');
  if (label) label.textContent = connected ? 'LIVE' : 'OFFLINE';
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

