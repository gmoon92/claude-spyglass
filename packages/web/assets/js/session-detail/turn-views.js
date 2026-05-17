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
 *  - 외부 모듈     : formatters, renderers, tool-colors
 *
 * ADR-004 후속:
 *  - 세션 [도구] 탭은 메타 모드 [도구 통계] 서브 탭과 중복이라 제거됨.
 *  - 세션 단위 tool-stats client 경로(loadToolStats / clearToolStats / outbound 링크)도 함께 정리.
 */

import { escHtml, fmtToken, fmtTime, formatDuration } from '../formatters.js';
import { svgDiamond } from '../design-system/icons/diamond.js';
import { toolIconHtml, _promptCache, togglePromptExpand } from '../renderers.js';
import { subTypeOf } from '../request-types.js';
import { renderTab } from '../design-system/primitives/tab.js';
import { showLatestLlmInput, setPendingProxyTargetTs } from '../llm-input-view.js';
import { setDetailTab } from '../state.js';
import { loadSystemPromptLibrary } from '../system-prompt-library.js';
import { extractPromptText, extractAssistantText } from '../render/extract.js';
// ADR-003 left-rail-meta-docs: Behavior Definitions는 detail 탭에서 좌측 rail 1급 모드로 승격됨.
// 진입은 main.js의 applyAppMode('metadocs') 또는 enterMetaDocsMode()로 일원화.
import {
  buildTurnDetailRows, compressFlowWithResponses, fmtActionLabel,
} from './turn-rows.js';
import {
  getDetailTurns, getDetailPrologue, getExpandedTurnIds, getSearchQuery,
} from './state.js';
import { targetInnerHtml, contextPreview } from '../renderers.js';
import { turnSpikeSummaryHtml } from '../render/badges.js';
// v21 (system-reminder-badge): turn 별 신규 reminder 산출 SSoT
import { computeNewRemindersByTurn } from './system-reminder.js';
// Wave 5: system-reminder 칩 아이콘을 design-system/icons/note.js 로 이전.
import { svgNote } from '../design-system/icons/note.js';
// Wave 8-B: 레거시 turn-toggle ▸ 글리프를 SVG chevron으로 교체.
import { svgChevron } from '../design-system/icons/chevron.js';

/**
 * 턴 카드 푸터 .turn-card-bar-pct에 hover 시 노출되는 의미 설명 (web-design-balance-pass ADR-003).
 *  - 계산식: Math.round(turn.summary.total_tokens / sessionTotalTokens * 100)
 *  - 같은 세션의 모든 턴 합 = 100%
 *  - native title 속성으로 노출 (커스텀 툴팁 도입은 ROI 낮아 거부 — ADR-003).
 *  - i18n: session-detail.turn-views.bar-pct-title (언어 전환 시 자동 적용)
 */

/**
 * 턴 카드 검색 haystack SSoT (search-expand-payload).
 *
 * 포함 범위 (사용자 요구 a/b/c):
 *  - T번호 (T${turn_index})
 *  - prompt 본문 (extractPromptText — payload 전체, preview fallback)
 *  - 흐름 chip의 tool_name / Skill·Agent name(tool_detail) / 모델
 *  - 응답 본문(extractAssistantText — payload 전체)
 *  - system_reminder raw 텍스트 (해당 turn에서 새로 등장한 것)
 *  - prompt.preview (turn-card-preview 라벨)
 *
 * 정책:
 *  - 모두 소문자로 normalize.
 *  - 16KB 상한 — 한 카드의 turn은 여러 응답/도구를 포함하므로 행보다 두 배 한도.
 *  - prompt 본문은 prompt 객체에 preview만 있고 payload는 turn API에 포함됨 — fallback 양쪽 모두 활용.
 *
 * @param {object} turn  TurnItem
 * @param {string[]} newReminders  computeNewRemindersByTurn으로 얻은 신규 reminder 본문 배열
 */
function buildTurnHaystack(turn, newReminders) {
  const parts = [];
  parts.push(`T${turn.turn_index}`);
  if (turn.prompt?.preview) parts.push(turn.prompt.preview);
  // turn.prompt는 슬림 객체 — payload 필드도 같이 들어옴(turn.ts SELECT). extract로 payload 본문 시도.
  if (turn.prompt) {
    const promptBody = extractPromptText({ payload: turn.prompt.payload, preview: turn.prompt.preview, type: 'prompt' });
    if (promptBody && promptBody !== turn.prompt.preview) parts.push(promptBody);
    if (turn.prompt.model) parts.push(turn.prompt.model);
  }
  // tool_calls — 이름 + Skill/Agent sub-name + 모델
  for (const tc of (turn.tool_calls || [])) {
    if (tc.tool_name)   parts.push(tc.tool_name);
    if (tc.tool_detail) parts.push(tc.tool_detail);
    if (tc.model)       parts.push(tc.model);
  }
  // responses — payload 본문(있으면) / preview(fallback)
  for (const r of (turn.responses || [])) {
    const body = extractAssistantText({ payload: r.payload, preview: r.preview, type: 'response' });
    if (body) parts.push(body);
    else if (r.preview) parts.push(r.preview);
    if (r.model) parts.push(r.model);
  }
  // system_reminder raw — 검색에서 hook 알림 본문도 잡히도록.
  if (Array.isArray(newReminders) && newReminders.length) {
    parts.push(...newReminders);
  } else if (turn.system_reminder) {
    parts.push(turn.system_reminder);
  }
  return parts.join(' ').toLowerCase().slice(0, 16000);
}

/**
 * 칩 + 팝오버 HTML 생성 (단일 책임).
 *  - N=0이면 빈 문자열 반환 → 호출 측에서 자연 미렌더(디자인 명세 §1.3 / §5-5).
 *  - aria id는 turn_index 기반 unique pattern으로 칩↔팝오버 연결(명세 §5-7).
 *  - reminder 본문은 escHtml로 escape 후 <pre>에 삽입(명세 §5-4).
 *  - 팝오버는 기본 hidden — JS 토글이 단일 가시성 SSoT(명세 §5-1/2).
 *
 * @param {string|number} turnIndex turn unique id (DOM 속성용)
 * @param {string[]} reminders 신규 reminder 본문 배열 (computeNewRemindersByTurn 결과)
 */
function buildSystemReminderChip(turnIndex, reminders) {
  if (!reminders || reminders.length === 0) return '';
  const count = reminders.length;
  const chipId    = `turn-sysrem-chip-${turnIndex}`;
  const popoverId = `turn-sysrem-popover-${turnIndex}`;
  const itemsHtml = reminders.map(body =>
    `<pre class="turn-system-reminder-item">${escHtml(body)}</pre>`
  ).join('');

  return `<span class="turn-system-reminder-anchor" data-turn-id="${escHtml(String(turnIndex))}">
    <button type="button"
            class="turn-system-reminder-chip"
            id="${chipId}"
            aria-haspopup="dialog"
            aria-expanded="false"
            aria-controls="${popoverId}"
            data-sysrem-toggle="${popoverId}"
            title="${window.I18n.t('session.session-detail.turn-views.sysrem-chip-title', { count })}">
      ${svgNote({ size: 12 })}
      <span class="turn-system-reminder-count">${count}</span>
    </button>
    <div class="turn-system-reminder-popover"
         id="${popoverId}"
         role="dialog"
         aria-labelledby="${chipId}"
         tabindex="-1"
         hidden>
      <header class="turn-system-reminder-popover-header">
        <span class="turn-system-reminder-popover-title">
          <strong>${window.I18n.t('session.session-detail.turn-views.sysrem-title')}</strong>
          <span class="turn-system-reminder-popover-count">${window.I18n.t('session.session-detail.turn-views.sysrem-count', { count })}</span>
        </span>
        <button type="button" class="turn-system-reminder-popover-close" aria-label="${window.I18n.t('session.session-detail.turn-views.sysrem-close')}" data-sysrem-close="${popoverId}">×</button>
      </header>
      <div class="turn-system-reminder-popover-body">${itemsHtml}</div>
    </div>
  </span>`;
}

/**
 * Wave 5 — detail-view 탭 4종 동적 생성.
 *
 * 책임:
 *  - #viewTabGroup 컨테이너에 view-tab 버튼 4개를 renderTab()으로 주입한다.
 *  - renderTab 기본 출력(ds-tab)에 기존 클래스(view-tab / active), id, data-tab,
 *    title(선택) 을 .replace로 삽입하여 이중 클래스 패턴을 유지한다.
 *  - 이벤트 위임은 main.js의 #detailTabBar [data-tab] 셀렉터가 그대로 처리한다 — 변경 없음.
 *
 * 호출자: main.js init() — DOMContentLoaded 시 1회.
 */
export function initDetailTabBar() {
  const container = document.getElementById('viewTabGroup');
  if (!container) return;

  /** @type {{ value: string, label: string, id: string, selected: boolean, title?: string }[]} */
  const TABS = [
    { value: 'turn',     label: window.I18n.t('session.session-detail.turn-views.tab-turn'),     id: 'tabTurn',     selected: true  },
    { value: 'requests', label: window.I18n.t('session.session-detail.turn-views.tab-requests'), id: 'tabRequests', selected: false },
    { value: 'llm',      label: window.I18n.t('session.session-detail.turn-views.tab-llm'),      id: 'tabLlm',      selected: false, title: window.I18n.t('session.session-detail.turn-views.tab-llm-title') },
    { value: 'syslib',   label: window.I18n.t('session.session-detail.turn-views.tab-syslib'),   id: 'tabSysLib',   selected: false },
  ];

  container.innerHTML = TABS.map(({ value, label, id, selected, title }) => {
    // renderTab 출력: <button class="ds-tab" type="button" role="tab" aria-selected="..." data-tab-value="...">label</button>
    // → class="ds-tab view-tab [active]" id="..." data-tab="..." [title="..."] 로 확장.
    const activeCls = selected ? ' active' : '';
    const titleAttr = title ? ` title="${escHtml(title)}"` : '';
    return renderTab({ label, selected, value })
      .replace('class="ds-tab"', `class="ds-tab view-tab${activeCls}"`)
      .replace(`data-tab-value="${value}"`, `id="${id}" data-tab="${value}" data-tab-value="${value}"${titleAttr}`);
  }).join('');
}

/**
 * 탭(요청/턴/LLM Input/SysLib) 표시 전환.
 *  - llm 탭 진입 시 가장 최근 proxy 요청의 LLM Input 골격 렌더 (T-09 ADR-004 옵션 A).
 *  - syslib 탭 진입 시 시스템 프롬프트 카탈로그 lazy 로드.
 */
export function setDetailView(tab) {
  // ADR-003 left-rail-meta-docs: 'metadocs' 탭은 제거됨.
  // Behavior Definitions 진입은 좌측 rail 또는 Agent/Skill 배지 딥링크로 일원화.
  // ADR-004 후속: 세션 [도구] 탭은 메타 모드 [도구 통계] 서브 탭과 중복이라 제거됨.
  const reqView = document.getElementById('detailRequestsView');
  const turnView = document.getElementById('detailTurnView');
  const llmView = document.getElementById('detailLlmInputView');
  const sysLibView = document.getElementById('detailSysLibView');
  if (reqView)      reqView.style.display      = tab === 'requests' ? '' : 'none';
  if (turnView)     turnView.style.display     = tab === 'turn'     ? '' : 'none';
  if (llmView)      llmView.style.display      = tab === 'llm'      ? '' : 'none';
  if (sysLibView)   sysLibView.style.display   = tab === 'syslib'   ? '' : 'none';
  // ds-tab 활성 시각은 [aria-selected="true"]로 결정되므로 .active 클래스와 함께 동기화.
  const _syncTab = (id, isActive) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('active', isActive);
    el.setAttribute('aria-selected', isActive ? 'true' : 'false');
  };
  _syncTab('tabRequests', tab === 'requests');
  _syncTab('tabTurn',     tab === 'turn');
  _syncTab('tabLlm',      tab === 'llm');
  _syncTab('tabSysLib',   tab === 'syslib');
  if (tab === 'llm') showLatestLlmInput();
  if (tab === 'syslib') loadSystemPromptLibrary();
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
 * 턴 카드의 "API 페이로드" 액션 클릭 진입점 (deeplink pass).
 *
 * 흐름: setPendingProxyTargetTs(ts) → setDetailTab('llm') → setDetailView('llm')
 *   - setPendingProxyTargetTs는 1회용 — setDetailView('llm') 안의 showLatestLlmInput()이 소비.
 *   - 가장 가까운 proxy_request로 자동 선택, 드롭다운도 그 항목으로 활성화.
 *
 * @param {number} turnStartedAt  turn.started_at (ms timestamp)
 */
export function openLlmInputForTurn(turnStartedAt) {
  setPendingProxyTargetTs(turnStartedAt);
  setDetailTab('llm');
  setDetailView('llm');
}

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
    let badgesHtml = `<span class="detail-agg-badge ds-badge" data-tone="neutral" title="${window.I18n.t('session.session-detail.turn-views.max-cost-badge-title')}">${window.I18n.t('session.session-detail.turn-views.max-cost-badge', { n: maxCostTurn.turn_index, tokens: fmtToken(maxCostTurn.summary.total_tokens) })}</span>`;
    if (topTool) badgesHtml += `<span class="detail-agg-badge ds-badge" data-tone="neutral" title="${window.I18n.t('session.session-detail.turn-views.top-tool-badge-title')}">${window.I18n.t('session.session-detail.turn-views.top-tool-badge', { name: escHtml(topTool[0]), count: topTool[1] })}</span>`;
    badgesEl.innerHTML = badgesHtml;
    badgesEl.classList.remove('detail-agg-badges--hidden');
  } else if (badgesEl) {
    badgesEl.classList.add('detail-agg-badges--hidden');
  }

  if (!turns.length) {
    container.innerHTML = `<div class="state-empty"><span class="state-empty-title">${window.I18n.t('common.no-data')}</span></div>`;
    return;
  }

  container.innerHTML = turns.slice().sort((a, b) => b.turn_index - a.turn_index).map(turn => {
    const toolCount = turn.summary.tool_call_count;
    const tokIn     = turn.summary.tokens_input  ?? 0;
    const tokOut    = turn.summary.tokens_output ?? 0;
    const durMs     = turn.prompt?.duration_ms ?? 0;
    const outPart   = tokOut > 0 ? ` / OUT ${fmtToken(tokOut)}` : '';
    const meta      = `${window.I18n.t('session.session-detail.turn-views.meta-tool-count', { count: toolCount })} · IN ${fmtToken(tokIn)}${outPart}${durMs > 0 ? ` · ⏱ ${formatDuration(durMs)}` : ''}`;
    const metaTitle = [
      window.I18n.t('session.session-detail.turn-views.meta-title-tool'),
      window.I18n.t('session.session-detail.turn-views.meta-title-in'),
      ...(tokOut > 0 ? [window.I18n.t('session.session-detail.turn-views.meta-title-out')] : []),
      ...(durMs > 0  ? [window.I18n.t('session.session-detail.turn-views.meta-title-dur')] : []),
    ].join('\n');
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
        <span class="turn-toggle">${svgChevron({ dir: 'right', size: 10 })}</span>
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
 * ADR-001 P1 — 세션 프롤로그 카드 HTML.
 *
 * prompt 등록 이전에 도착한 tool_call/response 행(turn_id NULL)을 turn-view 상단에
 * 별도 섹션으로 렌더한다. 사용자가 정의한 "사용자 프롬프트 = 턴" 원칙을 깨지 않으면서
 * 데이터 누락을 시각적으로 보존한다. 빈 배열이면 호출자가 호출하지 않는 것을 권장.
 *
 * 행 렌더는 turn-row와 같은 그리드 컬럼·셀빌더를 재사용해 시각 일관성 유지.
 */
function renderPrologueCardHtml(prologue) {
  if (!prologue || prologue.length === 0) return '';
  const rows = prologue.map((r) => {
    const targetHtml = targetInnerHtml(r).html;
    const previewHtml = contextPreview(r, 60);
    const ts = fmtTime(r.timestamp);
    const sourceTag = r.source === 'transcript-assistant-text'
      ? `<span class="prologue-source-tag" title="${window.I18n.t('session.session-detail.turn-views.prologue-transcript-tag')}">transcript</span>`
      : (r.source ? `<span class="prologue-source-tag">${escHtml(r.source)}</span>` : '');
    return `<div class="prologue-row" data-type="${escHtml(r.type)}">
        <span class="prologue-row-target">${targetHtml}</span>
        <span class="prologue-row-preview">${previewHtml || ''}</span>
        ${sourceTag}
        <span class="prologue-row-time">${escHtml(ts)}</span>
      </div>`;
  }).join('');
  return `<div class="turn-prologue-card" role="region" aria-label="${window.I18n.t('session.session-detail.turn-views.prologue-aria')}">
      <div class="turn-prologue-header">
        <span class="turn-prologue-title">${window.I18n.t('session.session-detail.turn-views.prologue-title')}</span>
        <span class="turn-prologue-count">${window.I18n.t('ui.chart.count-unit', { count: prologue.length })}</span>
        <span class="turn-prologue-hint" title="${window.I18n.t('session.session-detail.turn-views.prologue-hint-title')}">${window.I18n.t('session.session-detail.turn-views.prologue-hint')}</span>
      </div>
      <div class="turn-prologue-body">${rows}</div>
    </div>`;
}

/**
 * 통합 카드형 turn 뷰 — 현재 활성화된 메인 뷰.
 *  - 헤더: T번호 + prompt 미리보기 + 복잡도 배지 + 펼침 버튼
 *  - 본문: 도구 흐름 chip (compressContinuousTools 재사용)
 *  - 푸터: IN/OUT/⏱ + 비율(%) — 비율은 세션 누적 토큰 대비
 *  - 펼침: buildTurnDetailRows로 세부 행 lazy 렌더 (펼친 카드만)
 *  - ADR-001 P1: prologue 비면 카드 안 그림. 있으면 turn 카드들 위에 별도 섹션.
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
    let badgesHtml = `<span class="detail-agg-badge ds-badge" data-tone="neutral" title="${window.I18n.t('session.session-detail.turn-views.max-cost-badge-title')}">${window.I18n.t('session.session-detail.turn-views.max-cost-badge', { n: maxCostTurn.turn_index, tokens: fmtToken(maxCostTurn.summary.total_tokens) })}</span>`;
    if (topTool) badgesHtml += `<span class="detail-agg-badge ds-badge" data-tone="neutral" title="${window.I18n.t('session.session-detail.turn-views.top-tool-badge-title')}">${window.I18n.t('session.session-detail.turn-views.top-tool-badge', { name: escHtml(topTool[0]), count: topTool[1] })}</span>`;
    badgesEl.innerHTML = badgesHtml;
    badgesEl.classList.remove('detail-agg-badges--hidden');
  } else if (badgesEl) {
    badgesEl.classList.add('detail-agg-badges--hidden');
  }

  // ADR-001 P1: 프롤로그 (turn_id NULL 행) — turn 카드들 위에 별도 섹션. 비면 빈 문자열.
  const prologueHtml = renderPrologueCardHtml(getDetailPrologue());

  if (!turns.length) {
    container.innerHTML = prologueHtml
      || `<div class="state-empty"><span class="state-empty-title">${window.I18n.t('common.no-data')}</span></div>`;
    return;
  }

  const scrollEl    = document.getElementById('detailTurnView');
  const savedScroll = scrollEl?.scrollTop ?? 0;
  const expandedFor = container.querySelector('[data-expand-for]')?.dataset.expandFor ?? null;
  const expandedTurnIds = getExpandedTurnIds();

  // v22 (system-prompt-exposure 후속): turn 카드 헤더에 system 변경 표지.
  // "이전 turn"은 turn_index가 1 작은 turn — chronological 직전. 정렬 순서와 무관하게 lookup.
  // hash 변경(또는 첫 등장)이면 ▲ 마커, 같으면 표시 안 함(시각 노이즈 회피).
  const sysHashByIdx = new Map(turns.map(t => [t.turn_index, t.system_hash]));

  // v21 (system-reminder-badge): 세션 누적 dedup 기준 "이 turn에서 처음 등장한 reminder"만 칩에 노출.
  // computeNewRemindersByTurn은 turn_index ASC 순회로 내부에서 정렬 — 호출 측의 정렬 순서 무관.
  const newRemindersByTurn = computeNewRemindersByTurn(turns);

  container.innerHTML = prologueHtml + turns.slice().sort((a, b) => b.turn_index - a.turn_index).map(turn => {
    const toolCount = turn.summary.tool_call_count;
    const complexBadge = toolCount > 15
      ? `<span class="turn-complexity high ds-badge" data-tone="warn">${window.I18n.t('session.session-detail.turn-views.complexity-high')}</span>`
      : toolCount > 5
      ? `<span class="turn-complexity mid ds-badge" data-tone="info">${window.I18n.t('session.session-detail.turn-views.complexity-mid')}</span>`
      : '';

    // system 변경 표지 — turn.system_hash가 직전 turn의 hash와 다르면 ▲ + 8자 hex
    const prevHash = sysHashByIdx.get(turn.turn_index - 1);
    const sysChanged = turn.system_hash && turn.system_hash !== prevHash;
    const systemBadge = sysChanged
      ? `<span class="turn-system-changed ds-badge" data-tone="warn" title="${window.I18n.t(prevHash ? 'session.session-detail.turn-views.system-changed' : 'session.session-detail.turn-views.system-started')}">▲ <code>${escHtml(turn.system_hash.slice(0, 8))}</code></span>`
      : '';

    const promptText = turn.prompt?.preview
      ? escHtml(turn.prompt.preview.slice(0, 60)) + (turn.prompt.preview.length > 60 ? '…' : '')
      : '';

    // 흐름 chip — 도구 + 어시스턴트 응답을 시간순으로 인터리빙 (SSoT: compressFlowWithResponses).
    // 응답은 ◆ 마커 chip으로 노출 → "Bash → Read → ◆ → Edit → ◆ → Edit ×2" 형태로
    // 실제 turn 흐름과 일치. 이전엔 tool_calls만 chip으로 만들어 응답이 누락되어
    // "Edit ×4"로 묶여 보이는 오해가 있었음.
    //
    // 시각 위계 (ADR-007 Inverted Emphasis):
    //   - 기본 도구(Bash/Read/Edit 등) → .tool-chip 베이스만 → dim 톤 (자주 호출되어 시각 잡음 0)
    //   - MCP/Agent/Skill → .tool-chip-{sub_type} modifier → chip 토큰 강조 (외부/위임 호출 즉시 인지)
    //   분류 판정은 request-types.js의 subTypeOf — 분류 뱃지·필터·flow chip이 한 SSoT를 공유.
    const chips = compressFlowWithResponses(turn).map(item => {
      if (item.kind === 'response') {
        return `<span class="tool-chip response-chip ds-chip" data-tone="info" title="${window.I18n.t('session.session-detail.turn-views.response-chip-label')}" aria-label="${window.I18n.t('session.session-detail.turn-views.response-chip-label')}">${svgDiamond({ size: 10 })}</span>`;
      }
      const { name, count, isAgent, agentName, items } = item;
      const base = name.split('__').pop();
      // 그룹 내 sub_type은 동일(compressContinuousTools 정책) → 첫 도구로 판정.
      const sub      = items && items.length ? subTypeOf(items[0]) : '';
      const subCls   = sub ? ` tool-chip-${sub}` : '';
      if (isAgent && agentName) {
        const countSuffix = count > 1 ? `×${count}` : '';
        const fullLabel   = agentName + (countSuffix ? ` ${countSuffix}` : '');
        // ADR-003 left-rail-meta-docs: agent/skill chip만 Behavior Definitions 딥링크 (Task는 분류는 같지만 카탈로그 대상 아님)
        // sub === 'agent' | 'skill' 인 경우만 data-meta-doc-* 부여 → 클릭 시 메타 모드 진입
        const deepLinkAttrs = (sub === 'agent' || sub === 'skill')
          ? ` data-meta-doc-type="${sub}" data-meta-doc-id="${escHtml(agentName)}" role="button" tabindex="0"`
          : '';
        return `<span class="tool-chip agent-chip${subCls} ds-chip" data-tone="${sub || 'agent'}" title="${escHtml(fullLabel)}"${deepLinkAttrs}>${toolIconHtml(base)}<span class="agent-chip-name">${escHtml(agentName)}</span>${countSuffix ? `<span class="turn-group-count"> ${escHtml(countSuffix)}</span>` : ''}</span>`;
      }
      return `<span class="tool-chip${subCls} ds-chip" data-tone="${sub || 'tool'}">${fmtActionLabel(base, count)}</span>`;
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

    // 턴뷰 → API 페이로드 딥링크 (deeplink pass). data-payload-ts에 turn 시작 시각을 실어
    // main.js 클릭 위임이 받아 openLlmInputForTurn(ts) 호출 → 가장 가까운 proxy_request로 LLM Input 진입.
    const payloadActionBtn = `<button type="button" class="turn-card-action-payload" data-payload-ts="${turn.started_at}" title="${window.I18n.t('session.session-detail.turn-views.payload-btn-title')}" aria-label="${window.I18n.t('session.session-detail.turn-views.payload-btn-aria')}">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <polyline points="6 5 2 8 6 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <polyline points="10 5 14 8 10 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>API</span>
    </button>`;

    // v21 (system-reminder-badge): 신규 reminder가 있을 때만 칩+팝오버 출력.
    const turnReminders = newRemindersByTurn.get(turn.turn_id);
    const reminderChip = buildSystemReminderChip(turn.turn_index, turnReminders);

    // anomaly-bloated-sys T-16: 턴뷰 헤더 .turn-spike-summary + sparkline.
    //   turn.agent_spike 응답이 critical이고 ratio ≥ 3일 때만 노출 (헬퍼 내부 판정).
    //   샘플 시계열은 turn.tool_calls에서 자식 토큰을 시간순 추출 — 데이터 없으면 빈 baseline.
    const spikeSamples = (turn.agent_spike?.samples) || (turn.tool_calls || [])
      .map(tc => (tc.tokens_input || 0) + (tc.tokens_output || 0))
      .filter(v => v > 0);
    const spikeSummary = turnSpikeSummaryHtml(turn.agent_spike, spikeSamples);

    // search-expand-payload: 카드별 검색 haystack. flat-view 검색 흐름이 매칭 카드만 표시한다.
    const haystack = buildTurnHaystack(turn, turnReminders);

    return `<div class="turn-card${expandedClass}" data-card-turn-id="${escHtml(turn.turn_id)}" data-search-haystack="${escHtml(haystack)}">
      <div class="turn-card-summary" data-toggle-card="${escHtml(turn.turn_id)}" role="button" aria-expanded="${ariaExpanded}" tabindex="0">
        <div class="turn-card-header">
          <span class="turn-card-index ds-badge" data-tone="neutral">T${turn.turn_index}</span>
          ${promptText ? `<span class="turn-card-preview">${promptText}</span>` : ''}
          ${systemBadge}
          ${reminderChip}
          ${spikeSummary}
          ${payloadActionBtn}
          <span class="turn-card-expand-btn"><svg class="ds-chevron" data-dir="down" aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4.5L6 8.5L10 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        </div>
        ${chips ? `<div class="turn-card-flow">${chips}</div>` : ''}
        <div class="turn-card-footer">
          <span>IN ${tokIn}</span>
          <span>OUT ${tokOut}</span>
          ${turn.prompt?.duration_ms ? `<span>&#9201; ${dur}</span>` : ''}
          ${complexBadge}
          ${sessionTotalTokens > 0 ? `<span class="turn-card-bar-pct ds-badge" data-tone="neutral" title="${window.I18n.t('session.session-detail.turn-views.bar-pct-title')}">${barPct}%</span>` : ''}
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

  // search-expand-payload: renderTurnCards 호출 직후, 직전 검색어가 있으면 카드 가시성 동기.
  // applyDetailFilter 흐름이 flat-view 갱신과 함께 호출하므로 첫 렌더에서도 정합 유지.
  const query = (getSearchQuery?.() ?? '').toLowerCase();
  if (query) applyTurnCardSearch(query);

  // 턴 뷰 진입 시 첫 번째(최신) 턴 자동 펼침.
  // expandedTurnIds.size === 0 대신 current turns 기준으로 체크 — 세션 전환 직전
  // searchBox.clear() 등으로 인한 중간 renderTurnCards 호출이 이전 세션 turn_id를
  // Set에 채워버려도, 새 세션 데이터로 들어올 때 hasExpandedHere가 false가 되어
  // 정상적으로 자동 펼침이 실행된다.
  const currentTurnIds = new Set(turns.map(t => t.turn_id));
  const hasExpandedHere = [...expandedTurnIds].some(id => currentTurnIds.has(id));
  if (turns.length > 0 && !hasExpandedHere) {
    const firstTurn = turns.slice().sort((a, b) => b.turn_index - a.turn_index)[0];
    if (firstTurn) toggleCardExpand(firstTurn.turn_id);
  }
}

/**
 * 턴 카드 뷰 검색 적용 — 카드 단위 display 토글 (flat-view의 행 토글과 대칭).
 *  - haystack은 카드 마운트 시 박힌 dataset.searchHaystack (buildTurnHaystack 결과).
 *  - 빈 query는 모든 카드 노출 — 검색 해제 흐름과 일관.
 *  - 매칭 안 되면 display:none. 스크롤 위치 유지 위해 visibility가 아닌 display 사용.
 *
 * 호출자: session-detail/flat-view.js applyDetailFilter (DETAIL_FILTER_CHANGED listener).
 */
export function applyTurnCardSearch(query) {
  const q = (query || '').toLowerCase();
  const cards = document.querySelectorAll('#turnUnifiedBody .turn-card[data-card-turn-id]');
  cards.forEach(card => {
    if (!q) { card.style.display = ''; return; }
    const haystack = card.dataset.searchHaystack || '';
    card.style.display = haystack.includes(q) ? '' : 'none';
  });
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
