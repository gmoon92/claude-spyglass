// API / Fetch 모듈
import { fmt, fmtToken, formatDuration } from './formatters.js';
import { setTypeData, drawDonut, renderTypeLegend } from './chart.js';
import { clearError, setLastUpdated, showError } from './infra.js';
import { renderProjects, renderTools, getAllSessions, setAllSessions, renderBrowserSessions } from './left-panel.js';
import { RECENT_REQ_COLS } from './renderers.js';
import { detectAnomalies } from './anomaly.js';
import { renderCachePanel } from './cache-panel.js';
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
    renderTools(d.tools || []);
    setTypeData((d.types || []).sort((a, b) => b.count - a.count));
    drawDonut();
    renderTypeLegend();
    clearError();
    setLastUpdated();
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
