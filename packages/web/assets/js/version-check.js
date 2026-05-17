/**
 * 버전 체크 + 업데이트 UI — /api/version, /api/update.
 *
 * 변경 이유: 배지 노출·모달 제어·업데이트 API 호출 로직 변경 시 한 곳만 수정.
 *
 * auto-update-migration-hardening 확장:
 *  - 모달 마이그레이션 결과 3분기(성공/변경없음/실패) 시각화 — applyMigrationResult() (T-08, ADR-004)
 *  - local-changes(409) 차단 안내 패널 — applyLocalChangesGuard() (T-09, ADR-007)
 *  - shallow clone 부팅 감지 → dashboard warning 토글 — applyShallowWarning() (T-10, ADR-007)
 *
 * 응답 contract(트랙 A 결정):
 *  GET  /api/version → { ..., dbUserVersion?, latestMigrationFile?, isShallowRepository? }
 *  POST /api/update  → { ..., migrationsApplied?: { from, to, files[], durationMs } }
 *  POST /api/update 409 → { error: 'local_changes', dirtyFiles?: string[] }
 *
 * 응답 필드는 모두 옵셔널 — 트랙 A 미적용 환경에서도 회귀 없이 자연 동작.
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
  // 마이그레이션 결과 영역 (T-08)
  migration: document.getElementById('updateModalMigration'),
  migrationLabel: document.getElementById('updateModalMigrationLabel'),
  migrationDuration: document.getElementById('updateModalMigrationDuration'),
  migrationDetail: document.getElementById('updateModalMigrationDetail'),
  migrationFiles: document.getElementById('updateModalMigrationFiles'),
  migrationFilesList: document.getElementById('updateModalMigrationFilesList'),
  // local-changes 패널 (T-09)
  localChanges: document.getElementById('updateModalLocalChanges'),
  localChangesFiles: document.getElementById('updateModalLocalChangesFiles'),
  localChangesFilesList: document.getElementById('updateModalLocalChangesFilesList'),
  // dashboard shallow warning (T-10)
  shallowWarn: document.getElementById('dashboardShallowWarning'),
  shallowWarnDismiss: document.getElementById('dashboardShallowWarningDismiss'),
};

const SHALLOW_DISMISS_KEY = 'spyglass:shallow-warning-dismissed';

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

// ─── T-10: shallow clone warning 토글 ─────────────────────────────────────────
/**
 * /api/version 응답의 `isShallowRepository` 플래그를 dashboard warning 표지로 반영.
 * - true & 미dismiss → 노출
 * - false 또는 dismiss 됨 → 비노출 (회귀 차단)
 *
 * 트랙 A 미적용 환경에서 필드가 undefined이면 비노출 (방어 코드).
 */
function applyShallowWarning(isShallow) {
  const el = els.shallowWarn;
  if (!el) return;
  const dismissed = (() => {
    try { return localStorage.getItem(SHALLOW_DISMISS_KEY) === '1'; } catch { return false; }
  })();
  const show = Boolean(isShallow) && !dismissed;
  el.hidden = !show;
}

// ─── T-08: 모달 마이그레이션 결과 3분기 시각화 ──────────────────────────────
/**
 * POST /api/update 응답의 `migrationsApplied`를 모달에 표시한다.
 *
 * 분기 규칙(트랙 A ADR-004):
 *  - undefined/null               → "변경 없음" (트랙 A 미적용 환경 호환 — 정보 부재로 가정)
 *  - from === to && files.length === 0 → "변경 없음" (스키마 변경 없음)
 *  - files.length > 0             → "성공" + 파일 리스트 토글
 *  - 별도 에러 응답               → "실패" (showMigrationFailure 별도 호출)
 *
 * @param {{ from?: number, to?: number, files?: string[], durationMs?: number } | null | undefined} ma
 */
function applyMigrationResult(ma) {
  const sec = els.migration;
  if (!sec) return;
  sec.hidden = false;

  // 파일 리스트 영역 리셋 (재진입 회귀 차단)
  if (els.migrationFiles) {
    els.migrationFiles.hidden = true;
    els.migrationFiles.removeAttribute('open');
  }
  if (els.migrationFilesList) els.migrationFilesList.innerHTML = '';

  // duration 영역 리셋
  if (els.migrationDuration) {
    els.migrationDuration.hidden = true;
    els.migrationDuration.textContent = '';
  }

  const hasResult = ma && typeof ma === 'object';
  const files = Array.isArray(ma?.files) ? ma.files : [];
  const from = Number.isFinite(ma?.from) ? ma.from : null;
  const to   = Number.isFinite(ma?.to)   ? ma.to   : null;
  const durationMs = Number.isFinite(ma?.durationMs) ? ma.durationMs : null;

  // 분기 1: 변경 없음
  const isEmpty = !hasResult || (files.length === 0 && (from === null || from === to));
  if (isEmpty) {
    sec.setAttribute('data-state', 'empty');
    if (els.migrationLabel) {
      els.migrationLabel.textContent = tSafe('ui.version-check.migration.none', null, 'No schema changes');
    }
    if (els.migrationDetail) {
      const version = to ?? from;
      if (version !== null) {
        els.migrationDetail.textContent = tSafe('ui.version-check.migration.none-detail', { version }, `DB v${version} · no migrations.`);
        els.migrationDetail.hidden = false;
      } else {
        els.migrationDetail.hidden = true;
      }
    }
    return;
  }

  // 분기 2: 성공 (files.length > 0)
  sec.setAttribute('data-state', 'success');
  const n = files.length;
  const fromS = from ?? '?';
  const toS = to ?? '?';
  const key = n === 1 ? 'ui.version-check.migration.applied-single' : 'ui.version-check.migration.applied';
  const fallback = n === 1
    ? `1 migration applied (v${fromS} → v${toS})`
    : `${n} migrations applied (v${fromS} → v${toS})`;
  if (els.migrationLabel) {
    els.migrationLabel.textContent = tSafe(key, { n, from: fromS, to: toS }, fallback);
  }
  if (els.migrationDetail) els.migrationDetail.hidden = true;
  if (durationMs !== null && els.migrationDuration) {
    els.migrationDuration.textContent = tSafe('ui.version-check.migration.duration', { ms: durationMs }, `${durationMs}ms`);
    els.migrationDuration.hidden = false;
  }
  // 파일 리스트 (접힘 가능)
  if (els.migrationFiles && els.migrationFilesList) {
    for (const f of files) {
      const li = document.createElement('li');
      li.className = 'update-modal-migration-file';
      li.textContent = String(f);
      els.migrationFilesList.appendChild(li);
    }
    els.migrationFiles.hidden = false;
  }
}

/**
 * 마이그레이션 실패 시각화 — 별도 에러 응답 경로용.
 * @param {{ file?: string, message?: string }} info
 */
function applyMigrationFailure(info) {
  const sec = els.migration;
  if (!sec) return;
  sec.hidden = false;
  sec.setAttribute('data-state', 'failed');

  if (els.migrationLabel) {
    els.migrationLabel.textContent = tSafe('ui.version-check.migration.failed', null, 'Migration failed');
  }
  if (els.migrationDuration) {
    els.migrationDuration.hidden = true;
    els.migrationDuration.textContent = '';
  }
  if (els.migrationFiles) els.migrationFiles.hidden = true;
  if (els.migrationFilesList) els.migrationFilesList.innerHTML = '';

  if (els.migrationDetail) {
    const file = info?.file ?? '';
    const fileLine = file
      ? tSafe('ui.version-check.migration.failed-file', { file }, `Failed file: ${file}`)
      : '';
    const guide = tSafe('ui.version-check.migration.failed-guide', null, 'Check server logs and follow recovery steps if needed.');
    els.migrationDetail.textContent = [fileLine, guide].filter(Boolean).join(' · ');
    els.migrationDetail.hidden = false;
  }
}

/**
 * 마이그레이션 영역 리셋 — 모달 진입 시 호출, 이전 상태 잔여물 차단.
 */
function resetMigrationSection() {
  const sec = els.migration;
  if (!sec) return;
  sec.hidden = true;
  sec.removeAttribute('data-state');
  if (els.migrationLabel) els.migrationLabel.textContent = '';
  if (els.migrationDuration) {
    els.migrationDuration.hidden = true;
    els.migrationDuration.textContent = '';
  }
  if (els.migrationDetail) {
    els.migrationDetail.hidden = true;
    els.migrationDetail.textContent = '';
  }
  if (els.migrationFiles) {
    els.migrationFiles.hidden = true;
    els.migrationFiles.removeAttribute('open');
  }
  if (els.migrationFilesList) els.migrationFilesList.innerHTML = '';
}

// ─── T-09: local-changes (409) 안내 패널 ─────────────────────────────────────
/**
 * 409 응답을 받았을 때 모달 분기 — 정상 actions 자리를 안내 패널로 대체.
 * 권장 명령은 비번역 코드 블록 (라벨만 i18n).
 *
 * @param {{ dirtyFiles?: string[] } | null} info
 */
function applyLocalChangesGuard(info) {
  if (!els.localChanges) return;
  // 정상 영역 가리기
  if (els.actions) els.actions.hidden = true;
  if (els.error)   els.error.hidden = true;
  if (els.success) els.success.hidden = true;
  resetMigrationSection();

  // dirty 파일 리스트 갱신
  const list = els.localChangesFilesList;
  const wrap = els.localChangesFiles;
  const files = Array.isArray(info?.dirtyFiles) ? info.dirtyFiles : [];
  if (list && wrap) {
    list.innerHTML = '';
    const MAX = 5;
    files.slice(0, MAX).forEach((f) => {
      const li = document.createElement('li');
      li.className = 'update-modal-local-changes-file';
      li.textContent = String(f);
      list.appendChild(li);
    });
    if (files.length > MAX) {
      const li = document.createElement('li');
      li.className = 'update-modal-local-changes-file is-more';
      li.textContent = tSafe('ui.version-check.local-changes.files-more', { n: files.length - MAX }, `+${files.length - MAX} more`);
      list.appendChild(li);
    }
    wrap.hidden = files.length === 0;
  }

  els.localChanges.hidden = false;
}

/**
 * local-changes 패널 리셋 — 모달 재진입 시 호출, 잔여 표시 차단.
 */
function resetLocalChangesPanel() {
  if (els.localChanges) els.localChanges.hidden = true;
  if (els.localChangesFiles) els.localChangesFiles.hidden = true;
  if (els.localChangesFilesList) els.localChangesFilesList.innerHTML = '';
}

/**
 * 캐시된 버전 정보를 가져와 배지 상태를 갱신한다.
 *
 * update-badge-dual-state: 배지는 항상 노출된다. fetch 성공/실패/응답 미수신 어떤 경우든
 * applyBadgeState로 통일된 상태(available / latest / loading)를 적용한다.
 * `badge.hidden`은 본 함수가 더 이상 제어하지 않는다.
 *
 * auto-update-migration-hardening: 응답에 `isShallowRepository`가 포함되면
 * dashboard warning 토글을 부수적으로 호출한다 (T-10).
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

    // T-10: shallow clone 표지 토글 — 필드 없으면 false로 가정
    applyShallowWarning(cache.isShallowRepository);
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
  resetMigrationSection();      // T-08: 진입 시 이전 잔여물 제거
  resetLocalChangesPanel();     // T-09: 진입 시 패널 닫기
  els.modal.classList.add('open');
}

function closeModal() {
  els.modal.classList.remove('open');
  resetMigrationSection();
  resetLocalChangesPanel();
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

    // T-09: 409 local_changes → 안내 패널 노출
    if (res.status === 409 && json.error === 'local_changes') {
      applyLocalChangesGuard(json);
      setLoading(false);
      return;
    }

    if (!json.success) {
      // T-08 분기 3: 마이그레이션 실패 정보가 응답에 포함되면 시각화
      if (json.migrationFailure || (json.error && /migration/i.test(String(json.error)))) {
        applyMigrationFailure(json.migrationFailure ?? { file: '', message: json.error });
      }
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

    // T-08: 마이그레이션 결과 시각화 (성공 응답 경로) — 응답에 필드 없으면 "변경 없음" 처리
    applyMigrationResult(cache?.migrationsApplied);

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

/**
 * 코드 블록 복사 위임 핸들러 — `data-copy="..."` 속성을 가진 버튼을 클릭하면
 * 그 값을 클립보드에 복사하고 짧게 "Copied" 피드백을 노출.
 *
 * 모달 + dashboard warning 모두에서 동일 패턴 (T-09 / T-10 공용 SSoT).
 *
 * deprecated `document.execCommand('copy')` 사용 안 함 — modern `navigator.clipboard.writeText` 단일 경로.
 * 비-https / sandbox iframe 등 Clipboard API 미가용 환경에서는 텍스트 선택 fallback으로 사용자가 수동 복사할 수 있도록 한다.
 */
function bindCopyDelegation(rootEl) {
  if (!rootEl) return;
  rootEl.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target.closest('[data-copy]') : null;
    if (!target) return;
    const text = target.getAttribute('data-copy');
    if (!text) return;

    const showCopied = () => {
      const orig = target.getAttribute('aria-label') || '';
      const label = tSafe('ui.html.update-modal.copied', null, 'Copied');
      target.setAttribute('aria-label', label);
      target.classList.add('is-copied');
      setTimeout(() => {
        target.setAttribute('aria-label', orig || tSafe('ui.html.update-modal.copy', null, 'Copy'));
        target.classList.remove('is-copied');
      }, 1400);
    };

    /**
     * Clipboard API 미가용 환경(비-https / sandbox iframe) fallback —
     * 인접한 <code> 요소의 내용을 사용자 선택 상태로 만들어 ⌘C/Ctrl+C 수동 복사를 유도.
     * deprecated execCommand는 사용하지 않는다.
     */
    const selectAdjacentCode = () => {
      const row = target.closest('.update-modal-cmd-row, .dashboard-warning-cmd-row');
      const codeEl = row?.querySelector('.update-modal-cmd, .dashboard-warning-cmd');
      if (!codeEl) return;
      const range = document.createRange();
      range.selectNodeContents(codeEl);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(showCopied).catch(() => {
        selectAdjacentCode();
        showCopied();
      });
    } else {
      selectAdjacentCode();
      showCopied();
    }
  });
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

  // T-09 / T-10: data-copy 위임 핸들러 — 모달 + dashboard warning 공용
  bindCopyDelegation(els.modal);
  bindCopyDelegation(els.shallowWarn);

  // T-10: shallow warning dismiss
  els.shallowWarnDismiss?.addEventListener('click', () => {
    try { localStorage.setItem(SHALLOW_DISMISS_KEY, '1'); } catch { /* noop */ }
    if (els.shallowWarn) els.shallowWarn.hidden = true;
  });
}
