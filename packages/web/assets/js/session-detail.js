// 세션 상세 뷰 모듈
import { escHtml, fmtToken, fmtDate, fmtTime, formatDuration } from './formatters.js';
import { makeRequestRow, typeBadge, makeActionCell, contextPreview, toolStatusBadge, toolResponseHint, FLAT_VIEW_COLS, togglePromptExpand, _promptCache } from './renderers.js';

export const API = '';

let _detailFilter      = 'all';
let _detailAllRequests = [];
let _detailAllTurns    = [];

export function getDetailFilter()     { return _detailFilter; }
export function setDetailFilter(f)    { _detailFilter = f; }
export function getDetailRequests()   { return _detailAllRequests; }
export function getDetailTurns()      { return _detailAllTurns; }

export function renderDetailRequests(list) {
  const body     = document.getElementById('detailRequestsBody');
  const scrollEl = document.getElementById('detailFlatView');
  const savedScroll = scrollEl?.scrollTop ?? 0;

  // SSE 갱신 시 열린 프롬프트 확장 행 보존
  const expandedFor = body.querySelector('[data-expand-for]')?.dataset.expandFor ?? null;

  if (!list.length) {
    body.innerHTML = `<tr><td colspan="${FLAT_VIEW_COLS}" class="table-empty">요청 데이터 없음</td></tr>`;
    return;
  }
  const rows = list.map(r => makeRequestRow(r, { showSession: false, fmtTime: fmtDate })).join('');
  const typeCounts = {};
  list.forEach(r => { typeCounts[r.type] = (typeCounts[r.type] || 0) + 1; });
  const subtotalParts = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${typeBadge(type)}&nbsp;${count}건`)
    .join('&ensp;');
  const subtotalRow = `<tr class="flat-subtotal"><td colspan="${FLAT_VIEW_COLS}" style="text-align:right">${subtotalParts}</td></tr>`;
  body.innerHTML = rows + subtotalRow;

  // 스크롤 위치 복원
  if (scrollEl && savedScroll) scrollEl.scrollTop = savedScroll;

  // 프롬프트 확장 상태 복원 (캐시에 텍스트가 남아 있고 행이 여전히 존재할 때)
  if (expandedFor && _promptCache.has(expandedFor)) {
    const previewEl = body.querySelector(`[data-expand-id="${CSS.escape(expandedFor)}"]`);
    const tr = previewEl?.closest('tr') ?? null;
    if (tr) togglePromptExpand(expandedFor, tr, FLAT_VIEW_COLS);
  }
}

export function applyDetailFilter() {
  const countMap = { all: _detailAllRequests.length, prompt: 0, tool_call: 0, system: 0 };
  _detailAllRequests.forEach(r => { if (r.type in countMap) countMap[r.type]++; });
  const labelMap = {
    all:      `All (${countMap.all})`,
    prompt:   `Prompt (${countMap.prompt})`,
    tool_call:`Tool (${countMap.tool_call})`,
    system:   `System (${countMap.system})`,
  };
  document.querySelectorAll('#detailTypeFilterBtns .type-filter-btn').forEach(b => {
    if (labelMap[b.dataset.detailFilter]) b.textContent = labelMap[b.dataset.detailFilter];
  });

  const flatFiltered = _detailFilter === 'all'
    ? _detailAllRequests
    : _detailAllRequests.filter(r => r.type === _detailFilter);
  renderDetailRequests(flatFiltered);

  const turnFiltered = _detailFilter === 'all'    ? _detailAllTurns
    : _detailFilter === 'tool_call'               ? _detailAllTurns.filter(t => t.tool_calls.length > 0)
    : _detailFilter === 'prompt'                  ? _detailAllTurns.filter(t => !!t.prompt)
    : [];
  renderTurnView(turnFiltered, _detailAllTurns);
}

export function setDetailView(tab) {
  document.getElementById('detailFlatView').style.display  = tab === 'flat' ? '' : 'none';
  document.getElementById('detailTurnView').style.display  = tab === 'turn' ? '' : 'none';
  document.getElementById('tabFlat').classList.toggle('active', tab === 'flat');
  document.getElementById('tabTurn').classList.toggle('active', tab === 'turn');
}

export function toggleTurn(turnId) {
  const el = document.querySelector(`[data-turn-id="${CSS.escape(turnId)}"]`);
  if (el) el.classList.toggle('open');
}

export function renderTurnView(turns, badgeTurns) {
  const container   = document.getElementById('turnListBody');
  const scrollEl    = document.getElementById('detailTurnView');
  const savedScroll = scrollEl?.scrollTop ?? 0;
  const badgesEl    = document.getElementById('detailBadges');
  const bTurns      = (badgeTurns && badgeTurns.length) ? badgeTurns : turns;
  const sessionTotalTokens = bTurns.reduce((s, t) => s + (t.summary.total_tokens || 0), 0);

  // SSE 갱신 전 UI 상태 캡처
  const openTurnIds = new Set(
    [...container.querySelectorAll('.turn-item.open')].map(el => el.dataset.turnId)
  );
  const expandedFor = container.querySelector('[data-expand-for]')?.dataset.expandFor ?? null;

  if (badgesEl && sessionTotalTokens > 0) {
    const maxCostTurn = bTurns.reduce((a, b) =>
      (a.summary.total_tokens > b.summary.total_tokens ? a : b));
    const toolCountMap = {};
    bTurns.forEach(t => t.tool_calls.forEach(tc => {
      if (tc.tool_name) toolCountMap[tc.tool_name] = (toolCountMap[tc.tool_name] || 0) + 1;
    }));
    const topTool = Object.entries(toolCountMap).sort((a, b) => b[1] - a[1])[0];
    let badgesHtml = `<span class="detail-agg-badge">최고 비용 Turn: <strong>T${maxCostTurn.turn_index}</strong> (${fmtToken(maxCostTurn.summary.total_tokens)})</span>`;
    if (topTool) badgesHtml += `<span class="detail-agg-badge">최다 호출 Tool: <strong>${escHtml(topTool[0])}</strong> (${topTool[1]}회)</span>`;
    badgesEl.innerHTML     = badgesHtml;
    badgesEl.style.display = 'flex';
  } else if (badgesEl) {
    badgesEl.style.display = 'none';
  }

  if (!turns.length) {
    container.innerHTML = '<div class="turn-row-empty">턴 데이터 없음</div>';
    return;
  }

  container.innerHTML = turns.slice().reverse().map(turn => {
    const toolCount = turn.summary.tool_call_count;
    const tokIn     = turn.summary.tokens_input  ?? 0;
    const tokOut    = turn.summary.tokens_output ?? 0;
    const durMs     = turn.prompt?.duration_ms ?? 0;
    const outPart   = tokOut > 0 ? ` / OUT ${fmtToken(tokOut)}` : '';
    const meta      = `도구 ${toolCount}개 · IN ${fmtToken(tokIn)}${outPart}${durMs > 0 ? ` · ⏱ ${formatDuration(durMs)}` : ''}`;
    const barPct    = sessionTotalTokens > 0
      ? Math.round((turn.summary.total_tokens || 0) / sessionTotalTokens * 100)
      : 0;
    const barHtml   = sessionTotalTokens > 0
      ? `<div class="turn-bar"><div class="bar-track"><div class="bar-fill" style="width:${barPct}%"></div></div><span class="bar-label">${barPct}%</span></div>`
      : '';

    const promptData       = turn.prompt ? { ...turn.prompt, type: 'prompt' } : null;
    const promptPreviewHtml = promptData ? contextPreview(promptData, 80) : '';
    const promptRow        = promptData ? `
      <div class="turn-row turn-row-prompt" data-type="prompt">
        <span></span>
        <div class="tool-cell">
          <span class="tool-main">${makeActionCell(promptData)}</span>
          ${promptPreviewHtml ? `<span class="tool-sub">${promptPreviewHtml}</span>` : ''}
        </div>
        <span class="num cell-token">${promptData.tokens_input  > 0 ? fmtToken(promptData.tokens_input)  : '—'}</span>
        <span class="num cell-token">${promptData.tokens_output > 0 ? fmtToken(promptData.tokens_output) : '—'}</span>
        <span class="num cell-token" style="color:var(--text-dim)">${formatDuration(promptData.duration_ms)}</span>
        <span class="num cell-time"  style="color:var(--text-dim)">${fmtDate(promptData.timestamp)}</span>
      </div>` : '';

    const toolRows = turn.tool_calls.map(tc => {
      const tcData      = { ...tc, type: 'tool_call' };
      const tcPreview   = contextPreview(tcData, 60);
      const hint        = toolResponseHint(tcData);
      const statusBadge = toolStatusBadge(tcData);
      return `
      <div class="turn-row turn-row-tool" data-type="tool_call">
        <span>${statusBadge}</span>
        <div class="tool-cell">
          <span class="tool-main">${makeActionCell(tcData)}</span>
          <span class="tool-sub">${tcPreview || ''}${hint ? `${tcPreview ? ' ' : ''}<span class="tool-response-hint">${escHtml(hint)}</span>` : ''}</span>
        </div>
        <span class="num cell-token">${tc.tokens_input  > 0 ? fmtToken(tc.tokens_input)  : '—'}</span>
        <span class="num cell-token">${tc.tokens_output > 0 ? fmtToken(tc.tokens_output) : '—'}</span>
        <span class="num cell-token" style="color:var(--text-dim)">${formatDuration(tc.duration_ms)}</span>
        <span class="num cell-time"  style="color:var(--text-dim)">${fmtDate(tc.timestamp)}</span>
      </div>`;
    }).join('');

    return `<div class="turn-item" data-turn-id="${escHtml(turn.turn_id)}">
      <div class="turn-header" data-toggle-turn="${escHtml(turn.turn_id)}">
        <span class="turn-badge">T${turn.turn_index}</span>
        <span class="turn-time">${fmtTime(turn.started_at)}</span>
        <span class="turn-meta">${meta}</span>
        ${barHtml}
        <span class="turn-toggle">▸</span>
      </div>
      <div class="turn-children">
        ${promptRow}
        ${toolRows || '<div class="turn-row-empty">도구 호출 없음</div>'}
      </div>
    </div>`;
  }).join('');

  // SSE 갱신 후 UI 상태 복원
  if (openTurnIds.size > 0) {
    container.querySelectorAll('.turn-item[data-turn-id]').forEach(el => {
      if (openTurnIds.has(el.dataset.turnId)) el.classList.add('open');
    });
  }
  if (expandedFor && _promptCache.has(expandedFor)) {
    const previewEl = container.querySelector(`[data-expand-id="${CSS.escape(expandedFor)}"]`);
    const rowContainer = previewEl?.closest('.turn-row') ?? null;
    if (rowContainer) togglePromptExpand(expandedFor, rowContainer);
  }
}

export async function refreshDetailSession(sessionId) {
  if (!sessionId) return;
  try {
    const [reqRes, turnRes] = await Promise.all([
      fetch(`${API}/api/sessions/${encodeURIComponent(sessionId)}/requests?limit=200`),
      fetch(`${API}/api/sessions/${encodeURIComponent(sessionId)}/turns`),
    ]);
    const [reqJson, turnJson] = await Promise.all([reqRes.json(), turnRes.json()]);
    _detailAllRequests = reqJson.data  || [];
    _detailAllTurns    = turnJson.data || [];
    applyDetailFilter();
  } catch { /* silent */ }
}

export async function loadSessionDetail(sessionId) {
  const [reqRes, turnRes] = await Promise.all([
    fetch(`${API}/api/sessions/${encodeURIComponent(sessionId)}/requests?limit=200`),
    fetch(`${API}/api/sessions/${encodeURIComponent(sessionId)}/turns`),
  ]);
  const [reqJson, turnJson] = await Promise.all([reqRes.json(), turnRes.json()]);
  _detailAllRequests = reqJson.data  || [];
  _detailAllTurns    = turnJson.data || [];
  applyDetailFilter();
}
