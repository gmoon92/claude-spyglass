// 세션 상세 뷰 모듈
import { escHtml, fmtToken, fmtDate, fmtTime, formatDuration } from './formatters.js';
import { makeRequestRow, typeBadge, contextPreview, toolStatusBadge, toolResponseHint, toolIconHtml, targetInnerHtml, FLAT_VIEW_COLS, togglePromptExpand, _promptCache } from './renderers.js';
import { renderContextChart, clearContextChart } from './context-chart.js';
import { renderGantt, clearGantt, TOOL_COLORS } from './turn-gantt.js';
import { loadToolStats, clearToolStats } from './tool-stats.js';
import { detectAnomalies } from './anomaly.js';

export const API = '';

let _detailFilter         = 'all';
let _currentSessionId     = null;
let _detailAllRequests    = [];
let _detailAllTurns       = [];
let _detailSearchQuery    = '';
let _detailTurnAnomalyMap = new Map();
let _turnViewMode         = 'list'; // 'list' | 'card'

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
    prompt:   `prompt (${countMap.prompt})`,
    tool_call:`tool_call (${countMap.tool_call})`,
    system:   `system (${countMap.system})`,
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
  if (_turnViewMode === 'card') {
    renderTurnCards(turnFiltered);
  } else {
    renderTurnView(turnFiltered, _detailAllTurns);
  }
  renderContextChart(_detailAllTurns);

  // 이상 감지 맵 빌드 (turn_id 기준으로 집계)
  const rawAnomalyMap = detectAnomalies(_detailAllRequests);
  const reqById = new Map(_detailAllRequests.map(r => [r.id, r]));
  _detailTurnAnomalyMap = new Map();
  for (const [reqId, flags] of rawAnomalyMap) {
    const req = reqById.get(reqId);
    if (req?.turn_id) {
      const existing = _detailTurnAnomalyMap.get(req.turn_id) || new Set();
      for (const f of flags) existing.add(f);
      _detailTurnAnomalyMap.set(req.turn_id, existing);
    }
  }

  renderGantt(_detailAllTurns, _detailTurnAnomalyMap);

  // 플랫 뷰 검색어 필터
  const detailRows = document.querySelectorAll('#detailRequestsBody tr[data-type]');
  detailRows.forEach(tr => {
    if (!_detailSearchQuery) { tr.style.display = ''; return; }
    const text = [
      tr.querySelector('.action-name')?.textContent,
      tr.querySelector('.prompt-preview')?.textContent,
      tr.querySelector('.target-role-badge')?.textContent,
    ].filter(Boolean).join(' ').toLowerCase();
    tr.style.display = text.includes(_detailSearchQuery) ? '' : 'none';
  });
}

export function setDetailView(tab) {
  document.getElementById('detailFlatView').style.display   = tab === 'flat'  ? '' : 'none';
  document.getElementById('detailTurnView').style.display   = tab === 'turn'  ? '' : 'none';
  document.getElementById('detailGanttView').style.display  = tab === 'gantt' ? '' : 'none';
  document.getElementById('detailToolsView').style.display  = tab === 'tools' ? '' : 'none';
  document.getElementById('tabFlat').classList.toggle('active',   tab === 'flat');
  document.getElementById('tabTurn').classList.toggle('active',   tab === 'turn');
  document.getElementById('tabGantt').classList.toggle('active',  tab === 'gantt');
  document.getElementById('tabTools').classList.toggle('active',  tab === 'tools');
  if (tab === 'gantt') renderGantt(_detailAllTurns, _detailTurnAnomalyMap);
  if (tab === 'tools' && _currentSessionId) loadToolStats(_currentSessionId);
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
    let badgesHtml = `<span class="detail-agg-badge" title="이 세션에서 토큰을 가장 많이 소비한 턴">최고 비용 Turn: <strong>T${maxCostTurn.turn_index}</strong> (${fmtToken(maxCostTurn.summary.total_tokens)})</span>`;
    if (topTool) badgesHtml += `<span class="detail-agg-badge" title="이 세션에서 가장 많이 호출된 도구">최다 호출 Tool: <strong>${escHtml(topTool[0])}</strong> (${topTool[1]}회)</span>`;
    badgesEl.innerHTML = badgesHtml;
    badgesEl.classList.remove('detail-agg-badges--hidden');
  } else if (badgesEl) {
    badgesEl.classList.add('detail-agg-badges--hidden');
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
    const metaTitle = `도구: 이 턴에서 실행된 tool_call 수\nIN: 이 턴의 입력 토큰 합계${tokOut > 0 ? `\nOUT: 이 턴의 출력 토큰 합계` : ''}${durMs > 0 ? `\n⏱: 사용자 프롬프트의 LLM 응답 시간` : ''}`;
    const barPct    = sessionTotalTokens > 0
      ? Math.round((turn.summary.total_tokens || 0) / sessionTotalTokens * 100)
      : 0;
    const barHtml   = sessionTotalTokens > 0
      ? `<div class="turn-bar"><div class="bar-track"><div class="bar-fill" style="width:${barPct}%"></div></div><span class="bar-label">${barPct}%</span></div>`
      : '';

    const promptData       = turn.prompt ? { ...turn.prompt, type: 'prompt' } : null;
    const promptPreviewHtml = promptData ? contextPreview(promptData, 80) : '';
    const promptTarget     = promptData ? targetInnerHtml(promptData).html : '';
    const promptRow        = promptData ? `
      <div class="turn-row turn-row-prompt" data-type="prompt">
        <span></span>
        <div class="tool-cell">
          <span class="tool-main">${promptTarget}</span>
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
      const tcTarget    = targetInnerHtml(tcData).html;
      return `
      <div class="turn-row turn-row-tool" data-type="tool_call">
        <span>${statusBadge}</span>
        <div class="tool-cell">
          <span class="tool-main">${tcTarget}</span>
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
        <span class="turn-meta" title="${escHtml(metaTitle)}">${meta}</span>
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
  // 스크롤 위치 복원 (open 상태 복원으로 콘텐츠 높이 변동 후 적용)
  if (scrollEl && savedScroll) scrollEl.scrollTop = savedScroll;
}

export function setTurnViewMode(mode) {
  _turnViewMode = mode;
  applyDetailFilter();
}

export function renderTurnCards(turns) {
  const container = document.getElementById('turnCardBody');
  if (!container) return;
  if (!turns.length) {
    container.innerHTML = '<div class="turn-card-empty">턴 데이터 없음</div>';
    return;
  }

  container.innerHTML = turns.slice().reverse().map(turn => {
    // 복잡도 배지
    const toolCount = turn.summary.tool_call_count;
    const complexBadge = toolCount > 15
      ? '<span class="turn-complexity high">🔺 복잡</span>'
      : toolCount > 5
      ? '<span class="turn-complexity mid">◆ 중간</span>'
      : '';

    // prompt preview
    const promptText = turn.prompt?.preview
      ? escHtml(turn.prompt.preview.slice(0, 60)) + (turn.prompt.preview.length > 60 ? '…' : '')
      : '';

    // 도구 흐름 chip (연속 중복 압축)
    // Agent/Skill 계열은 agentName(tool_detail)까지 압축 키에 포함하여 서로 다른 에이전트를 구분
    const compressed = [];
    for (const tc of turn.tool_calls) {
      const name      = tc.tool_name || '?';
      const isAgent   = /^(Agent|Skill|Task)/.test(name);
      const agentName = isAgent ? (tc.tool_detail || '') : '';
      const key       = name + '|' + agentName;
      const last      = compressed[compressed.length - 1];
      if (compressed.length && last.key === key) {
        last.count++;
      } else {
        compressed.push({ key, name, count: 1, isAgent, agentName });
      }
    }
    const chips = compressed.map(({ name, count, isAgent, agentName }) => {
      const base  = name.split('__').pop();
      const color = TOOL_COLORS[base] || TOOL_COLORS.default;
      if (isAgent && agentName) {
        const countSuffix = count > 1 ? `×${count}` : '';
        const fullLabel   = agentName + (countSuffix ? ` ${countSuffix}` : '');
        return `<span class="tool-chip agent-chip" style="border-color:${color};color:${color}" title="${escHtml(fullLabel)}">${toolIconHtml(base)}<span class="agent-chip-name">${escHtml(agentName)}</span>${countSuffix ? `<span>${escHtml(countSuffix)}</span>` : ''}</span>`;
      }
      const label = count > 1 ? `${base}×${count}` : base;
      return `<span class="tool-chip" style="border-color:${color};color:${color}">${escHtml(label)}</span>`;
    }).join('<span class="chip-arrow">→</span>');

    // 푸터 메트릭
    const tokIn  = fmtToken(turn.summary.tokens_input  || 0);
    const tokOut = fmtToken(turn.summary.tokens_output || 0);
    const dur    = formatDuration(turn.prompt?.duration_ms || 0);

    return `<div class="turn-card">
      <div class="turn-card-header">
        <span class="turn-card-index">T${turn.turn_index}</span>
        ${promptText ? `<span class="turn-card-preview">${promptText}</span>` : ''}
        ${complexBadge}
      </div>
      ${chips ? `<div class="turn-card-flow">${chips}</div>` : ''}
      <div class="turn-card-footer">
        <span>IN ${tokIn}</span>
        <span>OUT ${tokOut}</span>
        ${turn.prompt?.duration_ms ? `<span>⏱ ${dur}</span>` : ''}
      </div>
    </div>`;
  }).join('');
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

export async function loadSessionDetail(sessionId, opts = {}) {
  clearContextChart();
  clearGantt();
  clearToolStats();
  _currentSessionId  = sessionId;
  _detailSearchQuery = '';
  const detailSearchInput = document.getElementById('detailSearchInput');
  if (detailSearchInput) { detailSearchInput.value = ''; }
  const detailSearchClear = document.getElementById('detailSearchClear');
  if (detailSearchClear) detailSearchClear.classList.remove('visible');
  const { signal } = opts;
  const fetchOpts = signal ? { signal } : {};
  const [reqRes, turnRes] = await Promise.all([
    fetch(`${API}/api/sessions/${encodeURIComponent(sessionId)}/requests?limit=200`, fetchOpts),
    fetch(`${API}/api/sessions/${encodeURIComponent(sessionId)}/turns`, fetchOpts),
  ]);
  const [reqJson, turnJson] = await Promise.all([reqRes.json(), turnRes.json()]);
  _detailAllRequests = reqJson.data  || [];
  _detailAllTurns    = turnJson.data || [];
  applyDetailFilter();
}

export function initDetailSearch() {
  const input = document.getElementById('detailSearchInput');
  const clear = document.getElementById('detailSearchClear');
  if (!input || !clear) return;
  input.addEventListener('input', () => {
    _detailSearchQuery = input.value.trim().toLowerCase();
    clear.classList.toggle('visible', _detailSearchQuery.length > 0);
    applyDetailFilter();
  });
  clear.addEventListener('click', () => {
    input.value = '';
    _detailSearchQuery = '';
    clear.classList.remove('visible');
    applyDetailFilter();
    input.focus();
  });
}

// G7: Gantt 클릭 → 턴뷰 연동 이벤트 리스너 등록
export function initGanttNavigation() {
  document.addEventListener('gantt:turnClick', (e) => {
    const { turnId } = e.detail;
    setDetailView('turn');
    // 약간의 딜레이로 DOM 렌더링 후 펼침
    requestAnimationFrame(() => toggleTurn(turnId));
  });
}
