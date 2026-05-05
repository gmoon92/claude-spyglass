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
import { detectAnomalies } from './anomaly.js';
import { renderCachePanel } from './cache-panel.js';
import { fetchModelUsage } from './metrics-api.js';
import { FEED_UPDATED } from './events.js';

export const API = '';

// ── 날짜 필터 상태 ──────────────────────────────────────────────────────────
let _activeRange = 'all';
export function setActiveRange(r) { _activeRange = r; }
export function getActiveRange()  { return _activeRange; }

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
export function getDateRange() {
  const now = Date.now();
  if (_activeRange === 'today') {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return { from: start.getTime(), to: now };
  }
  if (_activeRange === 'week') {
    const start = new Date(); start.setDate(start.getDate() - 7); start.setHours(0, 0, 0, 0);
    return { from: start.getTime(), to: now };
  }
  return {};
}

export function buildQuery(base, extra = {}) {
  const range  = getDateRange();
  const params = new URLSearchParams({ ...range, ...extra });
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
    const activeCount = d.summary?.activeSessions ?? 0;
    const activeEl    = document.getElementById('statActive');
    activeEl.textContent = fmt(activeCount);
    const activeCard = activeEl.closest('.header-stat');
    if (activeCard) {
      activeCard.classList.toggle('active', activeCount > 0);
      activeCard.classList.toggle('is-active-indicator', activeCount > 0);
    }
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
        const modelData = await fetchModelUsage({ range: '24h' });
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
    showError(`대시보드 로드 실패: ${err.message}`);
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
    const p95  = json.meta?.p95DurationMs ?? null;
    const anomalyMap = detectAnomalies(list, p95);
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
        `<tr><td colspan="${RECENT_REQ_COLS}" class="table-empty" style="color:var(--red)">요청 목록 로드 실패</td></tr>`;
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
  const [burn, cache, tools, active] = await Promise.all([
    safeJson(buildQuery(`${API}/api/metrics/burn-rate`,      { range: '24h' })),
    safeJson(buildQuery(`${API}/api/metrics/cache-trend`,    { range: '24h' })),
    safeJson(buildQuery(`${API}/api/metrics/tool-categories`, { range: '24h' })),
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
