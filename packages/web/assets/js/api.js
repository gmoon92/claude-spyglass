// API / Fetch 모듈
import { fmt, fmtToken, formatDuration } from './formatters.js';
import { setTypeData, drawDonut, renderTypeLegend } from './chart.js';
import { clearError, setLastUpdated } from './infra.js';
import { renderProjects, renderTools, getAllSessions, setAllSessions, renderBrowserSessions } from './left-panel.js';
import { renderRequests, appendRequests, RECENT_REQ_COLS } from './renderers.js';

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
    activeEl.closest('.stat-card').classList.toggle('active', activeCount > 0);
    document.getElementById('statAvgDuration').textContent =
      formatDuration(d.summary?.avgDurationMs || d.requests?.avg_duration_ms || 0);

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

function showError(msg) {
  // infra.showError와 동일 — 순환 import 방지를 위해 직접 호출
  document.getElementById('errorMsg').textContent = msg || '서버에 연결할 수 없습니다.';
  document.getElementById('errorBanner').classList.add('visible');
  const b = document.getElementById('liveBadge');
  b.className = 'badge-live disconnected';
  b.innerHTML = '<span class="dot"></span>OFFLINE';
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
    if (append) {
      appendRequests(list);
    } else {
      renderRequests(list);
    }
    document.dispatchEvent(new CustomEvent('feed:updated'));
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

export async function fetchSessionsByProject(projectName) {
  try {
    const res  = await fetch(buildQuery(`${API}/api/projects/${encodeURIComponent(projectName)}/sessions`, { limit: 200 }));
    const json = await res.json();
    const others = getAllSessions().filter(s => s.project_name !== projectName);
    setAllSessions([...others, ...(json.data || [])]);
    renderBrowserSessions();
  } catch { /* silent */ }
}
