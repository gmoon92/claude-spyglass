// @ts-check
// API / Fetch 모듈
import { fmt, fmtToken, formatDuration } from './formatters.js';
import { setTypeData, setSourceData, drawDonut, renderTypeLegend, getDonutMode } from './chart.js';
import { clearError, showError } from './infra.js';
import { renderProjects, getAllSessions, setAllSessions, renderBrowserSessions } from './left-panel.js';
import {
  renderBurnRate, renderCacheHealth, renderLivePulse,
  renderToolCategoriesCard, renderAnomalyBadge,
} from './obs-panel.js';
import { RECENT_REQ_COLS } from './renderers.js';
// anomaly-bloated-sys ADR-003: 클라이언트 계산 폐기 — 서버가 응답 행에 `bloated_sys`/`agent_spike`
// 필드를 직접 채워 보낸다. detectAnomalies 호출 제거 (api.js → renderers/rows.js 가 그 필드를 그대로 표시).
// SSoT: packages/server/src/metrics/calculators/anomaly.ts
import { getAnomalyFlagsForRow } from './anomaly.js';
import { renderCachePanel } from './cache-panel.js';
import { fetchModelUsage } from './metrics-api.js';
import { FEED_UPDATED } from './events.js';

export const API = '';

// ── 날짜 필터 상태 (date-range-filter ADR-001/002/003) ─────────────────────
//
// _activeRange는 frozen discriminated union (ADR-001):
//   PresetRange  = { type:'preset', value:'1h'|'today'|'yesterday'|'7d'|'30d'|'all' }
//   CustomRange  = { type:'custom', from:number, to:number }   // 절대시각 (ms epoch)
//
// 외부 호출자 인터페이스:
//   - getDateRange(): {} | {from:number, to:number}  ← 공개 계약 (ADR-002, 절대 변경 금지)
//   - setActiveRange(stringOrObject): normalize + freeze + 'cs:active-range-changed' 이벤트 발행
//   - getActiveRange(): 현재 활성 range 객체 (읽기 전용 frozen)
//
/** @typedef {'1h'|'today'|'yesterday'|'7d'|'30d'|'all'|'week'} PresetValue 'week'는 legacy 호환(T-06 제거 예정) */
/** @typedef {{type:'preset', value:PresetValue}} PresetRange */
/** @typedef {{type:'custom', from:number, to:number}} CustomRange */
/** @typedef {PresetRange | CustomRange} ActiveRange */

/** @type {ActiveRange} */
let _activeRange = Object.freeze({ type: 'preset', value: 'all' });

const VALID_PRESETS = new Set(['1h', 'today', 'yesterday', '7d', '30d', 'all', 'week']); // 'week'는 legacy 호환만 (T-06에서 제거)

/**
 * 문자열/객체 입력을 ActiveRange 객체로 정규화 (ADR-003 어댑터).
 * - 'today' 같은 문자열 → {type:'preset', value:'today'}
 * - {type:'custom', from, to} → 숫자 변환 + 그대로
 * - 기타 → {type:'preset', value:'all'} fallback
 * @param {string|ActiveRange} input
 * @returns {ActiveRange}
 */
function normalizeRange(input) {
  if (typeof input === 'string') {
    // VALID_PRESETS.has가 런타임 유효성을 보장하므로 PresetValue로 좁힘 (tsc는 Set.has를 narrowing 못함).
    const value = /** @type {PresetValue} */ (VALID_PRESETS.has(input) ? input : 'all');
    return { type: 'preset', value };
  }
  if (input && input.type === 'custom') {
    return { type: 'custom', from: +input.from, to: +input.to };
  }
  if (input && input.type === 'preset' && VALID_PRESETS.has(input.value)) {
    return { type: 'preset', value: input.value };
  }
  return { type: 'preset', value: 'all' };
}

/** @param {ActiveRange} a @param {ActiveRange} b */
function sameRange(a, b) {
  if (a.type !== b.type) return false;
  // type 동일성은 위에서 보장됨 — tsc는 a의 discriminant로 b를 좁히지 못하므로 명시 캐스팅.
  if (a.type === 'preset') return a.value === /** @type {PresetRange} */ (b).value;
  return a.from === /** @type {CustomRange} */ (b).from && a.to === /** @type {CustomRange} */ (b).to;
}

/**
 * 활성 range 변경. normalize + freeze + no-op 가드 + CustomEvent 통지 (ADR-003).
 * 문자열·객체 모두 수용하여 PR1~PR3 점진 마이그레이션 동안 후방호환 유지.
 * 통지 이벤트: `cs:active-range-changed` (detail = 새 ActiveRange).
 * @param {string|ActiveRange} input
 */
export function setActiveRange(input) {
  const next = normalizeRange(input);
  if (sameRange(_activeRange, next)) return;
  _activeRange = Object.freeze(next);
  // 테스트(non-DOM) 환경 호환 — document 미존재 시 통지만 생략, 상태 변경은 유지.
  if (typeof document !== 'undefined' && typeof CustomEvent !== 'undefined') {
    document.dispatchEvent(new CustomEvent('cs:active-range-changed', { detail: _activeRange }));
  }
}

/** @returns {ActiveRange} */
export function getActiveRange() { return _activeRange; }

// ── 요청 목록 상태 ──────────────────────────────────────────────────────────
export let reqFilter = 'all';
export let reqOffset = 0;
export const REQ_PAGE = 200;
export let isSSEConnected = false;

export function setReqFilter(f)     { reqFilter = f; }
export function getReqFilter()      { return reqFilter; }
export function setReqOffset(n)     { reqOffset = n; }
export function setIsSSEConnected(v){ isSSEConnected = v; }

// ── URL 빌더 ────────────────────────────────────────────────────────────────

/**
 * 순수 함수 — ActiveRange + now(ms epoch)를 받아 from/to 계산.
 * 테스트 용이성을 위해 export (TZ 의존을 now 주입으로 격리).
 * CONTRACT: returns {} or {from:number, to:number}. DO NOT leak {type, value}.
 * 타입 표기는 `{from?, to?}` (런타임은 빈 객체 또는 둘 다 채움 — 부분 객체 미발생).
 * @param {ActiveRange} activeRange
 * @param {number} now
 * @returns {{from?:number, to?:number}}
 */
export function computeRange(activeRange, now) {
  if (activeRange.type === 'custom') {
    if (!Number.isFinite(activeRange.from) || !Number.isFinite(activeRange.to)) {
      console.warn('[api] custom range missing from/to → falling back to {}', activeRange);
      return {};
    }
    return { from: activeRange.from, to: activeRange.to };
  }
  // preset
  switch (activeRange.value) {
    case '1h': {
      return { from: now - 60 * 60 * 1000, to: now };
    }
    case 'today': {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      return { from: start.getTime(), to: now };
    }
    case 'yesterday': {
      const start = new Date(now); start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0);
      const end   = new Date(now); end.setHours(0, 0, 0, 0);
      return { from: start.getTime(), to: end.getTime() - 1 };
    }
    case '7d': {
      return { from: now - 7 * 24 * 60 * 60 * 1000, to: now };
    }
    case '30d': {
      return { from: now - 30 * 24 * 60 * 60 * 1000, to: now };
    }
    case 'week': {
      // legacy 호환 — T-06에서 제거되지만 transitional 안전망
      const start = new Date(now); start.setDate(start.getDate() - 7); start.setHours(0, 0, 0, 0);
      return { from: start.getTime(), to: now };
    }
    case 'all':
    default:
      return {};
  }
}

/**
 * 활성 range를 from/to로 계산.
 * CONTRACT: returns {} or {from:number, to:number}. DO NOT leak {type, value}.
 * 변경 시 buildQuery / chart-policy / fetchAllSessions 전 호출자 점검 필수 (ADR-002).
 * @returns {{from?:number, to?:number}}
 */
export function getDateRange() {
  return computeRange(_activeRange, Date.now());
}

/**
 * /api/metrics/* 호출용 활성 range 파라미터 (date-filter-propagation pass).
 *
 * 서버 metrics 라우터는 `?from=&to=`(우선) 또는 `?range=24h|7d|30d|all` (기본 24h)을 받는다.
 * getDateRange()가 빈 객체를 반환하는 '전체' 상태에선 서버 기본 24h로 떨어지므로,
 * 명시적으로 `range:'all'`을 보내 사용자 의도(전체 기간)를 정확히 전달.
 */
export function getMetricRangeParams() {
  const dr = getDateRange();
  if (dr.from != null && dr.to != null) return dr;
  return { range: 'all' };
}

export function buildQuery(base, extra = {}) {
  const range  = getDateRange();
  // URLSearchParams는 number 값을 런타임에서 문자열화함 — 타입만 Record<string,string>로 캐스팅.
  const params = new URLSearchParams(/** @type {Record<string, string>} */ (/** @type {unknown} */ ({ ...range, ...extra })));
  const qs     = params.toString();
  return qs ? `${base}?${qs}` : base;
}

// ── Dashboard ───────────────────────────────────────────────────────────────
export async function fetchDashboard() {
  try {
    const res  = await fetch(buildQuery(`${API}/api/dashboard`), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const d    = json.data;

    document.getElementById('statSessions').textContent    = fmt(d.summary?.totalSessions ?? 0);
    document.getElementById('statRequests').textContent    = fmt(d.summary?.totalRequests ?? 0);
    document.getElementById('statTokens').textContent      = fmtToken(d.summary?.totalTokens ?? 0);
    // brand-strip-cleanup ADR-001: #statActive 노드가 제거되어 옵셔널 체이닝으로 안전 처리.
    // 활성 세션 시각화는 obs-panel.LivePulse 카드(#obsLivePulse)가 SSoT로 담당.
    // ADR-004: 백엔드 summary.activeSessions 필드는 향후 재활용 가능성 위해 보존됨.
    const statActiveEl = document.getElementById('statActive');
    if (statActiveEl) statActiveEl.textContent = fmt(d.summary?.activeSessions ?? 0);
    document.getElementById('statAvgDuration').textContent =
      formatDuration(d.summary?.avgDurationMs ?? d.requests?.avg_duration_ms ?? null);

    // ── Command Center: 성능 지표 (ADR-015 — costUsd / cacheSavingsUsd 제거) ──
    const p95Ms = d.summary?.p95DurationMs;
    if (p95Ms != null) {
      document.getElementById('stat-p95').textContent =
        p95Ms < 1000 ? `${Math.round(p95Ms)}ms` : `${(p95Ms / 1000).toFixed(1)}s`;
    }

    const errorRate = d.summary?.errorRate;
    if (errorRate != null) {
      const errEl = document.getElementById('stat-error-rate');
      errEl.textContent = `${(Number(errorRate) * 100).toFixed(1)}%`;
      const errCard = errEl.closest('.header-stat');
      if (errCard) {
        errCard.classList.toggle('is-error', errorRate > 0);
        errCard.classList.toggle('is-critical', errorRate > 0.01);
      }
    }

    renderProjects(d.projects || []);
    setTypeData((d.types || []).sort((a, b) => b.count - a.count));

    // v21 fix: SSE 도착 시 도넛 갱신 보장 — model 분포는 별도 metrics 엔드포인트라
    //   default-view.setChartMode가 페이지 로드 시 1회만 fetch했던 한계로 SSE 도착 후
    //   stale 채로 남는 버그가 있었음. donutMode가 'model'이면 매 fetchDashboard마다 같이 갱신.
    if (getDonutMode() === 'model') {
      try {
        // date-filter-propagation pass: 활성 range 반영 (이전엔 '24h' 하드코딩이라
        // 사용자가 '전체'/'오늘'/'이번주'를 눌러도 도넛이 24h 그대로였음)
        const modelData = await fetchModelUsage(getMetricRangeParams());
        setSourceData('model', modelData || []);
      } catch { /* silent — 도넛 stale 유지 */ }
    }

    drawDonut();
    renderTypeLegend();
    clearError();
    // 옵저빌리티 패널은 dashboard 갱신 트리거에 맞춰 함께 갱신
    // (left-panel-observability-revamp ADR-003 — 별도 Promise.all 병렬)
    fetchObservability();
  } catch (err) {
    showError(window.I18n.t('common.api-error.dashboard-load-failed', { message: err.message }));
  }
}

// ── Requests ────────────────────────────────────────────────────────────────
export async function fetchRequests(append = false) {
  if (!append) { reqOffset = 0; }
  try {
    let url;
    if (reqFilter === 'all') {
      url = buildQuery(`${API}/api/requests`, { limit: REQ_PAGE, offset: reqOffset });
    } else {
      url = buildQuery(`${API}/api/requests/by-type/${encodeURIComponent(reqFilter)}`, { limit: REQ_PAGE, offset: reqOffset });
    }
    const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = json.data || [];
    // anomaly-bloated-sys ADR-003: 서버가 채운 bloated_sys/agent_spike 필드를 row.id → Set 으로 매핑.
    //  - 클라이언트 계산 없음 (detectAnomalies 폐기, packages/web/assets/js/anomaly.js 참고).
    //  - 향후 spike/loop/slow 도 서버 응답 필드로 흡수되면 getAnomalyFlagsForRow 가 통합 표시.
    //  - p95DurationMs(meta.p95DurationMs) 는 다른 위젯이 여전히 사용 가능하므로 응답 유지.
    const anomalyMap = new Map();
    for (const r of list) {
      const flags = getAnomalyFlagsForRow(r);
      if (flags.size > 0) anomalyMap.set(r.id, flags);
    }
    document.dispatchEvent(new CustomEvent(FEED_UPDATED, {
      detail: { list, anomalyMap, append },
    }));
    reqOffset += list.length;
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) {
      loadMoreBtn.style.display = (list.length === REQ_PAGE && !isSSEConnected) ? '' : 'none';
    }
  } catch {
    if (!append) {
      document.getElementById('requestsBody').innerHTML =
        `<tr><td colspan="${RECENT_REQ_COLS}" class="table-empty" style="color:var(--red)">${window.I18n.t('common.api-error.request-list-load-failed')}</td></tr>`;
    }
  }
}

// ── Sessions ────────────────────────────────────────────────────────────────
export async function fetchAllSessions() {
  try {
    const res  = await fetch(buildQuery(`${API}/api/sessions`, { limit: 500, ...getDateRange() }));
    const json = await res.json();
    setAllSessions(json.data || []);
    renderBrowserSessions();
  } catch { /* silent */ }
}

export async function fetchCacheStats() {
  try {
    const res  = await fetch(buildQuery(`${API}/api/stats/cache`), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return;
    const json = await res.json();
    renderCachePanel(json.data);
  } catch { /* silent */ }
}

export async function fetchSessionsByProject(projectName) {
  try {
    const res  = await fetch(buildQuery(`${API}/api/projects/${encodeURIComponent(projectName)}/sessions`, { limit: 200 }));
    const json = await res.json();
    const others = getAllSessions().filter(s => s.project_name !== projectName);
    setAllSessions([...others, ...(json.data || [])]);
    renderBrowserSessions();
  } catch { /* silent */ }
}

// ── Observability Panel (좌측 사이드바 4 카드 + Anomaly Badge) ──────────────
// left-panel-observability-revamp ADR-003/004:
//   /api/metrics/* 라우트 4개 병렬 호출 → 위젯별 raw payload 그대로 전달.
//   fetch 실패 시 위젯은 함수 내부에서 빈 상태 처리 (콘솔 throw 금지).
async function safeJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.data ?? null;
  } catch { return null; }
}

export async function fetchObservability() {
  // date-filter-propagation pass: 활성 range가 from/to로 자동 적용되도록 buildQuery만 사용.
  // 이전엔 extra에 `range:'24h'`를 박아넣어 '전체'/'오늘'/'이번주' 클릭 시에도 obs 카드가 24h 그대로였음.
  // '전체' 상태는 buildQuery에서 from/to가 빠지면 서버 기본값(24h)으로 떨어지므로 range='all' 명시.
  const rangeExtra = (() => {
    const dr = getDateRange();
    return (dr.from != null && dr.to != null) ? {} : { range: 'all' };
  })();
  const [burn, cache, tools, active] = await Promise.all([
    safeJson(buildQuery(`${API}/api/metrics/burn-rate`,      rangeExtra)),
    safeJson(buildQuery(`${API}/api/metrics/cache-trend`,    rangeExtra)),
    safeJson(buildQuery(`${API}/api/metrics/tool-categories`, rangeExtra)),
    safeJson(`${API}/api/sessions/active`),
  ]);

  renderBurnRate(burn);
  renderCacheHealth(cache);
  renderToolCategoriesCard(Array.isArray(tools) ? tools : []);

  // Live Pulse (Phase 1 간소형) — 활성 세션 수 + 마지막 활동 시각만.
  // recent_calls sparkline은 Phase 2.
  const activeArr = Array.isArray(active) ? active : [];
  const lastEventTs = activeArr.reduce((m, s) => Math.max(m, s.last_activity_at || 0), 0) || null;
  renderLivePulse({
    active_count: activeArr.length,
    last_event_ts: lastEventTs,
    recent_calls: [],
  });

  // Anomaly Badge — Phase 2에서 정확화. 현재는 hidden 유지.
  renderAnomalyBadge(null);
}

// ── Proxy Requests ──────────────────────────────────────────────────────────
export async function fetchProxyRequests(limit = 50) {
  try {
    const url  = `${API}/api/proxy-requests?limit=${limit}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.data || [];
  } catch { return []; }
}

export async function fetchProxyStats(since) {
  try {
    const sinceMs = since ?? (Date.now() - 24 * 60 * 60 * 1000);
    const url  = `${API}/api/proxy-requests/stats?since=${sinceMs}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.data ?? json;
  } catch { return null; }
}
