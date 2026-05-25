/**
 * settings-view.js — 설정 패널 (진단 + Hook + Graph DB + Proxy + 서버/로그)
 *
 * 책임 (Single Responsibility):
 *   `#settingsView` 컨테이너 안에서 좌측 sub-tab 네비게이션 + 우측 본문 5개 섹션을 렌더.
 *   백엔드 `/api/settings/*` 7개 엔드포인트를 호출해 진단/액션을 수행하고 결과를 UI 에 반영.
 *
 * 의존성:
 *   - /api/settings/* (백엔드 라우터 — `routes/settings.ts`)
 *   - formatters.js::escHtml (XSS 방어)
 *   - window.I18n.t (다국어 — locales/<lang>/ui.json 의 `ui.settings-view` 네임스페이스)
 *
 * 호출 흐름:
 *   main.js::applyAppMode('settings')
 *     → enterSettingsMode() — #settingsView 표시 + 첫 sub-tab 활성 + diag fetch
 *       → renderActiveTab() — sub-tab 라우터
 *         → renderDiagSection() / renderHooksSection() / renderGraphSection() / ...
 *   browse 복귀 시 main.js → exitSettingsMode() — #settingsView 숨김 + in-flight fetch abort
 *
 * 디자인 결정:
 *   - 5개 sub-tab 컨텐츠는 각각 *재진입 가능* — 클릭할 때마다 최신 데이터 fetch.
 *     stale-while-revalidate 없이 단순화 (사용자가 명시적 액션 후 한 번 더 클릭하면 갱신).
 *   - 액션 버튼 (Hook 적용, Graph 캐시 재구축, Graph mode 전환) 은 confirm 모달 없이 직접 호출.
 *     백엔드가 항상 백업 + atomic 으로 안전하게 처리 + UI 가 결과 토스트로 알림.
 *   - innerHTML 사용 — 본 패널은 사용자 입력을 받지 않고 모든 데이터는 백엔드/서버 메타라 XSS
 *     리스크 낮음. 다만 사용자 표시 문자열 (예: backupPath, error message) 은 escHtml 처리.
 */

import { escHtml } from './formatters.js';

// =============================================================================
// 디자인 시스템 SVG 아이콘 — 이모지 대신 통일 사용 (사용자 요청 2026-05-26)
// =============================================================================

/**
 * Lucide-style 복사 아이콘 (14×14, stroke 2, currentColor).
 *   - 외부 도구 inline 복사 / 코드박스 우상단 복사 / 포트 변경 복사 — 3곳 모두 동일 사용.
 *   - currentColor 라 호스트 버튼의 color 토큰을 그대로 상속.
 */
const ICON_COPY = `<svg class="settings-copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

// =============================================================================
// DOM 헬퍼 + i18n
// =============================================================================

const VIEW_SELECTOR = '#settingsView';
const NAV_SELECTOR = '.settings-nav';
const CONTENT_ID = 'settingsContent';

/** i18n 헬퍼 — 미존재 키는 key 그대로. */
function t(key, vars) {
  const fn = window.I18n?.t?.bind(window.I18n);
  return fn ? fn(key, vars) : key;
}

/** in-flight fetch 가 mode 전환 후에도 setState 하지 않도록 가드 generation 카운터. */
let _generation = 0;

/** 현재 활성 sub-tab — 'diag' | 'hooks' | 'graph' | 'proxy' | 'server' */
let _activeTab = 'diag';

// =============================================================================
// 진입 / 종료
// =============================================================================

/**
 * 설정 모드 진입 — main.js::applyAppMode('settings') 가 호출.
 *
 * - #settingsView 의 hidden 속성 제거 (body[data-app-mode="settings"] CSS 룰과 함께 노출).
 * - 좌측 nav 클릭 위임 + refresh 버튼 바인딩 (idempotent — 두 번 호출돼도 listener 중복 X).
 * - 현재 활성 sub-tab 의 본문 렌더 (기본: diag).
 */
export function enterSettingsMode() {
  const view = document.querySelector(VIEW_SELECTOR);
  if (!view) return;
  view.hidden = false;
  _generation++;

  bindNav(view);
  bindRefresh(view);
  renderActiveTab();
}

/** 설정 모드 종료 — in-flight fetch 결과를 무시하도록 generation 증가. */
export function exitSettingsMode() {
  const view = document.querySelector(VIEW_SELECTOR);
  if (!view) return;
  view.hidden = true;
  _generation++;
}

// =============================================================================
// sub-tab 라우팅
// =============================================================================

/**
 * 좌측 nav 클릭 위임. 클릭된 sub-tab 으로 _activeTab 갱신 + 본문 재렌더 + aria-selected 동기화.
 *
 * idempotent: dataset.bound 마커로 한 번만 등록.
 */
function bindNav(view) {
  const nav = view.querySelector(NAV_SELECTOR);
  if (!nav || nav.dataset.bound === '1') return;
  nav.dataset.bound = '1';

  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-settings-tab]');
    if (!btn || !nav.contains(btn)) return;
    const tab = btn.dataset.settingsTab;
    if (!tab || tab === _activeTab) return;
    _activeTab = tab;
    syncNavActive(nav);
    renderActiveTab();
  });
}

/** active 클래스 + aria-selected 동기화 — _activeTab 만 ‘.is-active’. */
function syncNavActive(nav) {
  nav.querySelectorAll('[data-settings-tab]').forEach((btn) => {
    const isActive = btn.dataset.settingsTab === _activeTab;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
}

/** 상단 우측 "전체 진단 다시 실행" 버튼 — 현재 sub-tab 강제 재렌더. */
function bindRefresh(view) {
  const btn = view.querySelector('#settingsRefreshBtn');
  if (!btn || btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', () => renderActiveTab());
}

/** _activeTab 에 따라 본문을 그린다. */
function renderActiveTab() {
  switch (_activeTab) {
    case 'diag':   return renderDiagSection();
    case 'hooks':  return renderHooksSection();
    case 'graph':  return renderGraphSection();
    case 'proxy':  return renderProxySection();
    case 'server': return renderServerSection();
    default:       return renderDiagSection();
  }
}

/** 현재 콘텐츠 영역을 안전하게 가져온다. */
function contentEl() {
  return document.getElementById(CONTENT_ID);
}

/** 스켈레톤 로딩 + 에러 셸. */
function renderLoading(label) {
  const el = contentEl();
  if (!el) return;
  el.innerHTML = `<div class="settings-loading">${escHtml(label || t('ui.settings-view.loading'))}</div>`;
}
function renderError(err) {
  const el = contentEl();
  if (!el) return;
  const msg = err instanceof Error ? err.message : String(err);
  el.innerHTML = `<div class="settings-error">⚠ ${escHtml(msg)}</div>`;
}

// =============================================================================
// 섹션 1 — 시스템 진단 (Diag)
// =============================================================================

async function renderDiagSection() {
  const gen = _generation;
  renderLoading();
  let data;
  try {
    const res = await fetch('/api/settings/diag');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'diag fetch failed');
    data = json.data;
  } catch (err) {
    if (gen !== _generation) return;
    renderError(err);
    return;
  }
  if (gen !== _generation) return;

  const el = contentEl();
  if (!el) return;

  const versions = data.versions;
  const hooks = data.hooks;
  const graph = data.graph;
  const server = data.server;

  // 외부 도구 진단 row — 미설치 시 installHint 옆에 *inline 복사 아이콘* 노출 (PR 2).
  //   사용자가 텍스트 명령을 한 번 클릭으로 클립보드에 복사 → 터미널에 paste 만 하면 됨.
  const versionRow = (key, label, hint) => {
    const v = versions[key];
    const status = v.available ? 'ok' : 'warn';
    const valueText = v.available ? (v.version || v.raw || '?') : t('ui.settings-view.diag.missing');
    let tail = '';
    if (!v.available && v.installHint) {
      // installHint 가 `# ...` 주석으로 시작하면 *명령이 아닌 안내문* 이라 복사 아이콘 생략.
      const isComment = v.installHint.trim().startsWith('#');
      const cmdHtml = `<code class="settings-cmd">${escHtml(v.installHint)}</code>`;
      const copyBtnHtml = isComment ? '' :
        `<button class="settings-inline-copy" data-copy-text="${escHtml(v.installHint)}" title="${t('ui.settings-view.proxy.copy')}" aria-label="copy">${ICON_COPY}</button>`;
      tail = `${cmdHtml}${copyBtnHtml}`;
    }
    return rowHtml(label || key, status, valueText, tail || hint || '');
  };

  // hooks 부분 진단 — 등록된 events 수 / 기대치.
  const hookStatus = hooks.exists
    ? hooks.parsed
      ? hooks.registeredCount === hooks.expectedCount
        ? 'ok'
        : hooks.registeredCount === 0
        ? 'warn'
        : 'warn'
      : 'fail'
    : 'warn';
  const hookValue = hooks.exists
    ? hooks.parsed
      ? t('ui.settings-view.diag.hook-registered', { n: hooks.registeredCount, total: hooks.expectedCount })
      : t('ui.settings-view.diag.hook-broken')
    : t('ui.settings-view.diag.hook-missing');

  // graph 상태 — mode 별 색상 + 출처 배지.
  const graphStatus = graph.mode === 'off' ? 'warn' : graph.circuit.state === 'CLOSED' ? 'ok' : 'warn';
  const graphSource = graph.source || 'default';
  const graphSourceClass = graphSource === 'env' ? 'is-env' : graphSource === 'file' ? 'is-saved' : 'is-default';
  const graphSourceLabel = t(`ui.settings-view.graph.source.${graphSource === 'file' ? 'saved' : graphSource}`);
  const graphTail =
    `<span class="settings-source-badge ${graphSourceClass}" title="${escHtml(graph.configFile || '')}">${escHtml(graphSourceLabel)}</span>` +
    `<span class="settings-meta">${escHtml(graph.mode)}</span>`;

  el.innerHTML = `
    <h3 class="settings-section-title">${t('ui.settings-view.diag.title')}</h3>
    <div class="settings-card">
      ${versionRow('bun', 'Bun')}
      ${versionRow('claude', 'Claude Code')}
      ${versionRow('git', 'Git')}
      ${versionRow('curl', 'curl')}
      ${versionRow('jq', 'jq')}
    </div>
    <div class="settings-card">
      ${rowHtml(t('ui.settings-view.diag.hook-label'), hookStatus, hookValue,
        `<button class="settings-jump-btn" data-settings-jump="hooks">${t('ui.settings-view.diag.jump-hooks')}</button>`)}
      ${rowHtml('SQLite migration',
        'ok',
        `v${escHtml(String(server?.pid != null ? '—' : '—'))}`,
        '<span class="settings-meta">/api/version</span>')}
      ${rowHtml('Graph DB', graphStatus,
        graph.mode,
        `<button class="settings-jump-btn" data-settings-jump="graph">${t('ui.settings-view.diag.jump-graph')}</button>${graphTail}`)}
    </div>
    <div class="settings-card">
      ${rowHtml(t('ui.settings-view.diag.port'), 'ok', String(server.port), '')}
      ${rowHtml('PID', 'ok', String(server.pid), `<span class="settings-meta">uptime ${formatUptime(server.uptimeSec)}</span>`)}
      ${rowHtml('Bun', 'ok', server.bunVersion || '?', '')}
      ${rowHtml(t('ui.settings-view.diag.logs-dir'), 'ok', escHtml(server.logsDir), '')}
    </div>
  `;

  // jump 버튼 위임 — diag 행의 [→] 버튼들이 sub-tab 전환.
  el.querySelectorAll('[data-settings-jump]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.settingsJump;
      if (!next) return;
      _activeTab = next;
      const nav = document.querySelector(NAV_SELECTOR);
      if (nav) syncNavActive(nav);
      renderActiveTab();
    });
  });

  // PR 2 — 외부 도구 inline 복사 아이콘 클릭 위임.
  el.querySelectorAll('[data-copy-text]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const txt = btn.getAttribute('data-copy-text') || '';
      copyToClipboard(txt, t('ui.settings-view.proxy.copied'));
    });
  });
}

// =============================================================================
// 섹션 2 — Hook 설정 (preview + apply)
// =============================================================================

let _selectedProfile = 'full';

/**
 * Hook 설정 섹션 — UI 통일 (Graph DB 와 동일 디자인 패턴):
 *   1) 통합 상태 배지 1개 — ✓ 모두 등록 / ⚠ 부분 등록 / ✕ 미등록 (파일 손상 포함)
 *   2) 라디오 → 옵션 카드 2개 (Full / Minimal) + ⓘ 호버 툴팁
 *   3) 17개 이벤트 리스트 + SPYGLASS_DIR 절대경로 같은 디버그 지표는
 *      [고급 엔지니어링 진단 정보 보기 ▼] details 안으로 격리
 */
async function renderHooksSection() {
  const gen = _generation;
  renderLoading();
  let data;
  try {
    const res = await fetch('/api/settings/diag');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'diag fetch failed');
    data = json.data;
  } catch (err) {
    if (gen !== _generation) return;
    renderError(err);
    return;
  }
  if (gen !== _generation) return;

  const el = contentEl();
  if (!el) return;

  const hooks = data.hooks;

  // ── 통합 상태 배지 계산 ───────────────────────────────────────────────
  //   ok      : 파일 존재 + 파싱 OK + SPYGLASS_DIR 설정 + 권장 이벤트 모두 등록
  //   warn    : 파일 존재 + 파싱 OK + 일부 등록 안 됨 또는 SPYGLASS_DIR 누락
  //   missing : 파일 미존재 — 첫 설치 시나리오 (자동 설치 버튼 강조)
  //   broken  : 파일은 있지만 JSON 손상
  let healthState;
  if (!hooks.exists) healthState = 'missing';
  else if (!hooks.parsed) healthState = 'broken';
  else if (hooks.registeredCount === hooks.expectedCount && hooks.spyglassDir) healthState = 'ok';
  else healthState = 'warn';
  const healthIcon = healthState === 'ok' ? '✓' : healthState === 'broken' ? '✕' : '⚠';
  const healthLabel = t(`ui.settings-view.hooks.health.${healthState}`, {
    n: hooks.registeredCount,
    total: hooks.expectedCount,
  });

  // ── 옵션 카드 2개 (Full / Minimal) ────────────────────────────────────
  const profiles = ['full', 'minimal'];
  const profileCardsHtml = profiles.map((p) => {
    const active = _selectedProfile === p ? ' is-active' : '';
    const label = t(`ui.settings-view.hooks.profiles.${p}.label`);
    const desc = t(`ui.settings-view.hooks.profiles.${p}.desc`);
    const tooltip = t(`ui.settings-view.hooks.profiles.${p}.tooltip`);
    return `
      <button type="button" class="settings-option-card${active}" data-hook-profile="${p}"
              role="radio" aria-checked="${_selectedProfile === p}">
        <span class="settings-option-card-head">
          <span class="settings-option-card-label">${escHtml(label)}</span>
          <span class="settings-tooltip-host" tabindex="0" aria-label="${escHtml(tooltip)}">
            <span class="settings-tooltip-icon" aria-hidden="true">ⓘ</span>
            <span class="settings-tooltip-bubble" role="tooltip">${escHtml(tooltip)}</span>
          </span>
        </span>
        <span class="settings-option-card-desc">${escHtml(desc)}</span>
      </button>
    `;
  }).join('');

  // ── Engineering details (이벤트별 상태 + SPYGLASS_DIR + 파일 경로) ────
  const eventsHtml = hooks.events.map((ev) => {
    const status = ev.count > 0 ? 'ok' : 'warn';
    const valueText = ev.count > 0
      ? t('ui.settings-view.hooks.registered')
      : t('ui.settings-view.hooks.unregistered');
    return rowHtml(ev.event, status, valueText, '');
  }).join('');
  const spyglassDirRow = rowHtml('SPYGLASS_DIR',
    hooks.spyglassDir ? 'ok' : 'warn',
    hooks.spyglassDir ? '✓' : t('ui.settings-view.hooks.unregistered'),
    hooks.spyglassDir
      ? `<code class="settings-meta">${escHtml(hooks.spyglassDir)}</code>`
      : `<span class="settings-meta">${t('ui.settings-view.hooks.spyglass-dir-missing')}</span>`);
  // 진단 정보 카드 — 항상 노출 (사용자 요청 2026-05-26: 접기 폐지).
  const engineeringHtml = `
    <div class="settings-card">
      <div class="settings-card-title">${t('ui.settings-view.hooks.engineering-title')}</div>
      <div class="settings-meta" style="margin-bottom:6px"><code>${escHtml(hooks.path)}</code></div>
      ${spyglassDirRow}
      ${eventsHtml}
    </div>
  `;

  el.innerHTML = `
    <h3 class="settings-section-title">${t('ui.settings-view.hooks.title')}</h3>

    <div class="settings-card">
      <div class="settings-health-row">
        <span class="settings-health-badge is-${healthState === 'broken' ? 'warn' : healthState === 'missing' ? 'warn' : healthState}">
          <span class="settings-health-icon" aria-hidden="true">${healthIcon}</span>
          <span class="settings-health-text">${escHtml(healthLabel)}</span>
        </span>
      </div>
    </div>

    <div class="settings-card">
      <div class="settings-card-title">${t('ui.settings-view.hooks.profile-title')}</div>
      <div class="settings-card-sub">${t('ui.settings-view.hooks.profile-sub')}</div>
      <div class="settings-option-grid" role="radiogroup" aria-label="${t('ui.settings-view.hooks.profile-title')}">
        ${profileCardsHtml}
      </div>
      <div class="settings-actions">
        <button class="settings-action-btn settings-action-secondary" id="hookPreviewBtn">${t('ui.settings-view.hooks.preview')}</button>
        <button class="settings-action-btn settings-action-primary" id="hookApplyBtn">${t('ui.settings-view.hooks.apply')}</button>
      </div>
      <div class="settings-result" id="hookResult"></div>
    </div>

    ${engineeringHtml}
  `;

  // 옵션 카드 클릭 — 라디오 동작 시뮬레이션.
  el.querySelectorAll('[data-hook-profile]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.hookProfile;
      if (next !== 'full' && next !== 'minimal') return;
      _selectedProfile = next;
      el.querySelectorAll('[data-hook-profile]').forEach((b) => {
        const isActive = b.dataset.hookProfile === next;
        b.classList.toggle('is-active', isActive);
        b.setAttribute('aria-checked', String(isActive));
      });
    });
  });
  el.querySelector('#hookPreviewBtn')?.addEventListener('click', () => onHookPreview());
  el.querySelector('#hookApplyBtn')?.addEventListener('click', () => onHookApply());
}

async function onHookPreview() {
  const out = document.getElementById('hookResult');
  if (!out) return;
  out.innerHTML = `<div class="settings-loading">${t('ui.settings-view.loading')}</div>`;
  try {
    const res = await fetch(`/api/settings/hooks/preview?profile=${encodeURIComponent(_selectedProfile)}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'preview failed');
    out.innerHTML = renderHookDiff(json.data.diff, /*applied=*/false);
  } catch (err) {
    out.innerHTML = `<div class="settings-error">⚠ ${escHtml(err instanceof Error ? err.message : String(err))}</div>`;
  }
}

async function onHookApply() {
  const out = document.getElementById('hookResult');
  if (!out) return;
  out.innerHTML = `<div class="settings-loading">${t('ui.settings-view.hooks.applying')}</div>`;
  try {
    const res = await fetch('/api/settings/hooks/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: _selectedProfile }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'apply failed');
    out.innerHTML = renderHookDiff(json.data.diff, /*applied=*/true, json.data.backupPath);
    // PR 2 — Claude Code 재시작 안내를 sticky alert 로 노출. 백엔드 응답의 nextAction === 'restart-claude-code' 이면 활성화.
    if (json.data.nextAction === 'restart-claude-code') {
      showStickyAlert(t('ui.settings-view.hooks.restart-required-banner'), 'restart');
    }
    bindUndoButton(out, json.data.backupPath);
  } catch (err) {
    out.innerHTML = `<div class="settings-error">⚠ ${escHtml(err instanceof Error ? err.message : String(err))}</div>`;
  }
}

// =============================================================================
// Sticky alert — Claude Code 재시작 안내 등 강조 배너
// =============================================================================

/**
 * 화면 상단 고정 알림 — Hook/Graph 변경 후 사용자가 *반드시* 인지해야 할 다음 단계 안내.
 *
 *   - `#settingsStickyAlertSlot` 컨테이너를 settingsHeader 아래에 동적으로 끼워넣고 메시지 표시.
 *   - 같은 종류(kind) 알림이 이미 있으면 메시지만 갱신 (중복 노출 X).
 *   - 사용자가 [×] 닫기 버튼으로 직접 닫을 수 있음.
 *   - sub-tab 전환 후에도 *유지* — 사용자가 변경 후 다른 탭을 들렀다 와도 안내가 사라지지 않음.
 */
function showStickyAlert(message, kind = 'info') {
  const view = document.querySelector(VIEW_SELECTOR);
  if (!view) return;
  let slot = view.querySelector('#settingsStickyAlertSlot');
  if (!slot) {
    slot = document.createElement('div');
    slot.id = 'settingsStickyAlertSlot';
    slot.className = 'settings-sticky-alert-slot';
    // header 다음, body 앞에 삽입.
    const body = view.querySelector('.settings-body');
    if (body) view.insertBefore(slot, body);
    else view.appendChild(slot);
  }
  // 동일 kind 이미 있으면 메시지만 갱신.
  let alert = slot.querySelector(`.settings-sticky-alert[data-alert-kind="${kind}"]`);
  if (!alert) {
    alert = document.createElement('div');
    alert.className = `settings-sticky-alert settings-sticky-alert-${kind}`;
    alert.dataset.alertKind = kind;
    slot.appendChild(alert);
  }
  alert.innerHTML = `
    <span class="settings-sticky-alert-icon">⚠</span>
    <span class="settings-sticky-alert-text">${escHtml(message)}</span>
    <button class="settings-sticky-alert-close" aria-label="dismiss">×</button>
  `;
  alert.querySelector('.settings-sticky-alert-close')?.addEventListener('click', () => {
    alert.remove();
  });
}

/**
 * Hook 적용 성공 후 출력 영역의 [이전 설정으로 복구] 버튼 바인딩.
 *
 *   백엔드가 반환한 `backupPath` 를 그대로 POST /api/settings/hooks/restore 로 전달.
 *   path traversal 가드는 서버 측 (claude-hooks.ts::restoreFromBackup) 가 책임.
 *
 *   복구 성공 시 결과 영역을 "원복됨 + pre-restore 백업" 메시지로 교체.
 */
function bindUndoButton(container, backupPath) {
  if (!backupPath || backupPath.startsWith('(')) return; // "(none — 첫 설치)" 등 처리 불가
  const btn = container.querySelector('[data-hook-undo]');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = t('ui.settings-view.hooks.restoring');
    try {
      const res = await fetch('/api/settings/hooks/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupPath }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'restore failed');
      const pre = json.data.preRestoreBackup
        ? `<div class="settings-diff-row settings-diff-info"><b>${t('ui.settings-view.hooks.pre-restore-backup')}</b> <code>${escHtml(json.data.preRestoreBackup)}</code></div>`
        : '';
      container.innerHTML = `
        <div class="settings-diff">
          <div class="settings-diff-title">${t('ui.settings-view.hooks.restore-success')}</div>
          <div class="settings-diff-row settings-diff-info"><b>${t('ui.settings-view.hooks.restored-from')}</b> <code>${escHtml(json.data.restoredFrom)}</code></div>
          ${pre}
        </div>
      `;
    } catch (err) {
      btn.disabled = false;
      btn.textContent = t('ui.settings-view.hooks.undo');
      const msg = escHtml(err instanceof Error ? err.message : String(err));
      const errBox = document.createElement('div');
      errBox.className = 'settings-error';
      errBox.textContent = `⚠ ${msg}`;
      container.appendChild(errBox);
    }
  });
}

function renderHookDiff(diff, applied, backupPath) {
  const headerKey = applied ? 'ui.settings-view.hooks.apply-success' : 'ui.settings-view.hooks.preview-result';
  const tag = (label, items, cls) => items.length
    ? `<div class="settings-diff-row settings-diff-${cls}"><b>${escHtml(label)}</b> <span>${items.map(escHtml).join(', ')}</span></div>`
    : '';
  const backupHtml = applied && backupPath
    ? `<div class="settings-diff-row settings-diff-info"><b>${t('ui.settings-view.hooks.backup-saved')}</b> <code>${escHtml(backupPath)}</code></div>`
    : '';
  // Undo 버튼 — 적용 성공 시 + 실제 백업본이 있는 경우만 노출.
  //   "(none — 첫 설치)" 처럼 백업 없는 케이스는 복구 불가라 버튼 생략.
  const undoBtnHtml = applied && backupPath && !backupPath.startsWith('(')
    ? `<div class="settings-actions">
         <button class="settings-action-btn settings-action-secondary" data-hook-undo>${t('ui.settings-view.hooks.undo')}</button>
       </div>`
    : '';
  return `
    <div class="settings-diff">
      <div class="settings-diff-title">${t(headerKey)}</div>
      ${backupHtml}
      ${tag(t('ui.settings-view.hooks.diff-applied'), diff.applied, 'add')}
      ${tag(t('ui.settings-view.hooks.diff-modified'), diff.modified, 'mod')}
      ${tag(t('ui.settings-view.hooks.diff-preserved'), diff.preserved, 'keep')}
      <div class="settings-diff-row settings-diff-info">
        <b>SPYGLASS_DIR</b> <span>${escHtml(diff.spyglassDir)} → <code>${escHtml(diff.spyglassDirAfter)}</code></span>
      </div>
      ${undoBtnHtml}
    </div>
  `;
}

// =============================================================================
// 섹션 3 — Graph DB (mode + reset cache)
// =============================================================================

/**
 * Graph DB 섹션 — UI/UX 대개혁 (PR 2 마감):
 *
 *   기존: off/shadow/primary 알약 버튼 + 회로/Sync/cache size raw 노출 + "primary→shadow
 *         persisted..." 등 디버그 hint 텍스트가 그대로 화면에.
 *   변경:
 *     1) 옵션 카드 3개 — 각 카드에 한글 라벨 + 1줄 설명 + 호버 툴팁 (i18n 4언어).
 *     2) 통합 상태 배지 1개 — ✓ 정상 / ⚠ 준비 중 / ⏸ 사용 안 함 으로 단순화.
 *     3) 회로/Sync/캐시 절대경로 같은 디버그 지표는 <details> 안으로 격리.
 *     4) raw hint 텍스트 폐기. 변경 결과는 toast + sticky alert 만.
 */
async function renderGraphSection() {
  const gen = _generation;
  renderLoading();
  let data;
  try {
    const res = await fetch('/api/settings/diag');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'diag failed');
    data = json.data;
  } catch (err) {
    if (gen !== _generation) return;
    renderError(err);
    return;
  }
  if (gen !== _generation) return;

  const el = contentEl();
  if (!el) return;
  const g = data.graph;

  // ── 옵션 카드 3개 — i18n 라벨 + 설명 + 툴팁 (사용자 요청으로 토글 방식 폐기) ──
  const modes = ['off', 'shadow', 'primary'];
  const modeCardsHtml = modes.map((m) => {
    const active = g.mode === m ? ' is-active' : '';
    const label = t(`ui.settings-view.graph.options.${m}.label`);
    const desc = t(`ui.settings-view.graph.options.${m}.desc`);
    const tooltip = t(`ui.settings-view.graph.options.${m}.tooltip`);
    return `
      <button type="button" class="settings-option-card${active}" data-graph-mode="${m}"
              role="radio" aria-checked="${g.mode === m}">
        <span class="settings-option-card-head">
          <span class="settings-option-card-label">${escHtml(label)}</span>
          <span class="settings-tooltip-host" tabindex="0" aria-label="${escHtml(tooltip)}">
            <span class="settings-tooltip-icon" aria-hidden="true">ⓘ</span>
            <span class="settings-tooltip-bubble" role="tooltip">${escHtml(tooltip)}</span>
          </span>
        </span>
        <span class="settings-option-card-desc">${escHtml(desc)}</span>
      </button>
    `;
  }).join('');

  // ── 통합 상태 배지 — 회로/Sync/모드 한 줄로 압축 ──────────────────────
  //   ok   : mode != off && circuit=CLOSED && sync.running
  //   warn : mode != off && (circuit OPEN/HALF || !sync.running)
  //   off  : mode = off
  const healthState = g.mode === 'off' ? 'off'
    : (g.circuit?.state === 'CLOSED' && g.sync?.running) ? 'ok' : 'warn';
  const healthIcon = healthState === 'ok' ? '✓' : healthState === 'warn' ? '⚠' : '⏸';
  const healthLabel = t(`ui.settings-view.graph.health.${healthState}`);

  // env override 경고 배너 — source === 'env' 일 때만 노출.
  const source = g.source || 'default';
  const envWarnHtml = source === 'env'
    ? `<div class="settings-warn-banner">⚠ ${t('ui.settings-view.graph.env-override-warning')}</div>`
    : '';

  // ── 진단 정보 카드 — 항상 노출 (사용자 요청 2026-05-26: 접기 폐지) ────
  //   회로 차단기, Sync Worker, 캐시 경로, source/configFile 등 *디버그성* 지표지만
  //   첫 사용자가 "왜 이 상태로 보이는지" 즉시 인지할 수 있도록 펼친 채 유지.
  const sourceLabelText = t(`ui.settings-view.graph.source.${source === 'file' ? 'saved' : source}`);
  const engineeringHtml = `
    <div class="settings-card">
      <div class="settings-card-title">${t('ui.settings-view.graph.engineering-title')}</div>
      ${rowHtml(t('ui.settings-view.graph.circuit'),
         g.circuit?.state === 'CLOSED' ? 'ok' : 'warn',
         g.circuit?.state ?? '—',
         `<span class="settings-meta">${g.circuit?.consecutiveFailures ?? 0} fail · ${((g.circuit?.fallbackRate ?? 0) * 100).toFixed(1)}% fallback</span>`)}
      ${rowHtml(t('ui.settings-view.graph.sync-worker'),
         g.sync?.running ? 'ok' : 'warn',
         g.sync?.running ? 'running' : 'stopped',
         g.sync?.cursor != null ? `<span class="settings-meta">cursor ${escHtml(String(g.sync.cursor))}</span>` : '')}
      ${rowHtml(t('ui.settings-view.graph.cache'),
         'ok',
         g.cacheSizeBytes != null ? formatBytes(g.cacheSizeBytes) : '—',
         `<code class="settings-meta">${escHtml(g.cacheDir || '')}</code>`)}
      ${rowHtml(t('ui.settings-view.graph.config-file'),
         'ok',
         escHtml(sourceLabelText),
         g.configFile ? `<code class="settings-meta">${escHtml(g.configFile)}</code>` : '')}
    </div>
  `;

  el.innerHTML = `
    <h3 class="settings-section-title">${t('ui.settings-view.graph.title')}</h3>
    ${envWarnHtml}

    <div class="settings-card">
      <div class="settings-health-row">
        <span class="settings-health-badge is-${healthState}">
          <span class="settings-health-icon" aria-hidden="true">${healthIcon}</span>
          <span class="settings-health-text">${escHtml(healthLabel)}</span>
        </span>
      </div>
    </div>

    <div class="settings-card">
      <div class="settings-card-title">${t('ui.settings-view.graph.mode-pick-title')}</div>
      <div class="settings-card-sub">${t('ui.settings-view.graph.mode-pick-sub')}</div>
      <div class="settings-option-grid" role="radiogroup" aria-label="${t('ui.settings-view.graph.mode-pick-title')}">
        ${modeCardsHtml}
      </div>
      <div class="settings-result" id="graphResult"></div>
    </div>

    <div class="settings-card">
      <div class="settings-card-title">${t('ui.settings-view.graph.reset-title')}</div>
      <div class="settings-card-sub">${t('ui.settings-view.graph.reset-hint')}</div>
      <div class="settings-actions">
        <button class="settings-action-btn settings-action-secondary" id="graphResetBtn">${t('ui.settings-view.graph.reset-btn')}</button>
      </div>
      <div class="settings-result" id="graphResetResult"></div>
    </div>

    ${engineeringHtml}
  `;

  // 옵션 카드 클릭 위임 (이전 방식 복원).
  el.querySelectorAll('[data-graph-mode]').forEach((btn) => {
    btn.addEventListener('click', () => onGraphMode(btn.dataset.graphMode));
  });
  el.querySelector('#graphResetBtn')?.addEventListener('click', () => onGraphReset());
}

/**
 * Graph mode 변경 — 기본 영속화(persistent:true).
 *
 *   UX 대개혁 (PR 2 마감):
 *     - 응답의 raw hint 문자열은 *화면에 노출하지 않음* (디버그 로그 같아 사용자에게 부적합).
 *     - 성공 = toast + sticky 재시작 안내. env override 일 때만 별도 경고 toast.
 *     - 옵션 카드 active 상태 즉시 갱신.
 */
async function onGraphMode(mode) {
  try {
    const res = await fetch('/api/settings/graph/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, persistent: true }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'mode change failed');

    // 옵션 카드 active 갱신.
    document.querySelectorAll('[data-graph-mode]').forEach((b) => {
      const isActive = b.dataset.graphMode === mode;
      b.classList.toggle('is-active', isActive);
      b.setAttribute('aria-checked', String(isActive));
    });

    // env override 인 경우 — 별도 toast 로 *현재 세션엔 미반영* 안내.
    if (json.data.source === 'env') {
      toast(t('ui.settings-view.graph.toast-env-override'));
    } else {
      toast(t('ui.settings-view.graph.toast-saved'));
    }

    // sticky alert — 변경이 활성화되려면 Claude Code 재시작 필요 (Hook 과 동일 정책).
    showStickyAlert(t('ui.settings-view.hooks.restart-required-banner'), 'restart');

    // 진단 섹션을 다시 그려야 통합 상태 배지 색이 갱신됨 — 현재 탭이 graph 일 때만.
    if (_activeTab === 'graph') {
      // 작은 지연 — toast 가 시각적으로 먼저 보이도록.
      setTimeout(() => { if (_activeTab === 'graph') renderGraphSection(); }, 250);
    }
  } catch (err) {
    toast(`⚠ ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function onGraphReset() {
  const out = document.getElementById('graphResetResult');
  if (!out) return;
  out.innerHTML = `<div class="settings-loading">${t('ui.settings-view.loading')}</div>`;
  try {
    const res = await fetch('/api/settings/graph/reset-cache', { method: 'POST' });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'reset failed');
    const deleted = formatBytes(json.data.deletedBytes ?? 0);
    out.innerHTML = `
      <div class="settings-diff settings-diff-success">
        <div class="settings-diff-title">${t('ui.settings-view.graph.reset-success')}</div>
        <div class="settings-diff-row settings-diff-info">
          <span class="settings-meta">${deleted} ${t('ui.settings-view.graph.reset-cleaned')}</span>
        </div>
      </div>
    `;
    toast(t('ui.settings-view.graph.reset-success'));
  } catch (err) {
    out.innerHTML = `<div class="settings-error">⚠ ${escHtml(err instanceof Error ? err.message : String(err))}</div>`;
  }
}

// =============================================================================
// 섹션 4 — Proxy 자동 등록 (PR 2 — 원클릭 자동화)
// =============================================================================

let _proxyShell = 'auto';

/**
 * Proxy 섹션 본문 렌더 — Graph DB / Hook 과 동일 디자인 패턴:
 *   1) 통합 상태 배지 1개 — ✓ 설치됨 / ⚠ 미설치 / ✕ 손상 / ⏸ 셸 미존재
 *   2) 옵션 카드 4개 (auto / zsh / bash / fish) + ⓘ 호버 툴팁
 *   3) snippet 미리보기 / port / 마커 검출 등 디버그 정보는 engineering details
 */
async function renderProxySection() {
  const gen = _generation;
  const el = contentEl();
  if (!el) return;
  renderLoading();

  let snippetData, statusData;
  try {
    const [r1, r2] = await Promise.all([
      fetch(`/api/settings/proxy/snippet?shell=${encodeURIComponent(_proxyShell === 'auto' ? 'zsh' : _proxyShell)}`).then((r) => r.json()),
      fetch(`/api/settings/proxy/status?shell=${encodeURIComponent(_proxyShell)}`).then((r) => r.json()),
    ]);
    if (!r1.success) throw new Error(r1.error || 'proxy snippet failed');
    if (!r2.success) throw new Error(r2.error || 'proxy status failed');
    snippetData = r1.data;
    statusData = r2.data;
  } catch (err) {
    if (gen !== _generation) return;
    renderError(err);
    return;
  }
  if (gen !== _generation) return;

  // ── 통합 상태 배지 계산 ─────────────────────────────────────────────
  //   ok        : 마커 페어 둘 다 있음 (정상 설치)
  //   warn      : 셸 프로필 존재 + 마커 없음 (미설치)
  //   broken    : 한쪽 마커만 (손상)
  //   missing   : 셸 프로필 자체 없음 (자동 등록이 생성)
  let healthState;
  if (statusData.corrupted) healthState = 'broken';
  else if (statusData.installed) healthState = 'ok';
  else if (!statusData.profileExisted) healthState = 'missing';
  else healthState = 'warn';
  const healthIcon = healthState === 'ok' ? '✓' : healthState === 'broken' ? '✕' : '⚠';
  const healthLabel = t(`ui.settings-view.proxy.health.${healthState}`, {
    shell: statusData.shell,
  });
  const healthBadgeClass = healthState === 'ok' ? 'is-ok' : 'is-warn';

  // ── 옵션 카드 4개 (auto/zsh/bash/fish) ───────────────────────────────
  const shells = ['auto', 'zsh', 'bash', 'fish'];
  const shellCardsHtml = shells.map((s) => {
    const active = _proxyShell === s ? ' is-active' : '';
    const label = t(`ui.settings-view.proxy.shells.${s}.label`);
    const desc = t(`ui.settings-view.proxy.shells.${s}.desc`);
    const tooltip = t(`ui.settings-view.proxy.shells.${s}.tooltip`);
    return `
      <button type="button" class="settings-option-card${active}" data-proxy-shell="${s}"
              role="radio" aria-checked="${_proxyShell === s}">
        <span class="settings-option-card-head">
          <span class="settings-option-card-label">${escHtml(label)}</span>
          <span class="settings-tooltip-host" tabindex="0" aria-label="${escHtml(tooltip)}">
            <span class="settings-tooltip-icon" aria-hidden="true">ⓘ</span>
            <span class="settings-tooltip-bubble" role="tooltip">${escHtml(tooltip)}</span>
          </span>
        </span>
        <span class="settings-option-card-desc">${escHtml(desc)}</span>
      </button>
    `;
  }).join('');

  // ── 진단 정보 카드 — 항상 노출 ─────────────────────────────────────────
  //   "마커" 개념 설명문은 카드 본문에서 *제거* 하고, 대신 카드 제목 옆 ⓘ 툴팁에 격리.
  //   (사용자 요청 2026-05-26: 본문에 박힌 설명 박스는 지저분해 보임)
  //
  //   미리보기 스니펫은 *실제 ~/.zshrc 에 들어가는 그대로* — 마커 페어 포함. 수동 설치 시
  //   사용자가 그대로 복사해서 붙여 넣으면 동일 결과.
  //
  //   복사 버튼은 <pre> 코드 박스의 우상단에 absolute 위치 — 외부 액션 영역이 아닌
  //   *코드 박스 자체에 부착* 으로 시각 정돈.
  const markerOpenStr = '# >>> spyglass proxy >>>';
  const markerCloseStr = '# <<< spyglass proxy <<<';
  const fullSnippetWithMarkers = `${markerOpenStr}\n${snippetData.snippet}\n${markerCloseStr}`;
  const markerExplainTooltip = t('ui.settings-view.proxy.marker-explain-body');
  const engineeringHtml = `
    <div class="settings-card">
      <div class="settings-card-title">
        ${t('ui.settings-view.proxy.engineering-title')}
        <span class="settings-tooltip-host" tabindex="0" aria-label="${escHtml(markerExplainTooltip)}">
          <span class="settings-tooltip-icon" aria-hidden="true">ⓘ</span>
          <span class="settings-tooltip-bubble" role="tooltip">
            <b>${escHtml(t('ui.settings-view.proxy.marker-explain-title'))}</b><br>${escHtml(markerExplainTooltip)}
          </span>
        </span>
      </div>

      ${rowHtml(t('ui.settings-view.proxy.detected-shell'), 'ok', escHtml(statusData.shell), '')}
      ${rowHtml(t('ui.settings-view.proxy.profile-path'),
         statusData.profileExisted ? 'ok' : 'warn',
         statusData.profileExisted ? t('ui.settings-view.proxy.profile-exists') : t('ui.settings-view.proxy.profile-not-found'),
         `<code class="settings-meta">${escHtml(statusData.profilePath)}</code>`)}
      ${rowHtml('Port', 'ok', String(snippetData.port), '')}
      ${rowHtml(t('ui.settings-view.proxy.marker-open-label'),
         statusData.hasMarkerOpen ? 'ok' : 'warn',
         statusData.hasMarkerOpen
           ? t('ui.settings-view.proxy.marker-found')
           : t('ui.settings-view.proxy.marker-not-found'),
         `<code class="settings-meta">${escHtml(markerOpenStr)}</code>`)}
      ${rowHtml(t('ui.settings-view.proxy.marker-close-label'),
         statusData.hasMarkerClose ? 'ok' : 'warn',
         statusData.hasMarkerClose
           ? t('ui.settings-view.proxy.marker-found')
           : t('ui.settings-view.proxy.marker-not-found'),
         `<code class="settings-meta">${escHtml(markerCloseStr)}</code>`)}

      <div class="settings-card-sub" style="margin:12px 0 6px">${t('ui.settings-view.proxy.preview-summary')}</div>
      <div class="settings-code-wrap">
        <pre class="settings-code" id="proxySnippet">${escHtml(fullSnippetWithMarkers)}</pre>
        <button class="settings-code-copy" id="proxyCopyBtn" title="${escHtml(t('ui.settings-view.proxy.copy'))}" aria-label="${escHtml(t('ui.settings-view.proxy.copy'))}">
          ${ICON_COPY}
          <span class="settings-code-copy-label">${escHtml(t('ui.settings-view.proxy.copy'))}</span>
        </button>
      </div>
      <div class="settings-card-sub">${t('ui.settings-view.proxy.outro')}</div>
    </div>
  `;

  el.innerHTML = `
    <h3 class="settings-section-title">${t('ui.settings-view.proxy.title')}</h3>

    <div class="settings-card">
      <div class="settings-health-row">
        <span class="settings-health-badge ${healthBadgeClass}">
          <span class="settings-health-icon" aria-hidden="true">${healthIcon}</span>
          <span class="settings-health-text">${escHtml(healthLabel)}</span>
        </span>
      </div>
      <!-- 배지 바로 아래에 *백엔드가 본 경로* 를 명시 노출 — 사용자가 "왜 미설치로 나오는지" 즉시 진단 가능. -->
      <div class="settings-health-target">
        ${t('ui.settings-view.proxy.health-target', {
          path: `<code>${escHtml(statusData.profilePath)}</code>`,
        })}
      </div>
    </div>

    <div class="settings-card">
      <div class="settings-card-title">${t('ui.settings-view.proxy.shell-pick-title')}</div>
      <div class="settings-card-sub">${t('ui.settings-view.proxy.intro')}</div>
      <div class="settings-option-grid" role="radiogroup" aria-label="${t('ui.settings-view.proxy.shell-pick-title')}">
        ${shellCardsHtml}
      </div>
      <!-- 메인 액션 강조 — [프록시 자동 등록] 클릭이 *실제 설치* 의 트리거임을 명확히. -->
      <div class="settings-actions">
        <button class="settings-action-btn settings-action-primary" id="proxyInstallBtn">${t('ui.settings-view.proxy.install')}</button>
      </div>
      <div class="settings-card-sub settings-action-help">${t('ui.settings-view.proxy.action-help')}</div>
      <div class="settings-result" id="proxyResult"></div>
    </div>

    ${engineeringHtml}
  `;

  // 옵션 카드 클릭 — 셸 선택 갱신 + 재렌더 (port/스니펫이 셸 종류에 따라 다름).
  el.querySelectorAll('[data-proxy-shell]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.proxyShell;
      if (!next || next === _proxyShell) return;
      _proxyShell = next;
      renderProxySection();
    });
  });
  el.querySelector('#proxyInstallBtn')?.addEventListener('click', () => onProxyInstall());
  el.querySelector('#proxyCopyBtn')?.addEventListener('click', () => {
    const code = el.querySelector('#proxySnippet')?.textContent ?? '';
    copyToClipboard(code, t('ui.settings-view.proxy.copied'));
  });
}

/**
 * [프록시 자동 등록] 클릭 — 백엔드가 사용자 셸 프로필을 안전하게 수정.
 *
 *   성공 시 결과 영역에 installedTo + backupPath + [이전 셸 설정으로 복구] 버튼 노출.
 *   실패 (마커 손상 등) 시 에러 + 사용자 안내.
 */
async function onProxyInstall() {
  const out = document.getElementById('proxyResult');
  if (!out) return;
  out.innerHTML = `<div class="settings-loading">${t('ui.settings-view.proxy.installing')}</div>`;
  try {
    const res = await fetch('/api/settings/proxy/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shell: _proxyShell }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'install failed');
    const d = json.data;

    const actionLabel = d.action === 'replaced'
      ? t('ui.settings-view.proxy.replaced')
      : t('ui.settings-view.proxy.appended');
    const backupHtml = d.backupPath
      ? `<div class="settings-diff-row settings-diff-info"><b>${t('ui.settings-view.hooks.backup-saved')}</b> <code>${escHtml(d.backupPath)}</code></div>`
      : '';
    const cleanedHtml = d.cleanedGraphModeExports > 0
      ? `<div class="settings-diff-row settings-diff-info"><b>${t('ui.settings-view.proxy.cleaned-graph-exports')}</b> ${d.cleanedGraphModeExports}</div>`
      : '';
    const undoHtml = d.backupPath
      ? `<div class="settings-actions">
           <button class="settings-action-btn settings-action-secondary" id="proxyUndoBtn">${t('ui.settings-view.proxy.undo')}</button>
         </div>`
      : '';

    out.innerHTML = `
      <div class="settings-diff">
        <div class="settings-diff-title">✓ ${t('ui.settings-view.proxy.installed')} (${escHtml(d.shell)}, ${escHtml(actionLabel)})</div>
        <div class="settings-diff-row settings-diff-info"><b>${t('ui.settings-view.proxy.installed-to')}</b> <code>${escHtml(d.installedTo)}</code></div>
        ${backupHtml}
        ${cleanedHtml}
        <div class="settings-diff-row settings-diff-info"><span class="settings-meta">${escHtml(d.nextAction)}</span></div>
        ${undoHtml}
      </div>
    `;

    // Undo 버튼 바인딩.
    out.querySelector('#proxyUndoBtn')?.addEventListener('click', () => onProxyRestore(d.backupPath));
    // 통합 상태 배지/진단 정보 즉시 갱신 — install 직후 마커가 새로 들어갔으므로 status 재fetch 필요.
    //   섹션 전체 재렌더가 가장 단순하지만 결과 영역 (out) 도 함께 사라지므로 잠시 보여준 뒤 재렌더.
    setTimeout(() => { if (_activeTab === 'proxy') refreshProxyStatusInline(); }, 600);
  } catch (err) {
    out.innerHTML = `<div class="settings-error">⚠ ${escHtml(err instanceof Error ? err.message : String(err))}</div>`;
  }
}

/**
 * Proxy 섹션 통합 배지 + 진단 정보만 *부분 재렌더*.
 *
 *   install/restore 성공 직후 통합 상태 배지 ("Proxy 상태: 아직 설치되지 않았습니다") 가
 *   stale 한 채로 남아 사용자에게 혼란을 줌. 결과 영역은 그대로 두고 status 만 다시 조회해
 *   배지/진단 row 만 갱신.
 *
 *   가장 단순한 구현: 전체 renderProxySection() 재호출. 결과 영역(`#proxyResult`) 은
 *   install/restore 가 막 채운 직후라 재렌더 시 사라지지만, 0.6s 지연 후라 사용자가
 *   결과 메시지를 이미 인지한 시점. 또한 마지막에 다시 표시되는 통합 배지로 "지금은 설치됨"
 *   상태가 바로 보임.
 */
async function refreshProxyStatusInline() {
  if (_activeTab !== 'proxy') return;
  await renderProxySection();
}

/** 셸 프로필을 백업본으로 복구. backupPath 가 있어야 활성화. */
async function onProxyRestore(backupPath) {
  const out = document.getElementById('proxyResult');
  if (!out || !backupPath) return;
  const btn = out.querySelector('#proxyUndoBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = t('ui.settings-view.proxy.restoring');
  }
  try {
    const res = await fetch('/api/settings/proxy/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupPath, shell: _proxyShell }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'restore failed');
    const pre = json.data.preRestoreBackup
      ? `<div class="settings-diff-row settings-diff-info"><b>${t('ui.settings-view.hooks.pre-restore-backup')}</b> <code>${escHtml(json.data.preRestoreBackup)}</code></div>`
      : '';
    out.innerHTML = `
      <div class="settings-diff">
        <div class="settings-diff-title">${t('ui.settings-view.proxy.restored')}</div>
        <div class="settings-diff-row settings-diff-info"><b>${t('ui.settings-view.hooks.restored-from')}</b> <code>${escHtml(json.data.targetPath)}</code></div>
        ${pre}
      </div>
    `;
    // 통합 상태 배지/진단 정보 즉시 갱신 — restore 직후 마커가 사라졌으므로 status 재fetch 필요.
    setTimeout(() => { if (_activeTab === 'proxy') refreshProxyStatusInline(); }, 600);
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = t('ui.settings-view.proxy.undo');
    }
    const errBox = document.createElement('div');
    errBox.className = 'settings-error';
    errBox.textContent = `⚠ ${err instanceof Error ? err.message : String(err)}`;
    out.appendChild(errBox);
  }
}

// =============================================================================
// 섹션 5 — 서버 / 로그
// =============================================================================

async function renderServerSection() {
  const gen = _generation;
  renderLoading();
  let diag, logs;
  try {
    const [r1, r2] = await Promise.all([
      fetch('/api/settings/diag').then((r) => r.json()),
      fetch('/api/settings/logs').then((r) => r.json()),
    ]);
    if (!r1.success) throw new Error(r1.error || 'diag failed');
    if (!r2.success) throw new Error(r2.error || 'logs failed');
    diag = r1.data;
    logs = r2.data;
  } catch (err) {
    if (gen !== _generation) return;
    renderError(err);
    return;
  }
  if (gen !== _generation) return;

  const el = contentEl();
  if (!el) return;
  const s = diag.server;
  const portCmd = `SPYGLASS_PORT=${s.port === 9999 ? 8888 : 9999} bun run dev`;

  const logFiles = (logs.files || []).map((f) =>
    `<div class="settings-log-row">
       <code class="settings-log-name">${escHtml(f.name)}</code>
       <span class="settings-meta">${formatBytes(f.sizeBytes)}</span>
       <span class="settings-meta">${formatRelTime(f.mtimeMs)}</span>
     </div>`,
  ).join('');

  el.innerHTML = `
    <h3 class="settings-section-title">${t('ui.settings-view.server.title')}</h3>
    <div class="settings-card">
      ${rowHtml(t('ui.settings-view.diag.port'), 'ok', String(s.port), '')}
      ${rowHtml('PID', 'ok', String(s.pid), '')}
      ${rowHtml(t('ui.settings-view.server.uptime'), 'ok', formatUptime(s.uptimeSec), '')}
      ${rowHtml('Bun', 'ok', s.bunVersion || '?', '')}
      ${rowHtml('cwd', 'ok', '', `<code class="settings-meta">${escHtml(s.cwd)}</code>`)}
    </div>
    <div class="settings-card">
      <div class="settings-card-title">${t('ui.settings-view.server.port-change-title')}</div>
      <div class="settings-card-sub">${t('ui.settings-view.server.port-change-hint')}</div>
      <div class="settings-code-wrap">
        <pre class="settings-code">${escHtml(portCmd)}</pre>
        <button class="settings-code-copy" id="portCmdCopyBtn" title="${escHtml(t('ui.settings-view.proxy.copy'))}" aria-label="${escHtml(t('ui.settings-view.proxy.copy'))}">
          ${ICON_COPY}
          <span class="settings-code-copy-label">${escHtml(t('ui.settings-view.proxy.copy'))}</span>
        </button>
      </div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title">${t('ui.settings-view.server.logs-title')}</div>
      <div class="settings-card-sub"><code>${escHtml(logs.dir)}</code></div>
      <div class="settings-log-list">${logFiles || `<div class="settings-meta">${t('ui.settings-view.server.no-logs')}</div>`}</div>
    </div>
  `;

  el.querySelector('#portCmdCopyBtn')?.addEventListener('click', () => {
    copyToClipboard(portCmd, t('ui.settings-view.proxy.copied'));
  });
}

// =============================================================================
// 공용 헬퍼
// =============================================================================

/**
 * 진단 카드 한 줄 — label + 상태칩 + value + tail (보조 메타/명령어/버튼).
 *
 *   status: 'ok' | 'warn' | 'fail' — 좌측 ✓⚠✕ 아이콘 + 색상.
 */
function rowHtml(label, status, value, tail) {
  const icon = status === 'ok' ? '✓' : status === 'warn' ? '⚠' : '✕';
  return `
    <div class="settings-row settings-row-${status}">
      <span class="settings-row-icon">${icon}</span>
      <span class="settings-row-label">${escHtml(label)}</span>
      <span class="settings-row-value">${escHtml(value)}</span>
      <span class="settings-row-tail">${tail || ''}</span>
    </div>
  `;
}

function formatBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatUptime(sec) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatRelTime(ms) {
  const delta = Date.now() - ms;
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

async function copyToClipboard(text, successLabel) {
  try {
    await navigator.clipboard.writeText(text);
    toast(successLabel || 'Copied');
  } catch {
    toast('Copy failed');
  }
}

function toast(msg) {
  // 간단한 토스트 — body 에 .settings-toast 잠시 부착.
  const el = document.createElement('div');
  el.className = 'settings-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('is-show'), 10);
  setTimeout(() => {
    el.classList.remove('is-show');
    setTimeout(() => el.remove(), 200);
  }, 1800);
}
