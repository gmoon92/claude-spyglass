// 세션 상세 뷰 모듈
import { createSearchBox } from './components/search-box.js';
import { subTypeOf, SUB_TYPES } from './request-types.js';
import { escHtml, fmtToken, fmtDate, fmtTime, formatDuration } from './formatters.js';
import { makeRequestRow, typeBadge, contextPreview, toolStatusBadge, toolResponseHint, toolIconHtml, targetInnerHtml, FLAT_VIEW_COLS, togglePromptExpand, _promptCache } from './renderers.js';
import { renderContextChart, clearContextChart } from './context-chart.js';
import { renderGantt, clearGantt, TOOL_COLORS } from './turn-gantt.js';
import { loadToolStats, clearToolStats } from './tool-stats.js';
import { detectAnomalies } from './anomaly.js';
// ADR-017: 세션 모드일 때 chartSection의 donut/cache panel을 세션 데이터로 갱신
import { setTypeData, drawDonut, renderTypeLegend } from './chart.js';
import { renderCachePanel, computeSessionCacheStats } from './cache-panel.js';
import { GANTT_TURN_CLICK } from './events.js';

export const API = '';

let _detailFilter         = 'all';
let _currentSessionId     = null;
let _detailAllRequests    = [];
let _detailAllTurns       = [];
let _detailSearchQuery    = '';
let _detailTurnAnomalyMap = new Map();
let _expandedTurnIds      = new Set(); // accordion 펼침 상태 유지
export let detailSearchBox = null;

export function getDetailFilter()     { return _detailFilter; }
export function setDetailFilter(f)    { _detailFilter = f; }
export function getDetailRequests()   { return _detailAllRequests; }
export function getDetailTurns()      { return _detailAllTurns; }

export function renderDetailRequests(list, anomalyMap = new Map()) {
  const body     = document.getElementById('detailRequestsBody');
  const scrollEl = document.getElementById('detailFlatView');
  const savedScroll = scrollEl?.scrollTop ?? 0;

  // SSE 갱신 시 열린 프롬프트 확장 행 보존
  const expandedFor = body.querySelector('[data-expand-for]')?.dataset.expandFor ?? null;

  if (!list.length) {
    body.innerHTML = `<tr><td colspan="${FLAT_VIEW_COLS}" class="state-empty-cell">데이터가 없습니다</td></tr>`;
    return;
  }
  // ADR-011: detail flat view에도 anomaly 배지 적용
  const rows = list.map(r => makeRequestRow(r, {
    showSession: false,
    fmtTime: fmtDate,
    anomalyFlags: anomalyMap.get(r.id) || null,
  })).join('');
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
  const countMap = { all: _detailAllRequests.length, prompt: 0, tool_call: 0, system: 0, agent: 0, skill: 0, mcp: 0 };
  _detailAllRequests.forEach(r => {
    if (r.type in countMap) countMap[r.type]++;
    const sub = subTypeOf(r);
    if (sub) countMap[sub]++;
  });
  const labelMap = {
    all:      `All (${countMap.all})`,
    prompt:   `prompt (${countMap.prompt})`,
    tool_call:`tool_call (${countMap.tool_call})`,
    system:   `system (${countMap.system})`,
    agent:    `Agent (${countMap.agent})`,
    skill:    `Skill (${countMap.skill})`,
    mcp:      `MCP (${countMap.mcp})`,
  };
  document.querySelectorAll('#detailTypeFilterBtns .type-filter-btn').forEach(b => {
    if (labelMap[b.dataset.detailFilter]) b.textContent = labelMap[b.dataset.detailFilter];
  });

  const flatFiltered = _detailFilter === 'all'    ? _detailAllRequests
    : SUB_TYPES.includes(_detailFilter)           ? _detailAllRequests.filter(r => subTypeOf(r) === _detailFilter)
    : _detailAllRequests.filter(r => r.type === _detailFilter);
  // ADR-011: anomaly map을 미리 빌드하여 detail flat에도 배지 적용
  const flatAnomalyMap = detectAnomalies(_detailAllRequests);
  renderDetailRequests(flatFiltered, flatAnomalyMap);

  const turnFiltered = _detailFilter === 'all'                          ? _detailAllTurns
    : _detailFilter === 'tool_call'                                     ? _detailAllTurns.filter(t => t.tool_calls.length > 0)
    : _detailFilter === 'prompt'                                        ? _detailAllTurns.filter(t => !!t.prompt)
    : SUB_TYPES.includes(_detailFilter)                                ? _detailAllTurns.filter(t => t.tool_calls.length > 0)
    : [];
  renderTurnCards(turnFiltered, _detailAllTurns);
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

  // ADR-017: chartSection이 detail 모드일 때 donut/cache panel을 세션 데이터로 갱신
  const chartSection = document.getElementById('chartSection');
  if (chartSection?.classList.contains('chart-mode-detail')) {
    // 세션 type 분포 (donut)
    const typeCounts = {};
    _detailAllRequests.forEach(r => {
      typeCounts[r.type] = (typeCounts[r.type] || 0) + 1;
    });
    const sessionTypeData = Object.entries(typeCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
    setTypeData(sessionTypeData);
    drawDonut();
    renderTypeLegend();

    // 세션 cache stats (panel)
    const sessionCache = computeSessionCacheStats(_detailAllRequests);
    renderCachePanel(sessionCache);
  }

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
  // 통합 카드 뷰: [data-turn-id]는 renderTurnView(레거시)용. 통합 뷰는 [data-card-turn-id] 사용.
  const card = document.querySelector(`[data-card-turn-id="${CSS.escape(turnId)}"]`);
  if (card) {
    toggleCardExpand(turnId);
    return;
  }
  // 레거시 목록 뷰 폴백 (호환성)
  const el = document.querySelector(`[data-turn-id="${CSS.escape(turnId)}"]`);
  if (el) el.classList.toggle('open');
}

export function renderTurnView(turns, badgeTurns) {
  // turnListBody는 통합 뷰 전환 후 DOM에서 제거됨 — 호출 시 no-op
  const container   = document.getElementById('turnListBody');
  if (!container) return;
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
    container.innerHTML = '<div class="state-empty"><span class="state-empty-title">데이터가 없습니다</span></div>';
    return;
  }

  container.innerHTML = turns.slice().sort((a, b) => b.turn_index - a.turn_index).map(turn => {
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

    return `<div class="turn-item" data-turn-id="${escHtml(turn.turn_id)}">
      <div class="turn-header" data-toggle-turn="${escHtml(turn.turn_id)}">
        <span class="turn-badge">T${turn.turn_index}</span>
        <span class="turn-time">${fmtTime(turn.started_at)}</span>
        <span class="turn-meta" title="${escHtml(metaTitle)}">${meta}</span>
        ${barHtml}
        <span class="turn-toggle">▸</span>
      </div>
      <div class="turn-children">
        ${buildTurnDetailRows(turn)}
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

/**
 * 도구 이름 + count를 "Grep ×6" 형식의 HTML 문자열로 포맷합니다. (SSoT)
 * count=1이면 이름만 반환합니다.
 * ×와 count 사이 공백 없음, 이름과 × 사이 공백 1개.
 * @param {string} baseName  — mcp__ 접두사 제거 후 이름
 * @param {number} count
 * @returns {string} HTML
 */
function fmtActionLabel(baseName, count) {
  if (count <= 1) return escHtml(baseName);
  return `${escHtml(baseName)} <span class="turn-group-count">×${count}</span>`;
}

/**
 * 연속된 동일 도구 호출을 그룹화합니다. (SSoT — chip/세부행 양쪽에서 재사용)
 * Agent/Skill 계열은 agentName(tool_detail)까지 압축 키에 포함하여 서로 다른 에이전트를 구분.
 * @param {Array} toolCalls
 * @returns {Array<{ key, name, count, isAgent, agentName, items }>}
 */
function compressContinuousTools(toolCalls) {
  const compressed = [];
  for (const tc of toolCalls) {
    const name      = tc.tool_name || '?';
    const isAgent   = /^(Agent|Skill|Task)/.test(name);
    const agentName = isAgent ? (tc.tool_detail || '') : '';
    const key       = name + '|' + agentName;
    const last      = compressed[compressed.length - 1];
    if (compressed.length && last.key === key) {
      last.count++;
      last.items.push(tc);
    } else {
      compressed.push({ key, name, count: 1, isAgent, agentName, items: [tc] });
    }
  }
  return compressed;
}

/**
 * 단일 tool_call 행 HTML을 반환합니다.
 * buildTurnDetailRows 내부와 그룹 하위 행 렌더에서 공유합니다.
 */
function renderToolRow(tc) {
  const tcData      = { ...tc, type: 'tool_call' };
  const tcPreview   = contextPreview(tcData, 60);
  const hint        = toolResponseHint(tcData);
  const statusBadge = toolStatusBadge(tcData);
  const tcTarget    = targetInnerHtml(tcData).html;
  // 첫 번째 span에 statusBadge가 없으면 &nbsp;로 공간 유지하여 아이콘 정렬 일치
  const statusCell  = statusBadge || '&nbsp;';
  return `<div class="turn-row turn-row-tool" data-type="tool_call">
      <span>${statusCell}</span>
      <div class="tool-cell">
        <span class="tool-main">${tcTarget}</span>
        <span class="tool-sub">${tcPreview || ''}${hint ? `${tcPreview ? ' ' : ''}<span class="tool-response-hint">${escHtml(hint)}</span>` : ''}</span>
      </div>
      <span class="num cell-token">${tc.tokens_input  > 0 ? fmtToken(tc.tokens_input)  : '—'}</span>
      <span class="num cell-token">${tc.tokens_output > 0 ? fmtToken(tc.tokens_output) : '—'}</span>
      <span class="num cell-token text-dim">${formatDuration(tc.duration_ms)}</span>
      <span class="num cell-time text-dim">${fmtDate(tc.timestamp)}</span>
    </div>`;
}

/**
 * 턴 내 세부 행(prompt + tool_call)을 HTML 문자열로 조립합니다.
 * renderTurnView와 renderTurnCards 양쪽에서 재사용합니다.
 * 연속 동일 도구는 그룹 헤더 행으로 묶고 기본 접힘 상태로 표시합니다.
 */
function buildTurnDetailRows(turn) {
  const promptData        = turn.prompt ? { ...turn.prompt, type: 'prompt' } : null;
  const promptPreviewHtml = promptData ? contextPreview(promptData, 80) : '';
  const promptTarget      = promptData ? targetInnerHtml(promptData).html : '';
  const promptRow         = promptData ? `
    <div class="turn-row turn-row-prompt" data-type="prompt">
      <span></span>
      <div class="tool-cell">
        <span class="tool-main">${promptTarget}</span>
        ${promptPreviewHtml ? `<span class="tool-sub">${promptPreviewHtml}</span>` : ''}
      </div>
      <span class="num cell-token">${promptData.tokens_input  > 0 ? fmtToken(promptData.tokens_input)  : '—'}</span>
      <span class="num cell-token">${promptData.tokens_output > 0 ? fmtToken(promptData.tokens_output) : '—'}</span>
      <span class="num cell-token text-dim">${formatDuration(promptData.duration_ms)}</span>
      <span class="num cell-time text-dim">${fmtDate(promptData.timestamp)}</span>
    </div>` : '';

  const groups = compressContinuousTools(turn.tool_calls);
  const toolRows = groups.map(group => {
    if (group.count === 1) {
      // 단독 — 기존 행 그대로
      return renderToolRow(group.items[0]);
    }
    // 그룹 — 합계 토큰/시간 계산
    const sumIn  = group.items.reduce((s, tc) => s + (tc.tokens_input  || 0), 0);
    const sumOut = group.items.reduce((s, tc) => s + (tc.tokens_output || 0), 0);
    const sumDur = group.items.reduce((s, tc) => s + (tc.duration_ms   || 0), 0);
    const firstName = group.name.split('__').pop();
    const groupKey  = escHtml(group.key);
    const childRows = group.items.map(tc => renderToolRow(tc)).join('');
    return `<div class="turn-row turn-row-group" data-toggle-group="${groupKey}" data-type="tool_call">
      <span class="turn-group-chevron"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 4.5L6 8.5L10 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <div class="tool-cell">
        <span class="tool-main">${toolIconHtml(firstName)} ${fmtActionLabel(firstName, group.count)}</span>
      </div>
      <span class="num cell-token">${sumIn  > 0 ? fmtToken(sumIn)  : '—'}</span>
      <span class="num cell-token">${sumOut > 0 ? fmtToken(sumOut) : '—'}</span>
      <span class="num cell-token text-dim">${formatDuration(sumDur)}</span>
      <span class="num cell-time text-dim">${fmtDate(group.items[0].timestamp)}</span>
    </div>
    <div class="turn-row-group-children">${childRows}</div>`;
  }).join('');

  return promptRow + (toolRows || '<div class="turn-row-empty">도구 호출 없음</div>');
}

// setTurnViewMode는 하위 호환성을 위해 no-op stub으로 유지
export function setTurnViewMode(_mode) { /* 통합 뷰로 전환됨 — 더 이상 사용 안 함 */ }

export function renderTurnCards(turns, badgeTurns) {
  const container = document.getElementById('turnUnifiedBody');
  if (!container) return;

  // 집계 배지 업데이트 (badgeTurns 기준)
  const badgesEl = document.getElementById('detailBadges');
  const bTurns   = (badgeTurns && badgeTurns.length) ? badgeTurns : turns;
  const sessionTotalTokens = bTurns.reduce((s, t) => s + (t.summary.total_tokens || 0), 0);

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
    container.innerHTML = '<div class="state-empty"><span class="state-empty-title">데이터가 없습니다</span></div>';
    return;
  }

  // SSE 갱신 전 스크롤 위치 캡처
  const scrollEl    = document.getElementById('detailTurnView');
  const savedScroll = scrollEl?.scrollTop ?? 0;
  // SSE 갱신 전 프롬프트 확장 상태 캡처
  const expandedFor = container.querySelector('[data-expand-for]')?.dataset.expandFor ?? null;

  container.innerHTML = turns.slice().sort((a, b) => b.turn_index - a.turn_index).map(turn => {
    // 복잡도 배지
    const toolCount = turn.summary.tool_call_count;
    const complexBadge = toolCount > 15
      ? '<span class="turn-complexity high">복잡</span>'
      : toolCount > 5
      ? '<span class="turn-complexity mid">중간</span>'
      : '';

    // prompt preview
    const promptText = turn.prompt?.preview
      ? escHtml(turn.prompt.preview.slice(0, 60)) + (turn.prompt.preview.length > 60 ? '…' : '')
      : '';

    // 도구 흐름 chip — compressContinuousTools + fmtActionLabel 재사용 (SSoT)
    const chips = compressContinuousTools(turn.tool_calls).map(({ name, count, isAgent, agentName }) => {
      const base  = name.split('__').pop();
      const color = TOOL_COLORS[base] || TOOL_COLORS.default;
      if (isAgent && agentName) {
        const countSuffix = count > 1 ? `×${count}` : '';
        const fullLabel   = agentName + (countSuffix ? ` ${countSuffix}` : '');
        return `<span class="tool-chip agent-chip" style="border-color:${color};color:${color}" title="${escHtml(fullLabel)}">${toolIconHtml(base)}<span class="agent-chip-name">${escHtml(agentName)}</span>${countSuffix ? `<span class="turn-group-count"> ${escHtml(countSuffix)}</span>` : ''}</span>`;
      }
      return `<span class="tool-chip" style="border-color:${color};color:${color}">${fmtActionLabel(base, count)}</span>`;
    }).join('<svg class="chip-arrow" width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 5 L7 5 M5 2.5 L7.5 5 L5 7.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>');

    // 푸터 메트릭
    const barPct = sessionTotalTokens > 0
      ? Math.round((turn.summary.total_tokens || 0) / sessionTotalTokens * 100)
      : 0;
    const tokIn  = fmtToken(turn.summary.tokens_input  || 0);
    const tokOut = fmtToken(turn.summary.tokens_output || 0);
    const dur    = formatDuration(turn.prompt?.duration_ms || 0);

    const isExpanded    = _expandedTurnIds.has(turn.turn_id);
    const expandedClass = isExpanded ? ' expanded' : '';
    const ariaExpanded  = isExpanded ? 'true' : 'false';

    return `<div class="turn-card${expandedClass}" data-card-turn-id="${escHtml(turn.turn_id)}">
      <div class="turn-card-summary" data-toggle-card="${escHtml(turn.turn_id)}" role="button" aria-expanded="${ariaExpanded}" tabindex="0">
        <div class="turn-card-header">
          <span class="turn-card-index">T${turn.turn_index}</span>
          ${promptText ? `<span class="turn-card-preview">${promptText}</span>` : ''}
          ${complexBadge}
          <span class="turn-card-expand-btn"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 4.5L6 8.5L10 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        </div>
        ${chips ? `<div class="turn-card-flow">${chips}</div>` : ''}
        <div class="turn-card-footer">
          <span>IN ${tokIn}</span>
          <span>OUT ${tokOut}</span>
          ${turn.prompt?.duration_ms ? `<span>&#9201; ${dur}</span>` : ''}
          ${sessionTotalTokens > 0 ? `<span class="turn-card-bar-pct">${barPct}%</span>` : ''}
        </div>
      </div>
      <div class="turn-card-expanded">
        ${isExpanded ? buildTurnDetailRows(turn) : ''}
      </div>
    </div>`;
  }).join('');

  // SSE 갱신 후 프롬프트 확장 상태 복원
  if (expandedFor && _promptCache.has(expandedFor)) {
    const previewEl = container.querySelector(`[data-expand-id="${CSS.escape(expandedFor)}"]`);
    const rowContainer = previewEl?.closest('.turn-row') ?? null;
    if (rowContainer) togglePromptExpand(expandedFor, rowContainer);
  }
  // 스크롤 위치 복원
  if (scrollEl && savedScroll) scrollEl.scrollTop = savedScroll;
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
  _expandedTurnIds.clear(); // 세션 전환 시 accordion 펼침 상태 초기화
  detailSearchBox?.clear();
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
  detailSearchBox = createSearchBox('detailSearchContainer', {
    placeholder: 'tool / message',
    onSearch(q) {
      _detailSearchQuery = q;
      applyDetailFilter();
    },
  });
}

/**
 * 카드 accordion 펼침/닫힘 토글.
 * main.js 이벤트 위임에서 [data-toggle-card] 클릭 시 호출합니다.
 */
export function toggleCardExpand(turnId) {
  const card    = document.querySelector(`[data-card-turn-id="${CSS.escape(turnId)}"]`);
  const summary = card?.querySelector(`[data-toggle-card]`);
  if (!card) return;

  const isExpanded = _expandedTurnIds.has(turnId);

  if (isExpanded) {
    _expandedTurnIds.delete(turnId);
    card.classList.remove('expanded');
    if (summary) summary.setAttribute('aria-expanded', 'false');
    const expandedEl = card.querySelector('.turn-card-expanded');
    if (expandedEl) expandedEl.innerHTML = '';
  } else {
    _expandedTurnIds.add(turnId);
    card.classList.add('expanded');
    if (summary) summary.setAttribute('aria-expanded', 'true');
    const expandedEl = card.querySelector('.turn-card-expanded');
    // 해당 턴 데이터를 _detailAllTurns에서 찾아 세부 행 렌더
    const turn = _detailAllTurns.find(t => t.turn_id === turnId);
    if (expandedEl && turn) expandedEl.innerHTML = buildTurnDetailRows(turn);
  }
}

// G7: Gantt 클릭 → 턴뷰 연동 이벤트 리스너 등록
export function initGanttNavigation() {
  document.addEventListener(GANTT_TURN_CLICK, (e) => {
    const { turnId } = e.detail;
    setDetailView('turn');
    // 약간의 딜레이로 DOM 렌더링 후 펼침
    requestAnimationFrame(() => toggleTurn(turnId));
  });
}
