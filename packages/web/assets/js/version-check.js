/**
 * 버전 체크 + 업데이트 UI — /api/version, /api/update.
 *
 * 변경 이유: 배지 노출·모달 제어·업데이트 API 호출 로직 변경 시 한 곳만 수정.
 */

const API = '';

const els = {
  badge: document.getElementById('updateBadge'),
  modal: document.getElementById('updateModal'),
  currentVersion: document.getElementById('updateCurrentVersion'),
  latestVersion: document.getElementById('updateLatestVersion'),
  cancelBtn: document.getElementById('updateModalCancel'),
  confirmBtn: document.getElementById('updateModalConfirm'),
  closeBtn: document.getElementById('updateModalClose'),
  actions: document.getElementById('updateModalActions'),
  error: document.getElementById('updateModalError'),
  success: document.getElementById('updateModalSuccess'),
};

let cache = null;
let isUpdating = false;

/**
 * 버전 태그 정규화 — 표시·비교 용도로 동일성을 안전하게 판정한다.
 *
 * 입력 예: ` v1.2.3 `, `1.2.3`, `V1.2.3` → 모두 `1.2.3` 으로 정규화.
 * falsy/non-string 입력은 빈 문자열로 환원해 `'' === ''` 매칭을 막는 가드와 함께 사용.
 *
 * update-badge-fix ADR-001: 서버가 `updateAvailable: true`로 응답하더라도
 * 정규화 결과가 같으면 클라이언트가 표시를 막아 무의미한 모달 노출을 방지한다.
 */
function normalizeTag(s) {
  if (typeof s !== 'string') return '';
  return s.trim().replace(/^[vV]/, '');
}

/**
 * 현재/최신 버전이 사실상 동일한지 — 정규화 후 비교 + 빈 문자열 매칭 제외.
 */
function isSameVersion(currentVersion, latestTag) {
  const c = normalizeTag(currentVersion);
  const l = normalizeTag(latestTag);
  return Boolean(c) && c === l;
}

/**
 * i18n 안전 번역 — 키가 namespace 미로딩 등으로 키 자체를 돌려주면 fallback 사용.
 * (한국어 fallback은 다국어 사용자 환경에서 브랜드 일관성 저하 → 영어 raw 사용)
 */
function tSafe(key, params, fallback) {
  const translated = window.I18n?.t?.(key, params) ?? '';
  return (translated && translated !== key) ? translated : fallback;
}

/**
 * 배지 상태를 단일 진입점으로 적용한다 — 모디파이어 클래스 + 라벨 + ARIA를 한 번에 갱신.
 *
 * ADR-001/004: 상태 분기 로직은 본 함수 한 곳에만 존재. 호출 측에서 boolean을 재계산하지 않고
 * raw 데이터(currentVersion, latestTag, updateAvailable)를 그대로 넘긴다.
 *
 * @param {'available'|'latest'|'loading'} state
 * @param {{ currentVersion?: string, latestTag?: string }} [payload]
 */
function applyBadgeState(state, payload = {}) {
  const badge = els.badge;
  if (!badge) return;

  // 1) 모디파이어 클래스 토글 (CSS가 톤 + 아이콘을 분기)
  badge.classList.toggle('update-badge--available', state === 'available');
  badge.classList.toggle('update-badge--latest',    state === 'latest');
  badge.classList.toggle('update-badge--loading',   state === 'loading');

  // 2) 라벨 / ARIA 결정
  const textEl = badge.querySelector('.update-badge-text');
  let label = '';
  let aria  = '';

  if (state === 'available') {
    const tag = payload.latestTag ?? '';
    label = tSafe('ui.version-check.available', { tag }, `${tag} available`);
    aria  = tSafe('ui.html.chart-section.update-badge-aria-available', { tag: normalizeTag(tag) }, `Update available — v${normalizeTag(tag)}`);
  } else if (state === 'latest') {
    // latest는 현재 버전을 명시 — 사용자에게 "내 빌드가 무엇인지" 확신을 준다
    const tag = payload.currentVersion ?? payload.latestTag ?? '';
    const tagN = normalizeTag(tag);
    label = tSafe('ui.version-check.latest', { tag: `v${tagN}` }, `v${tagN} · Up to date`);
    aria  = tSafe('ui.html.chart-section.update-badge-aria-latest', { tag: tagN }, `Up to date — v${tagN}`);
  } else {
    // loading — placeholder
    label = tSafe('ui.version-check.loading', null, 'Checking…');
    aria  = tSafe('ui.html.chart-section.update-badge-aria-loading', null, 'Checking for updates');
  }

  if (textEl) textEl.textContent = label;
  else badge.textContent = label;
  badge.setAttribute('aria-label', aria);
}

/**
 * 캐시된 버전 정보를 가져와 배지 상태를 갱신한다.
 *
 * update-badge-dual-state: 배지는 항상 노출된다. fetch 성공/실패/응답 미수신 어떤 경우든
 * applyBadgeState로 통일된 상태(available / latest / loading)를 적용한다.
 * `badge.hidden`은 본 함수가 더 이상 제어하지 않는다.
 */
async function refreshBadge() {
  try {
    const res = await fetch(`${API}/api/version`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      // HTTP 오류 — 캐시가 있다면 그 값을 latest로 표기, 없다면 loading 유지
      if (cache?.currentVersion) applyBadgeState('latest', cache);
      return;
    }
    const json = await res.json();
    if (!json.success || !json.data) {
      if (cache?.currentVersion) applyBadgeState('latest', cache);
      return;
    }
    cache = json.data;

    // ADR-001: 서버 updateAvailable=true 라도 정규화된 currentVersion === latestTag 면
    // 같은 버전 → latest로 처리. 무의미한 모달 노출 방지.
    const sameVersion = isSameVersion(cache.currentVersion, cache.latestTag);
    const isAvailable = Boolean(cache.updateAvailable && cache.latestTag && !sameVersion);
    applyBadgeState(isAvailable ? 'available' : 'latest', cache);
  } catch {
    // 네트워크 불능 — 캐시된 버전이 있다면 그 값을 latest로 보여주고,
    // 없으면 loading 상태 유지 (배지는 사라지지 않는다)
    if (cache?.currentVersion) applyBadgeState('latest', cache);
  }
}

function openModal() {
  // update-badge-dual-state ADR-003:
  // 배지는 항상 노출되므로 클릭 가능 여부는 모디파이어 클래스로 판정한다.
  // .update-badge--available 가 없으면 latest/loading 상태 → noop.
  if (!els.badge?.classList.contains('update-badge--available')) return;

  if (!cache || !cache.updateAvailable) {
    // stale 가드 — 클래스는 available이지만 캐시가 비어있는 극단 케이스
    applyBadgeState('latest', cache ?? {});
    return;
  }
  // ADR-001 이중 방어: 동일 버전이면 모달 차단 + 상태 정정
  if (isSameVersion(cache.currentVersion, cache.latestTag)) {
    applyBadgeState('latest', cache);
    return;
  }
  els.currentVersion.textContent = cache.currentVersion ?? '—';
  els.latestVersion.textContent = cache.latestTag ?? '—';
  els.error.hidden = true;
  els.success.hidden = true;
  els.actions.hidden = false;
  els.modal.classList.add('open');
}

function closeModal() {
  els.modal.classList.remove('open');
}

function showError(msg) {
  els.error.textContent = msg;
  els.error.hidden = false;
  els.success.hidden = true;
}

function showSuccess(msg) {
  els.success.textContent = msg;
  els.success.hidden = false;
  els.error.hidden = true;
}

function setLoading(loading) {
  isUpdating = loading;
  els.confirmBtn.disabled = loading;
  els.cancelBtn.disabled = loading;
  if (loading) {
    els.confirmBtn.innerHTML = `<span class="update-modal-spinner"></span>${window.I18n.t('ui.version-check.updating')}`;
  } else {
    els.confirmBtn.textContent = window.I18n.t('ui.version-check.confirm');
  }
}

async function doUpdate() {
  if (isUpdating) return;
  setLoading(true);
  try {
    const res = await fetch(`${API}/api/update`, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json();

    if (res.status === 409 && json.error === 'local_changes') {
      showError(window.I18n.t('ui.version-check.local-changes-error'));
      setLoading(false);
      return;
    }

    if (!json.success) {
      showError(json.error || window.I18n.t('ui.version-check.update-failed'));
      setLoading(false);
      return;
    }

    // 성공
    cache = json.data;
    els.currentVersion.textContent = cache.currentVersion ?? '—';
    els.latestVersion.textContent = cache.latestTag ?? '—';
    els.actions.hidden = true;
    setLoading(false);
    // update-badge-dual-state: 업데이트 성공 후엔 배지를 숨기지 않고 latest 상태로 전환 —
    // 사용자는 "이제 내 빌드가 최신"이라는 즉시 피드백을 받는다.
    applyBadgeState('latest', cache);

    // 서버가 자동 재시작을 예고했으면 polling으로 부활 감지 후 자동 새로고침.
    if (cache?.restarting) {
      showSuccess(tSafe('ui.version-check.restarting', null, 'Update complete. Restarting server…'));
      waitForServerAndReload();
    } else {
      showSuccess(window.I18n.t('ui.version-check.success'));
    }
  } catch (err) {
    showError(window.I18n.t('ui.version-check.network-error', { message: err.message || window.I18n.t('ui.version-check.update-request-failed') }));
    setLoading(false);
  }
}

/**
 * 서버 자동 재시작 흐름:
 *  1) /api/update 응답에 restarting:true 가 오면 호출.
 *  2) 1초 후부터 /api/version 을 1초 간격으로 폴링.
 *  3) 응답이 정상으로 돌아오면 "재시작 완료" 메시지 후 1초 뒤 location.reload().
 *  4) 최대 30회(약 30초) 시도 — 그래도 안 깨어나면 수동 안내.
 */
function waitForServerAndReload() {
  let attempts = 0;
  const maxAttempts = 30;

  const tick = async () => {
    attempts += 1;
    try {
      const res = await fetch(`${API}/api/version`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        showSuccess(tSafe('ui.version-check.restart-complete', null, 'Restart complete. Reloading…'));
        setTimeout(() => window.location.reload(), 800);
        return;
      }
    } catch {
      // 재시작 중이라 연결 거부 — 정상. 다시 시도.
    }
    if (attempts >= maxAttempts) {
      showError(tSafe('ui.version-check.restart-timeout', null, 'Server did not come back. Please reload manually.'));
      return;
    }
    setTimeout(tick, 1000);
  };

  setTimeout(tick, 1000);
}

export function initVersionCheck() {
  if (!els.badge || !els.modal) return;

  // update-badge-dual-state: i18n 로딩 직후 raw 'Checking…' placeholder를 i18n 번역으로 즉시 갱신.
  // HTML 초기 마크업이 이미 .update-badge--loading 모디파이어를 가지므로 상태 토글은 불필요.
  applyBadgeState('loading');

  // 페이지 로드 시 1회 + 이후 10분마다 (서버는 1시간마다 캐시 갱신)
  refreshBadge();
  setInterval(refreshBadge, 10 * 60 * 1000);

  els.badge.addEventListener('click', openModal);
  els.cancelBtn.addEventListener('click', closeModal);
  els.confirmBtn.addEventListener('click', doUpdate);
  els.closeBtn?.addEventListener('click', closeModal);

  // 배경 클릭 시 닫힘
  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) closeModal();
  });

  // ESC 키로 닫힘
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.modal.classList.contains('open')) {
      closeModal();
    }
  });
}

