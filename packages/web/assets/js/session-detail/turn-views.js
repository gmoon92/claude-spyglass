/**
 * session-detail/turn-views.js — 턴 단위 뷰 렌더 (테이블형 + 카드형) 및 토글 액션.
 *
 * 책임:
 *  - renderTurnView (레거시 테이블) / renderTurnCards (현재 통합 카드 뷰) — 두 뷰가 같은
 *    helper(buildTurnDetailRows, compressContinuousTools, fmtActionLabel)를 공유한다.
 *  - 탭 전환(setDetailView), 카드 펼침(toggleCardExpand), 레거시 토글(toggleTurn).
 *
 * 호출자: index.js (facade), main.js (이벤트 위임)
 * 의존성:
 *  - state         : 펼침 ID 집합 / 현재 세션 ID / 턴 목록
 *  - turn-rows     : buildTurnDetailRows, compressContinuousTools, fmtActionLabel
 *  - 외부 모듈     : tool-stats(loadToolStats), formatters, renderers, tool-colors
 */

import { escHtml, fmtToken, fmtTime, formatDuration } from '../formatters.js';
import { toolIconHtml, _promptCache, togglePromptExpand } from '../renderers.js';
import { TOOL_COLORS } from '../tool-colors.js';
import { loadToolStats } from '../tool-stats.js';
import {
  buildTurnDetailRows, compressContinuousTools, fmtActionLabel,
} from './turn-rows.js';
import {
  getCurrentSessionId, getDetailTurns, getExpandedTurnIds,
} from './state.js';

/**
 * 턴 카드 푸터 .turn-card-bar-pct에 hover 시 노출되는 의미 설명 (web-design-balance-pass ADR-003).
 *  - 계산식: Math.round(turn.summary.total_tokens / sessionTotalTokens * 100)
 *  - 같은 세션의 모든 턴 합 = 100%
 *  - native title 속성으로 노출 (커스텀 툴팁 도입은 ROI 낮아 거부 — ADR-003).
 *  - 따옴표 이스케이프 불필요(escHtml 미사용 — 사용자 입력이 아닌 상수 문자열).
 */
const BAR_PCT_TITLE = '이 턴이 세션 전체 토큰에서 차지하는 비중. 같은 세션의 모든 턴 합이 100% (Turn IN+OUT ÷ 세션 누적 토큰).';

/**
 * 탭(요청/턴/도구) 표시 전환.
 * tools 탭 진입 시 도구 통계를 lazy 로드한다.
 */
export function setDetailView(tab) {
  document.getElementById('detailRequestsView').style.display = tab === 'requests' ? '' : 'none';
  document.getElementById('detailTurnView').style.display     = tab === 'turn'     ? '' : 'none';
  document.getElementById('detailToolsView').style.display    = tab === 'tools'    ? '' : 'none';
  document.getElementById('tabRequests').classList.toggle('active', tab === 'requests');
  document.getElementById('tabTurn').classList.toggle('active',     tab === 'turn');
  document.getElementById('tabTools').classList.toggle('active',    tab === 'tools');
  const sessionId = getCurrentSessionId();
  if (tab === 'tools' && sessionId) loadToolStats(sessionId);
}

/**
 * 턴 단위 토글. 통합 카드 뷰가 우선, 레거시 목록 뷰는 폴백.
 * main.js의 이벤트 위임에서 [data-toggle-turn] 클릭 시 호출된다.
 */
export function toggleTurn(turnId) {
  const card = document.querySelector(`[data-card-turn-id="${CSS.escape(turnId)}"]`);
  if (card) {
    toggleCardExpand(turnId);
    return;
  }
  const el = document.querySelector(`[data-turn-id="${CSS.escape(turnId)}"]`);
  if (el) el.classList.toggle('open');
}

/** setTurnViewMode: 통합 뷰로 전환됨 — 더 이상 사용하지 않는 stub (외부 호출 호환용). */
export function setTurnViewMode(_mode) { /* no-op */ }

/**
 * 레거시 테이블형 turn 뷰. 통합 카드 뷰 전환 후 turnListBody가 DOM에서 제거되었으므로
 * 컨테이너 부재 시 no-op. 일부 외부 호출처 호환을 위해 export 유지.
 */
export function renderTurnView(turns, badgeTurns) {
  const container = document.getElementById('turnListBody');
  if (!container) return;
  const scrollEl    = document.getElementById('detailTurnView');
  const savedScroll = scrollEl?.scrollTop ?? 0;
  const badgesEl    = document.getElementById('detailBadges');
  const bTurns      = (badgeTurns && badgeTurns.length) ? badgeTurns : turns;
  const sessionTotalTokens = bTurns.reduce((s, t) => s + (t.summary.total_tokens || 0), 0);

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
  if (scrollEl && savedScroll) scrollEl.scrollTop = savedScroll;
}

/**
 * 통합 카드형 turn 뷰 — 현재 활성화된 메인 뷰.
 *  - 헤더: T번호 + prompt 미리보기 + 복잡도 배지 + 펼침 버튼
 *  - 본문: 도구 흐름 chip (compressContinuousTools 재사용)
 *  - 푸터: IN/OUT/⏱ + 비율(%) — 비율은 세션 누적 토큰 대비
 *  - 펼침: buildTurnDetailRows로 세부 행 lazy 렌더 (펼친 카드만)
 */
export function renderTurnCards(turns, badgeTurns) {
  const container = document.getElementById('turnUnifiedBody');
  if (!container) return;

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

  const scrollEl    = document.getElementById('detailTurnView');
  const savedScroll = scrollEl?.scrollTop ?? 0;
  const expandedFor = container.querySelector('[data-expand-for]')?.dataset.expandFor ?? null;
  const expandedTurnIds = getExpandedTurnIds();

  container.innerHTML = turns.slice().sort((a, b) => b.turn_index - a.turn_index).map(turn => {
    const toolCount = turn.summary.tool_call_count;
    const complexBadge = toolCount > 15
      ? '<span class="turn-complexity high">복잡</span>'
      : toolCount > 5
      ? '<span class="turn-complexity mid">중간</span>'
      : '';

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

    const barPct = sessionTotalTokens > 0
      ? Math.round((turn.summary.total_tokens || 0) / sessionTotalTokens * 100)
      : 0;
    const tokIn  = fmtToken(turn.summary.tokens_input  || 0);
    const tokOut = fmtToken(turn.summary.tokens_output || 0);
    const dur    = formatDuration(turn.prompt?.duration_ms || 0);

    const isExpanded    = expandedTurnIds.has(turn.turn_id);
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
          ${sessionTotalTokens > 0 ? `<span class="turn-card-bar-pct" title="${BAR_PCT_TITLE}">${barPct}%</span>` : ''}
        </div>
      </div>
      <div class="turn-card-expanded">
        ${isExpanded ? buildTurnDetailRows(turn) : ''}
      </div>
    </div>`;
  }).join('');

  if (expandedFor && _promptCache.has(expandedFor)) {
    const previewEl = container.querySelector(`[data-expand-id="${CSS.escape(expandedFor)}"]`);
    const rowContainer = previewEl?.closest('.turn-row') ?? null;
    if (rowContainer) togglePromptExpand(expandedFor, rowContainer);
  }
  if (scrollEl && savedScroll) scrollEl.scrollTop = savedScroll;
}

/**
 * 카드 accordion 펼침/닫힘 토글.
 * main.js 이벤트 위임에서 [data-toggle-card] 클릭 시 호출된다.
 *  - 펼친 상태로 바뀌면 buildTurnDetailRows를 그 시점에 lazy 렌더 (펼친 카드만 비용 발생).
 *  - 닫히면 expanded 컨테이너 비우기.
 */
export function toggleCardExpand(turnId) {
  const card    = document.querySelector(`[data-card-turn-id="${CSS.escape(turnId)}"]`);
  const summary = card?.querySelector(`[data-toggle-card]`);
  if (!card) return;

  const expandedTurnIds = getExpandedTurnIds();
  const isExpanded = expandedTurnIds.has(turnId);

  if (isExpanded) {
    expandedTurnIds.delete(turnId);
    card.classList.remove('expanded');
    if (summary) summary.setAttribute('aria-expanded', 'false');
    const expandedEl = card.querySelector('.turn-card-expanded');
    if (expandedEl) expandedEl.innerHTML = '';
  } else {
    expandedTurnIds.add(turnId);
    card.classList.add('expanded');
    if (summary) summary.setAttribute('aria-expanded', 'true');
    const expandedEl = card.querySelector('.turn-card-expanded');
    const turn = getDetailTurns().find(t => t.turn_id === turnId);
    if (expandedEl && turn) expandedEl.innerHTML = buildTurnDetailRows(turn);
  }
}
