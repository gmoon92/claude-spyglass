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

export function showError(msg) {
  document.getElementById('errorMsg').textContent = msg || '서버에 연결할 수 없습니다.';
  document.getElementById('errorBanner').classList.add('visible');
  const b = document.getElementById('liveBadge');
  b.className = 'badge-live disconnected';
  b.innerHTML = '<span class="dot"></span>OFFLINE';
}

export function clearError() {
  document.getElementById('errorBanner').classList.remove('visible');
  const b = document.getElementById('liveBadge');
  b.className = 'badge-live';
  b.innerHTML = '<span class="dot"></span>LIVE';
}

export function setLastUpdated() {
  document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString('ko-KR');
}
