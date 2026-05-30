/**
 * session-detail/turn-views.js — 통합 "로그" 탭 (turn-spine + flow-head + log-pane) 렌더 SSoT.
 *
 * 책임:
 *  - 영역 A (flow-pane): 활성 턴 메타가 모인 flow-head + 모든 턴을 한 줄짜리 inline-flow로
 *    잇는 turn-spine 을 동적 생성한다. (renderSpine / turnLineHtml / updateFlowHead)
 *  - 영역 B (log-pane): 활성 턴의 요청 행만 makeTurnLogRows(SSoT는 turn-rows.js)로 채운다.
 *    표 컨테이너(.requests-table) 자체는 한 번만 만들고 이후엔 tbody만 갈아끼워
 *    render/col-resize.js가 보존한 컬럼 너비를 유지한다.
 *  - 활성 턴 ID 모듈 상태 관리 — setActiveTurnId / getActiveTurnId. 칩 클릭 위임이
 *    비활성 턴 칩을 선택했을 때 main.js가 setActiveTurnId(ownerId) + renderActiveTurn()을
 *    순차 호출해 영역 A/B 를 동기화한다.
 *  - 탭 전환(setDetailView), 카드 펼침 호환 stub(toggleCardExpand), 레거시 toggleTurn.
 *
 * 호출자:
 *  - session-detail/index.js : facade re-export
 *  - session-detail/flat-view.js : applyDetailFilter → renderTurnCards / applyTurnCardSearch
 *  - main.js : setDetailView, openLlmInputForTurn, initDetailTabBar, toggleCardExpand,
 *              그리고 turn-spine 칩 클릭 위임 (data-chip-key)
 *
 * 의존성:
 *  - state.js          : 펼침 ID 집합 / 현재 세션 / 턴 목록 / 검색어 / anomaly map
 *  - turn-rows.js      : chipFromRequest / chipKey / makeTurnLogRows / compressFlowWithResponses
 *  - render/rows.js    : (간접) — makeTurnLogRows 가 makeRequestRow 위임 SSoT 호출
 *  - render/badges.js  : turnSpikeSummaryHtml
 *  - renderers.js      : toolIconHtml, _promptCache, togglePromptExpand
 *  - request-types.js  : subTypeOf — chip sub-tone 색상 분기 (mcp/agent/skill/task)
 *  - design-system/icons/* : svgDiamond / svgNote / svgChevron
 *
 * SSoT 위계:
 *  - 칩 ↔ 행 1:1 키 (data-chip-key)  → turn-rows.js#chipKey
 *  - 9컬럼 표 행 HTML                → render/rows.js#makeRequestRow (절대 수정 금지)
 *  - 시각 어휘(턴 spine/flow-head/log-pane) → 본 파일이 단일 책임
 *
 * @see ADR-turn-view-revamp-001 — turn-spine inline-flow + 활성 카드 박스 폐기
 * @see ADR-turn-view-revamp-002 — flow-head 두 행 + 영역 h2 제거
 * @see ADR-turn-view-revamp-003 — 칩 클릭 → 첫 매칭 행 스크롤
 * @see ADR-turn-view-revamp-004 — "턴 뷰"+"요청" → 단일 "로그" 탭 통합
 */

import { escHtml, fmtToken, fmtTime } from '../formatters.js';
import { svgDiamond } from '../design-system/icons/diamond.js';
import { toolIconHtml, _promptCache, togglePromptExpand } from '../renderers.js';
import { subTypeOf } from '../request-types.js';
import { renderTab } from '../design-system/primitives/tab.js';
import { showLatestLlmInput, setPendingProxyTargetTs } from '../llm-input-view.js';
import { setDetailTab } from '../state.js';
import { loadSystemPromptLibrary } from '../system-prompt-library.js';
import { extractPromptText, extractAssistantText } from '../render/extract.js';
import {
  chipFromRequest, chipKey, compressFlowWithResponses, makeTurnLogRows,
} from './turn-rows.js';
import {
  getDetailPrologue, getDetailTurns, getExpandedTurnIds, getSearchQuery,
  getTurnAnomalyMap,
} from './state.js';
import { targetInnerHtml, contextPreview } from '../renderers.js';
import { turnSpikeSummaryHtml } from '../render/badges.js';
import { applyBloatedSysHeader } from '../views/detail-view.js';
import { getBloatedSysFor } from '../state/anomaly-cache.js';
import { getSelectedSession } from '../state.js';
import { computeNewRemindersByTurn } from './system-reminder.js';
import { svgNote } from '../design-system/icons/note.js';
import { initColResize } from '../col-resize.js';

// =============================================================================
// 활성 턴 ID — 모듈 수준 상태 (단일 캡슐화)
// =============================================================================
//
// 정책:
//  - "활성 턴"은 한 시점에 정확히 하나. 칩/마커 클릭 또는 SSE 신규 턴 도착 시 갱신.
//  - getDetailTurns()의 첫 턴(최신)이 기본 활성. 명시적으로 setActiveTurnId(null)이면
//    renderTurnCards가 첫 진입 시점에 자동으로 가장 최근 턴을 잡는다.
//  - 칩 ↔ 행 1:1 매칭은 활성 턴 범위 안에서만 동작 (plan §3.6 Option α).

let _activeTurnId = null;

/** @returns {string|null} 현재 활성 턴 ID (없으면 null). */
export function getActiveTurnId() { return _activeTurnId; }

/**
 * 활성 턴 ID를 갱신한다. 영역 A/B 재렌더 트리거는 호출자(main.js)가 책임진다 —
 * 본 함수는 상태 setter일 뿐 부수효과(렌더)를 가지지 않는다.
 *
 * @param {string|null} turnId
 */
export function setActiveTurnId(turnId) {
  _activeTurnId = turnId || null;
}

// =============================================================================
// chip arrow / spine arrow SVG — 시각 어휘 SSoT (prototype.html 발췌)
// =============================================================================

/** chip-flow 안의 도구→도구/도구→응답 화살표 (작은 톤). */
const CHIP_ARROW_SVG = '<svg class="chip-arrow" width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 5 L7 5 M5 2.5 L7.5 5 L5 7.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** turn-marker → turn-marker 사이 spine 화살표 (좀 더 큰 톤). */
const SPINE_ARROW_SVG = '<svg class="spine-arrow" width="14" height="14" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 5 L7 5 M5 2.5 L7.5 5 L5 7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// =============================================================================
// fmtActionLabel — 일반 도구 칩 라벨 (count×N 패턴)
// =============================================================================
//
// 이전엔 turn-rows.js에서 export했으나 turn-rows.js 폐기/슬림화로 본 파일에 흡수.
// 칩 라벨 SSoT — count===1이면 라벨만, ≥2면 라벨 + `<span class="count">×N</span>`.

function fmtActionLabel(label, count) {
  const safeLabel = escHtml(label || '?');
  if (!count || count <= 1) return safeLabel;
  return `${safeLabel}<span class="count">×${count}</span>`;
}

// =============================================================================
// chip-flow HTML — 활성 턴 안에서 도구·응답 칩 시퀀스를 inline-flow로 잇는다.
// =============================================================================

/**
 * 단일 chip 객체(flow item) → chip HTML 한 조각.
 *
 * data-chip-key SSoT(turn-rows.js#chipKey)를 모든 칩에 부여하고, 키보드 a11y를 위한
 * tabindex/role/aria-label 도 함께 박는다. 응답 칩은 ◆ 글리프, agent/skill 은 sub-tone
 * 토큰, mcp 는 짧은 이름만 노출 (full name은 title).
 *
 * @param {object} item    compressFlowWithResponses 반환 item ({kind:'tool'|'response', ...})
 * @param {number} respSeq 응답 칩의 turn 내 등장 순번 (1-based). 응답이 아닐 땐 무시.
 * @returns {string} chip HTML
 */
function chipHtml(item, respSeq) {
  // 응답 칩 — ◆ 글리프.
  if (item.kind === 'response') {
    const meta = chipFromRequest({ ...item.request, type: 'response' }, respSeq);
    const key  = chipKey(meta);
    const label = window.I18n.t('session.session-detail.turn-views.response-chip-label');
    const attrs = chipAccessibilityAttrs(key, label);
    return `<span class="tool-chip response-chip ds-chip" data-tone="info" title="${label}" ${attrs}>${svgDiamond({ size: 10 })}</span>`;
  }

  // 도구 칩 — count×N 패턴 + sub-type 색상.
  const { name, count, isAgent, agentName, items, isGroup } = item;
  const baseName = (name || '').split('__').pop();
  const sub      = items && items.length ? subTypeOf(items[0]) : '';
  const subCls   = sub ? ` tool-chip-${sub}` : '';
  const tone     = sub || 'tool';

  // chip-key 는 그룹의 첫 요소를 대표로 사용 (count tool 의 ×N 행은 같은 키 공유).
  const firstReq = items && items[0];
  const chipMeta = firstReq ? chipFromRequest({ ...firstReq, type: 'tool_call' }, respSeq) : null;
  const key      = chipKey(chipMeta);

  // 정확 점프 SSoT — 모든 도구 칩에 대표 request-id 부착 (#46 group-jump 정확도 확장).
  //   chip-key 는 동명 도구가 비연속으로 여러 번 등장하면 중복된다. querySelector 는 DOM
  //   첫 매칭을 반환하므로, chip-key 만으로는 뒤쪽 칩을 눌러도 앞쪽 최초 동명 행으로 잘못
  //   점프한다. items[0].id 를 `data-target-request-id` 로 박아 main.js#handleChipActivation
  //   이 이 id 로 정확한 행을 찾게 한다 (chip-key 는 폴백 + 일관성 유지용).
  //   기존엔 NEUTRAL 윈도우 묶음 칩(isGroup)에만 부여했으나, 일반/agent/mcp 칩도 동일 버그를
  //   겪으므로 공통 속성으로 끌어올린다.
  const firstIdAttr = firstReq?.id ? ` data-target-request-id="${escHtml(firstReq.id)}"` : '';

  // NEUTRAL 윈도우 묶음 칩 (turn-rows.js#compressNeutralWindows) — 무채색 유지.
  //   - 묶음은 종류 무관한 노이즈 요약이므로 sub-type 색상/agent-chip 분기보다 먼저 처리.
  //   - title 에는 포함된 도구 종류 전체(`Read · Bash · Edit · ...`) 를 노출해 hover 단서 제공.
  if (isGroup) {
    const groupAria  = count > 1 ? `${name} ×${count} (그룹)` : `${name} (그룹)`;
    const a11yAttrs  = chipAccessibilityAttrs(key, groupAria);
    const titleText  = (item.kinds || []).join(' · ');
    return `<span class="tool-chip tool-chip-group ds-chip" data-tone="tool" title="${escHtml(titleText)}" ${a11yAttrs}${firstIdAttr}>${fmtActionLabel(name, count)}</span>`;
  }

  if (isAgent && agentName) {
    const countSuffix = count > 1 ? `×${count}` : '';
    const fullLabel   = agentName + (countSuffix ? ` ${countSuffix}` : '');
    const aria        = `${agentName}${countSuffix ? ' ' + countSuffix : ''}`;
    const a11yAttrs   = chipAccessibilityAttrs(key, aria);
    // toolIconHtml에 전체 도구 이름(name)을 넘긴다 — Task family는 startsWith('Task') 분기 매칭이
    //   tool-icon-task(오렌지)로 라우팅된다. baseName('Task')을 넘기면 정확 매칭 실패 시
    //   기본 분기로 빠질 위험 — 안전을 위해 name 전체를 전달.
    return `<span class="tool-chip agent-chip${subCls} ds-chip" data-tone="${tone}" title="${escHtml(fullLabel)}" ${a11yAttrs}${firstIdAttr}>${toolIconHtml(name)}<span class="agent-chip-name">${escHtml(agentName)}</span>${countSuffix ? `<span class="turn-group-count"> ${escHtml(countSuffix)}</span>` : ''}</span>`;
  }

  // MCP 칩 (2026-05-24): tool_name 자체가 식별자이므로 detail(agentName)이 비어 있다.
  //   agent-chip 패턴(아이콘 + 짧은 이름)을 부여하되 짧은 이름은 baseName(서버명 splittail).
  //   title에는 mcp__server__method 전체를 보존해 hover로 정체성을 확인할 수 있게 한다.
  if (sub === 'mcp') {
    const countSuffix = count > 1 ? `×${count}` : '';
    const fullLabel   = name + (countSuffix ? ` ${countSuffix}` : '');
    const a11yAttrs   = chipAccessibilityAttrs(key, fullLabel);
    return `<span class="tool-chip agent-chip${subCls} ds-chip" data-tone="${tone}" title="${escHtml(name)}" ${a11yAttrs}${firstIdAttr}>${toolIconHtml(name)}<span class="agent-chip-name">${escHtml(baseName)}</span>${countSuffix ? `<span class="turn-group-count"> ${escHtml(countSuffix)}</span>` : ''}</span>`;
  }

  const aria = count > 1 ? `${baseName} ×${count}` : baseName;
  const a11yAttrs = chipAccessibilityAttrs(key, aria);
  return `<span class="tool-chip${subCls} ds-chip" data-tone="${tone}" ${a11yAttrs}${firstIdAttr}>${fmtActionLabel(baseName, count)}</span>`;
}

/**
 * 칩 공통 접근성 속성 (ADR-003) — data-chip-key + 키보드 포커스/활성화.
 *  - key가 빈 문자열이면 chip-key는 부여하지 않지만 role/tabindex는 유지(시각 표지 일관).
 *  - aria-label은 한국어 패턴 "<라벨> 칩 — 클릭 시 해당 행으로 이동" — 화면엔 안 보임.
 *
 * @param {string} key       chip-key (chipKey 결과)
 * @param {string} labelText 사람이 읽는 라벨 (도구명/응답/Task id 등)
 */
function chipAccessibilityAttrs(key, labelText) {
  const keyAttr = key ? ` data-chip-key="${escHtml(key)}"` : '';
  const aria    = `${labelText} 칩 — 클릭 시 해당 행으로 이동`;
  return `${keyAttr} tabindex="0" role="button" aria-label="${escHtml(aria)}"`;
}

/**
 * 활성 턴의 도구·응답 흐름을 chip-flow HTML(inline-flow) 로 직렬화한다.
 *
 *  - 칩 사이에 CHIP_ARROW_SVG 를 삽입 (단, 첫 칩 앞은 생략).
 *  - response 칩의 etiquette: turn 내 등장 순번을 1-based로 누적해 chipKey 에 사용.
 *  - compressFlowWithResponses 가 SSoT (서버 ADR-006 인터리빙 우선, 폴백 시간순 머지).
 *
 * @param {object} turn TurnItem
 * @returns {string} chip 시퀀스 HTML (감싸는 wrapper 없이 inline 자식들만 반환)
 */
function chipFlowHtml(turn) {
  const flow = compressFlowWithResponses(turn);
  let respSeq = 0;
  const parts = [];
  flow.forEach((item, i) => {
    if (item.kind === 'response') respSeq += 1;
    if (i > 0) parts.push(CHIP_ARROW_SVG);
    parts.push(chipHtml(item, respSeq));
  });
  return parts.join('');
}

// =============================================================================
// turn-line — 한 턴의 inline 컨테이너 (collapsed: 마커만 / active: 마커 + chip-flow)
// =============================================================================

/**
 * 한 턴을 turn-spine 안의 inline 컨테이너 HTML 한 조각으로 직렬화한다.
 *
 *  - 비활성 턴 : ds-turn-marker pill 한 개. 마커 클릭 시 main.js 위임이 setActiveTurnId 호출.
 *  - 활성 턴   : ds-turn-marker(data-state="active") + chip-flow 가 inline 형제로 흐름.
 *               메타(model/prompt/IN/OUT/복잡도/비용)는 flow-head 가 전담 (ADR-002).
 *
 *  - data-turn 속성: 클릭 위임이 어떤 턴을 활성화할지 결정하는 라우팅 키.
 *  - title 툴팁: 비활성 턴 마커 위 마우스 hover 시 prompt 미리보기 노출 (a11y 보조).
 *
 * @param {object} turn TurnItem
 * @param {boolean} isActive 본 턴이 활성 턴인지 여부
 * @returns {string} `<span class="turn-line ...">...</span>`
 */
export function turnLineHtml(turn, isActive) {
  const id = escHtml(turn.turn_id);
  const indexLabel = `T${turn.turn_index}`;
  const cls = `turn-line${isActive ? ' is-active' : ''}`;
  const markerState = isActive ? ' data-state="active"' : '';
  const ariaSel = isActive ? 'true' : 'false';
  const promptTitle = turn.prompt?.preview ? ` title="${escHtml(turn.prompt.preview)}"` : '';

  const marker = `<span class="ds-turn-marker"${markerState}>` +
                   `<span class="marker-dot"></span>` +
                   `<span class="marker-index">${escHtml(indexLabel)}</span>` +
                 `</span>`;

  if (!isActive) {
    // 비활성 턴: 마커 단일. 마커 자체에 data-turn 부여 — turn-line/marker 어느 쪽 클릭이든 동일 동작.
    return `<span class="${cls}" data-turn="${id}" role="tab" aria-selected="${ariaSel}"${promptTitle}>${marker}</span>`;
  }

  // 활성 턴: 마커 + chip-flow. chip-flow 는 display: contents 라 turn-line 의 직접 자식처럼 흐른다.
  const chips = chipFlowHtml(turn);
  return `<span class="${cls}" data-turn="${id}" role="tab" aria-selected="${ariaSel}">${marker}<span class="chip-flow">${chips}</span></span>`;
}

// =============================================================================
// renderSpine — turn-spine 컨테이너 (모든 턴을 inline-flow 한 줄로 잇는다)
// =============================================================================

/**
 * 모든 턴(turns) 을 turn-spine inline-flow HTML 로 직렬화한다.
 *
 *  - 정렬: 최신(turn_index 큰 것)이 좌측 (사용자 기대 — 새 활동이 먼저 눈에 들어옴).
 *  - turn-line 사이에 SPINE_ARROW_SVG 를 삽입해 시퀀스를 시각적으로 잇는다.
 *  - activeTurnId 와 일치하는 턴 한 개만 is-active. 일치 없으면 모든 턴이 collapsed.
 *
 * @param {Array<object>} turns         정렬 전 TurnItem 배열
 * @param {string|null}   activeTurnId  현재 활성 턴 ID
 * @returns {string} turn-spine inner HTML
 */
export function renderSpine(turns, activeTurnId) {
  if (!turns || turns.length === 0) return '';
  const sorted = turns.slice().sort((a, b) => b.turn_index - a.turn_index);
  return sorted.map((turn, i) => {
    const isActive = turn.turn_id === activeTurnId;
    const hasNext  = i < sorted.length - 1;
    return turnLineHtml(turn, isActive) + (hasNext ? SPINE_ARROW_SVG : '');
  }).join('');
}

// =============================================================================
// flow-head — 활성 턴 메타 (prompt / IN / OUT / 복잡도 / 비용)
//   flow-head-minimal (2026-05-22): marker/model 칩 제거 — 사용자 프롬프트가 주역.
// =============================================================================

/**
 * 활성 턴 메타를 flow-head 두 번째 행에 한꺼번에 갱신한다 (ADR-002).
 *
 *  - 갱신 대상: #fhPrompt / #fhTokIn / #fhTokOut / #fhComplexity / #fhCost
 *  - flow-head-minimal (2026-05-22): 사용자 프롬프트를 주역으로 만들기 위해
 *    턴 마커(T#) 칩과 모델 칩(#fhModelChip / #fhModel)을 헤더 행에서 제거.
 *    관련 갱신 로직과 import도 함께 정리해 dead code를 남기지 않는다.
 *  - 비용(%) 은 세션 누적 토큰 대비 본 턴 점유율. sessionTotalTokens===0 이면 '—'.
 *  - 복잡도: tool_call_count > 15 → 복잡(warn), > 5 → 중간(info), 그 외 빈 라벨.
 *  - DOM에 본 ID들이 없으면 silent skip (HTML 변경 전에는 칩만 동작).
 *
 * @param {object} turn               활성 TurnItem
 * @param {number} sessionTotalTokens 세션 누적 토큰 (비용 % 산출용)
 */
export function updateFlowHead(turn, sessionTotalTokens) {
  if (!turn) return;
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
  };

  const promptEl = document.getElementById('fhPrompt');
  if (promptEl) {
    const promptText = turn.prompt?.preview || '';
    promptEl.textContent = promptText;
    promptEl.setAttribute('title', promptText);
  }

  set('fhTokIn',  fmtToken(turn.summary?.tokens_input  || 0));
  set('fhTokOut', fmtToken(turn.summary?.tokens_output || 0));

  // 복잡도 라벨 + 톤 — i18n 키는 turn-views.complexity-* SSoT.
  const complexityEl = document.getElementById('fhComplexity');
  if (complexityEl) {
    const toolCount = turn.summary?.tool_call_count || 0;
    let label = '';
    let tone  = 'neutral';
    if (toolCount > 15) {
      label = window.I18n.t('session.session-detail.turn-views.complexity-high');
      tone  = 'warn';
    } else if (toolCount > 5) {
      label = window.I18n.t('session.session-detail.turn-views.complexity-mid');
      tone  = 'info';
    }
    complexityEl.textContent = label;
    complexityEl.setAttribute('data-tone', tone);
    complexityEl.style.display = label ? '' : 'none';
  }

  // 비용 % — 세션 누적 토큰 대비.
  const costEl = document.getElementById('fhCost');
  if (costEl) {
    const pct = sessionTotalTokens > 0
      ? Math.round((turn.summary?.total_tokens || 0) / sessionTotalTokens * 100)
      : 0;
    costEl.textContent = sessionTotalTokens > 0 ? `${pct}%` : '—';
  }
}

// =============================================================================
// log-pane — 활성 턴 요청 표 (tbody만 갱신해 col-resize 너비 보존)
// =============================================================================

/**
 * 활성 턴의 요청 행을 #turnLogBody tbody에 채운다.
 *
 *  - row HTML SSoT: turn-rows.js#makeTurnLogRows → render/rows.js#makeRequestRow.
 *  - col-resize 너비 보존을 위해 <table>/<colgroup>/<thead>는 건드리지 않고 tbody innerHTML만 교체.
 *  - 활성 턴 행에 한해 anomaly map 을 전달 (state.getTurnAnomalyMap()).
 *  - 본 함수는 표 컨테이너(#turnLogBody)가 이미 DOM 에 있다는 가정 — renderTurnCards 가
 *    영역 골격을 한 번 주입해 둔다.
 *
 *  펼침 상태 보존 (SSE 갱신 안전성):
 *    tbody innerHTML 교체로 `[data-expand-for]` 펼침 행이 모두 사라진다. SSE 로 새 요청이
 *    들어와 본 함수가 재호출될 때 사용자가 보고 있던 펼침 박스가 닫혀 버리는 회귀를
 *    방지하기 위해, 갱신 전에 펼친 행 id 들을 캡처해 두고 새 tbody 가 그려진 직후
 *    `togglePromptExpand` 로 동일 행을 다시 펼친다.
 *
 *    행 id (NormalizedRequest.id) 는 SSE backfill 후에도 안정적이고, _promptCache 가
 *    동일 키로 다시 채워지므로 토글 재요청만으로 본문이 그대로 복원된다.
 *
 * @param {object|null} turn 활성 TurnItem (null/없으면 빈 tbody)
 */
export function renderLogPane(turn) {
  const body = document.getElementById('turnLogBody');
  if (!body) return;
  if (!turn) {
    body.innerHTML = `<tr><td colspan="9" class="cell-empty">${window.I18n.t('common.no-data')}</td></tr>`;
    return;
  }

  // 1) 현재 펼친 행 id 들 캡처 (보통 0~1개, 정책상 단일 펼침이지만 안전하게 배열).
  const expandedIds = [];
  body.querySelectorAll('[data-expand-for]').forEach(el => {
    const id = el.dataset.expandFor;
    if (id) expandedIds.push(id);
  });

  // 2) tbody 갈아끼우기 — col-resize 너비 보존을 위해 thead/colgroup 은 건드리지 않음.
  const anomalyFlags = getTurnAnomalyMap();
  body.innerHTML = makeTurnLogRows(turn, { anomalyFlags, showSession: false });

  // 3) 캡처해 둔 id 들을 다시 펼치기 — 행 id 가 그대로 살아 있고 _promptCache 가 동일 키를
  //    재충전하므로, togglePromptExpand(rid, tr) 한 줄로 동일한 펼침 박스가 복원된다.
  for (const rid of expandedIds) {
    const preview = body.querySelector(`[data-expand-id="${CSS.escape(rid)}"]`);
    const containerRow = preview?.closest('tr');
    if (preview && containerRow && containerRow.dataset.expanded !== rid) {
      togglePromptExpand(rid, containerRow);
    }
  }
}

// =============================================================================
// flashRow / jumpToChipRow — 칩 클릭 → 행 점프 시각 피드백 (ADR-003)
// =============================================================================

/**
 * 행에 row-highlight-flash 클래스를 부여하고 view center로 스크롤한다.
 *  - 연속 클릭 시 같은 행이라도 애니메이션 재시작 — class 제거 + reflow 후 재부여.
 *  - tr 이 null/undefined 면 no-op (silent fail — plan 5.2 검색+점프 조합 정책).
 *  - 노출 시간: 2.2초 — main.js#CHIP_FLASH_MS 와 동일 (시각 SSoT 는 turn-view.css 의
 *    row-flash 키프레임 2.0s + 약간의 여유).
 *
 * @param {HTMLTableRowElement|null} tr 강조할 행
 */
export function flashRow(tr) {
  if (!tr) return;
  const body = tr.closest('tbody');
  if (body) {
    body.querySelectorAll('tr.row-highlight-flash').forEach(el => el.classList.remove('row-highlight-flash'));
  }
  // reflow 강제 — 같은 행 연타 시 keyframes 재실행
  // eslint-disable-next-line no-unused-expressions
  void tr.offsetWidth;
  tr.classList.add('row-highlight-flash');
  tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => tr.classList.remove('row-highlight-flash'), 2200);
}

/**
 * 활성 턴 표에서 동일 chip-key 첫 매칭 행을 찾아 flashRow 호출.
 *  - 매칭 행이 없으면 silent fail (검색 필터 등으로 가려진 경우 사용자 기대 — plan 5.2).
 *
 * @param {string} key chip-key
 */
export function jumpToChipRow(key) {
  if (!key) return;
  const body = document.getElementById('turnLogBody');
  if (!body) return;
  const tr = body.querySelector(`tr[data-chip-key="${CSS.escape(key)}"]`);
  flashRow(tr);
}

// =============================================================================
// detail 탭 바 — Wave 5 view-tab 4종 동적 생성 + setDetailView 분기
// =============================================================================

/**
 * 턴 카드 푸터 .turn-card-bar-pct에 hover 시 노출되는 의미 설명 — i18n 키 보존 (web-design-balance ADR-003).
 *  - 계산식: Math.round(turn.summary.total_tokens / sessionTotalTokens * 100)
 *  - 같은 세션의 모든 턴 합 = 100%
 *  - i18n: session-detail.turn-views.bar-pct-title
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
  if (turn.prompt) {
    const promptBody = extractPromptText({ payload: turn.prompt.payload, preview: turn.prompt.preview, type: 'prompt' });
    if (promptBody && promptBody !== turn.prompt.preview) parts.push(promptBody);
    if (turn.prompt.model) parts.push(turn.prompt.model);
  }
  for (const tc of (turn.tool_calls || [])) {
    if (tc.tool_name)   parts.push(tc.tool_name);
    if (tc.tool_detail) parts.push(tc.tool_detail);
    if (tc.model)       parts.push(tc.model);
  }
  for (const r of (turn.responses || [])) {
    const body = extractAssistantText({ payload: r.payload, preview: r.preview, type: 'response' });
    if (body) parts.push(body);
    else if (r.preview) parts.push(r.preview);
    if (r.model) parts.push(r.model);
  }
  if (Array.isArray(newReminders) && newReminders.length) {
    parts.push(...newReminders);
  } else if (turn.system_reminder) {
    parts.push(turn.system_reminder);
  }
  return parts.join(' ').toLowerCase().slice(0, 16000);
}

/**
 * detail-view 탭 3종 동적 생성 (ADR-turn-view-revamp-004).
 *
 * 책임:
 *  - #viewTabGroup 컨테이너에 view-tab 버튼을 renderTab()으로 주입한다.
 *  - renderTab 기본 출력(ds-tab)에 기존 클래스(view-tab / active), id, data-tab,
 *    title(선택) 을 .replace로 삽입하여 이중 클래스 패턴을 유지한다.
 *  - 이벤트 위임은 main.js의 #detailTabBar [data-tab] 셀렉터가 그대로 처리한다 — 변경 없음.
 *
 * 통합 이력:
 *  - 기존 [turn] + [requests] 두 탭을 단일 [log] 탭으로 합쳤다(turn-spine + 요청 표 한 패널).
 *    배경/근거는 ADR-turn-view-revamp-004 참조. 영역 헤드라인은 두지 않고
 *    상단=흐름·하단=상세 구성이 UI 자체로 자기설명.
 *  - llm / syslib 탭은 기존 그대로 — API 페이로드/시스템 라이브러리 보조 뷰.
 *
 * 호출자: main.js init() — DOMContentLoaded 시 1회.
 */
export function initDetailTabBar() {
  const container = document.getElementById('viewTabGroup');
  if (!container) return;

  /** @type {{ value: string, label: string, id: string, selected: boolean, title?: string }[]} */
  const TABS = [
    { value: 'log',    label: window.I18n.t('session.session-detail.turn-views.tab-log'),    id: 'tabLog',    selected: true  },
    { value: 'llm',    label: window.I18n.t('session.session-detail.turn-views.tab-llm'),    id: 'tabLlm',    selected: false, title: window.I18n.t('session.session-detail.turn-views.tab-llm-title') },
    { value: 'syslib', label: window.I18n.t('session.session-detail.turn-views.tab-syslib'), id: 'tabSysLib', selected: false },
  ];

  container.innerHTML = TABS.map(({ value, label, id, selected, title }) => {
    const activeCls = selected ? ' active' : '';
    const titleAttr = title ? ` title="${escHtml(title)}"` : '';
    return renderTab({ label, selected, value })
      .replace('class="ds-tab"', `class="ds-tab view-tab${activeCls}"`)
      .replace(`data-tab-value="${value}"`, `id="${id}" data-tab="${value}" data-tab-value="${value}"${titleAttr}`);
  }).join('');
}

/**
 * 탭(로그/LLM Input/SysLib) 표시 전환.
 *
 * 책임:
 *  - 단일 'log' 탭이 통합 컨테이너(#detailTurnView) 하나만 노출한다.
 *    이 컨테이너 안에서 turn-spine + flow-head + log-pane 세 영역이 모두 렌더된다.
 *  - llm / syslib 탭은 단일 컨테이너만 노출 — 보조 뷰 성격 유지.
 *  - aria-selected / .active 클래스를 탭 버튼과 동기화 (a11y + CSS 시각 단일 SSoT).
 *
 * 부가 효과:
 *  - llm 탭 진입 시 가장 최근 proxy 요청의 LLM Input 골격 렌더 (T-09 ADR-004 옵션 A).
 *  - syslib 탭 진입 시 시스템 프롬프트 카탈로그 lazy 로드.
 *
 * 호환성 — ADR-003 left-rail-meta-docs: 'metadocs' 탭은 제거됨.
 *           ADR-004 후속: 세션 [도구] 탭은 메타 모드 서브 탭과 중복이라 제거됨.
 *           turn-view-tab fix: 레거시 #detailRequestsView (세션 전체 평면 표) 제거 →
 *           로그 탭은 #detailTurnView 단일 SSoT.
 *
 * @param {'log'|'llm'|'syslib'} tab
 */
export function setDetailView(tab) {
  const turnView   = document.getElementById('detailTurnView');
  const llmView    = document.getElementById('detailLlmInputView');
  const sysLibView = document.getElementById('detailSysLibView');
  if (turnView)   turnView.style.display   = tab === 'log'    ? '' : 'none';
  if (llmView)    llmView.style.display    = tab === 'llm'    ? '' : 'none';
  if (sysLibView) sysLibView.style.display = tab === 'syslib' ? '' : 'none';
  // ds-tab 활성 시각은 [aria-selected="true"]로 결정되므로 .active 클래스와 함께 동기화.
  const _syncTab = (id, isActive) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('active', isActive);
    el.setAttribute('aria-selected', isActive ? 'true' : 'false');
  };
  _syncTab('tabLog',    tab === 'log');
  _syncTab('tabLlm',    tab === 'llm');
  _syncTab('tabSysLib', tab === 'syslib');
  if (tab === 'llm') showLatestLlmInput();
  if (tab === 'syslib') loadSystemPromptLibrary();
}

// =============================================================================
// 호환 stub — 외부 호출처가 아직 남아있어 시그니처 유지 (WT3가 main.js에서 정리)
// =============================================================================

/**
 * 턴 단위 토글 — 신 모델에선 활성 턴 전환이 SSoT라 본 함수는 thin adapter.
 *  - 인자(turnId)를 활성 턴으로 승격해 spine + log-pane을 재렌더한다.
 *  - main.js 가 아직 [data-toggle-turn] 위임을 호출할 수 있으므로 export 유지.
 */
export function toggleTurn(turnId) {
  if (!turnId) return;
  if (_activeTurnId !== turnId) {
    setActiveTurnId(turnId);
    renderActiveTurn();
  }
}

/**
 * 카드 펼침 토글 — 신 모델(turn-spine)에선 카드 자체가 없으므로 turnId를 활성 턴으로
 * 승격한다. main.js [data-toggle-card] 위임 호환용 thin adapter.
 */
export function toggleCardExpand(turnId) {
  toggleTurn(turnId);
}

/** setTurnViewMode: 통합 뷰 모델로 일원화됨 — 외부 호환용 stub. */
export function setTurnViewMode(_mode) { /* no-op */ }

/**
 * 턴 카드의 "API 페이로드" 액션 클릭 진입점 (deeplink pass).
 *  - 흐름: setPendingProxyTargetTs(ts) → setDetailTab('llm') → setDetailView('llm')
 *  - setPendingProxyTargetTs는 1회용 — setDetailView('llm') 안의 showLatestLlmInput()이 소비.
 */
export function openLlmInputForTurn(turnStartedAt) {
  setPendingProxyTargetTs(turnStartedAt);
  setDetailTab('llm');
  setDetailView('llm');
}

/**
 * 레거시 테이블형 turn 뷰 — 통합 카드 뷰 전환 이후 turnListBody가 DOM에 없으므로 no-op.
 * 일부 외부 호출처(session-detail.js facade)를 위해 export 유지.
 */
export function renderTurnView(_turns, _badgeTurns) {
  // 통합 뷰 전환으로 폐기. SSoT는 renderTurnCards.
}

// =============================================================================
// renderActiveTurn — 활성 턴이 바뀌었을 때 영역 A/B 동기 갱신
// =============================================================================

/**
 * 마지막으로 페인트된 활성 턴 ID — startViewTransition 트리거 판정용 latch.
 *  - 사용자 클릭/키보드로 활성 턴이 실제로 바뀌었을 때만 view-transition 으로 wrap.
 *  - SSE 신규 turn 도착 (활성 턴 동일) 같은 갱신은 즉시 swap — 불필요한 깜빡임/스크롤 점프 회피.
 *  - chip-flow stagger 애니메이션 1회 게이트(`do-chip-anim`) 부여 조건도 동일하게 판정한다.
 */
let _lastRenderedActiveTurnId = null;

/**
 * chip-flow stagger 게이트 클래스 자동 해제 타이머 핸들 — 빠른 연속 턴 전환 시 중복 예약 방지.
 */
let _chipAnimReleaseTimer = null;

/**
 * chip-flow stagger 애니메이션 게이트 클래스 부여/해제.
 *
 *  - 호출 시점: 활성 턴 ID 가 실제로 바뀐 직후 (turnChanged === true).
 *  - 동작: 새 활성 turn-line(`.turn-line.is-active`) 에 `.do-chip-anim` 부여 →
 *    가장 긴 nth-child delay (180ms) + duration(--dur-base 200ms) 여유까지 합한
 *    ~420ms 후 클래스 제거. CSS 선택자가 `.is-active.do-chip-anim` 형태이므로
 *    제거 후엔 SSE 갱신으로 chip-flow innerHTML 이 교체되어도 애니메이션이 재발생하지 않음.
 *  - View Transitions API 와 직교 — view-transition 은 pane crossfade, 본 클래스는 칩 stagger 전담.
 *
 * @param {Document} doc 테스트 호환을 위한 document 주입 (기본 globalThis.document)
 */
function triggerChipFlowStagger(doc) {
  const active = doc.querySelector('.turn-line.is-active');
  if (!active) return;
  active.classList.add('do-chip-anim');
  if (_chipAnimReleaseTimer !== null) clearTimeout(_chipAnimReleaseTimer);
  _chipAnimReleaseTimer = setTimeout(() => {
    active.classList.remove('do-chip-anim');
    _chipAnimReleaseTimer = null;
  }, 420);
}

/**
 * 현재 활성 턴(_activeTurnId)을 기준으로 turn-spine + flow-head + log-pane 을 일괄 재렌더한다.
 *
 *  - turn-spine: renderSpine(turns, _activeTurnId) — 활성/비활성 turn-line 클래스만 바뀌므로
 *    전체 inner HTML 교체가 가장 단순. (개수 N=수십 → 비용 부담 없음)
 *  - flow-head:  updateFlowHead(activeTurn) — 7개 필드만 setText (DOM 보존).
 *  - log-pane:   renderLogPane(activeTurn) — tbody innerHTML만 교체 (col-resize 너비 보존).
 *
 * 호출 시점:
 *  - 칩/마커 클릭으로 활성 턴이 바뀐 직후 (main.js 위임이 setActiveTurnId → renderActiveTurn)
 *  - SSE 신규 turn 도착 직후 (flat-view.js 의 applyDetailFilter가 renderTurnCards를 재호출)
 *
 * 애니메이션 (ADR-006, 2026-05-20):
 *   활성 턴 ID 가 직전 페인트 대비 바뀌었고 브라우저가 View Transitions API 를 지원하면
 *   `document.startViewTransition(swap)` 으로 wrap 해서 자동 crossfade. 미지원 환경(구버전 FF 등)
 *   또는 동일 턴 재렌더(SSE) 는 즉시 swap 으로 폴백 — 동작은 동일, 애니메이션만 생략.
 *   세부 CSS 타이밍은 turn-view.css `::view-transition-*` 블록 SSoT.
 *
 * @param {{turns?: Array, badgeTurns?: Array}} [opts] turns 재공급 시 사용 — 미제공이면 state에서 조회
 */
export function renderActiveTurn(opts = {}) {
  const turns      = opts.turns      || getDetailTurns();
  const badgeTurns = opts.badgeTurns || turns;
  if (!turns || turns.length === 0) return;

  /**
   * 실제 DOM 갱신 콜백 — view-transition 안에서든 직접 호출이든 동일하게 사용.
   *  - 반드시 동기적으로 끝나야 함 (View Transitions API 제약 — 비동기 작업 금지).
   */
  const applySwap = () => {
    const spineEl = document.getElementById('turnSpine');
    if (spineEl) spineEl.innerHTML = renderSpine(turns, _activeTurnId);

    const activeTurn = turns.find(t => t.turn_id === _activeTurnId) || null;
    if (!activeTurn) return;

    const sessionTotalTokens = (badgeTurns || []).reduce((s, t) => s + (t.summary?.total_tokens || 0), 0);
    updateFlowHead(activeTurn, sessionTotalTokens);
    renderLogPane(activeTurn);
  };

  const turnChanged = _activeTurnId !== _lastRenderedActiveTurnId;
  const canTransition = turnChanged
    && typeof document.startViewTransition === 'function'
    && _lastRenderedActiveTurnId !== null; // 초기 1회 mount 는 애니메이션 없이 즉시 그림.

  if (canTransition) {
    document.startViewTransition(applySwap);
  } else {
    applySwap();
  }

  // chip-flow stagger 는 "활성 턴이 실제로 바뀐 그 순간 1회" 만 발현.
  //   - 초기 mount(_lastRenderedActiveTurnId === null) 는 페인트 자체가 새것이므로 자연 노출 → 스킵.
  //   - SSE 신규 turn 도착(turnChanged === false) 은 게이트 미부여 → 깜빡임 차단.
  if (turnChanged && _lastRenderedActiveTurnId !== null) {
    triggerChipFlowStagger(document);
  }

  _lastRenderedActiveTurnId = _activeTurnId;
}

// =============================================================================
// 프롤로그 카드 (turn_id NULL 행 — ADR-001 P1) — 기존 시각 어휘 보존
// =============================================================================

/**
 * ADR-001 P1 — 세션 프롤로그 카드 HTML.
 *
 * prompt 등록 이전에 도착한 tool_call/response 행(turn_id NULL)을 turn-spine 상단에
 * 별도 섹션으로 렌더한다. "사용자 프롬프트 = 턴" 원칙을 깨지 않으면서 데이터 누락을
 * 시각적으로 보존한다.
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

// =============================================================================
// 시스템 reminder 칩 / 헤더 집계 뱃지 — 기존 시각 어휘 보존 (보조 메타)
// =============================================================================

/**
 * 칩 + 팝오버 HTML 생성 — 신규 reminder 가 있는 턴에 한해 flow-head 옆에 노출.
 *  - N=0이면 빈 문자열 반환.
 *  - aria id는 turn_index 기반 unique pattern.
 *  - reminder 본문은 escHtml로 escape 후 <pre>에 삽입.
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
 * 세션 헤더 집계 뱃지 (#detailBadges) 갱신.
 *  - 최고 비용 Turn 뱃지 + 최다 호출 Tool 뱃지.
 *  - bloated-sys 헤더 뱃지(detail-view.js applyBloatedSysHeader) 재부착도 함께.
 *  - sessionTotalTokens===0 이면 뱃지 영역 자체를 hidden.
 */
function updateSessionBadges(bTurns, sessionTotalTokens) {
  const badgesEl = document.getElementById('detailBadges');
  if (!badgesEl) return;
  if (sessionTotalTokens <= 0) {
    badgesEl.classList.add('detail-agg-badges--hidden');
    return;
  }
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
  const _sid = getSelectedSession();
  if (_sid) applyBloatedSysHeader(getBloatedSysFor(_sid));
}

// =============================================================================
// renderTurnCards — 통합 "로그" 탭 진입점 (영역 A 골격 + 활성 턴 동기화)
// =============================================================================

/**
 * 통합 뷰 진입점 — 외부에서 turns 데이터가 갱신될 때마다 호출된다 (호출자: flat-view.js).
 *
 * 책임:
 *  1) #turnUnifiedBody 안에 flow-pane(flow-head + turn-spine) + log-pane(.requests-table)
 *     골격을 한 번만 주입. (이미 같은 골격이 있으면 콘텐츠만 갱신)
 *  2) 활성 턴 ID 결정: 명시적으로 set된 것이 현재 turns 안에 있으면 유지, 아니면 최신 턴.
 *  3) renderActiveTurn(turns, badgeTurns) — spine + flow-head + log-pane 동기 갱신.
 *  4) 세션 헤더 집계 뱃지 갱신 + 프롤로그 카드 (turn_id NULL 행) 노출.
 *  5) 검색어가 있으면 applyTurnCardSearch(q) 호출 — 새 SSoT는 spine 마커 hide.
 *
 * 시각 어휘 SSoT: prototype.html (turn-spine + flow-head + log-pane 세 영역).
 *
 * @param {Array} turns         turn filter 결과(보여줄 턴 목록)
 * @param {Array} badgeTurns    헤더 집계용(전체 turn)
 * @param {Array} [allRequests] flat 응답 — agent_spike 추출에 사용. 없으면 turn.agent_spike 폴백.
 */
export function renderTurnCards(turns, badgeTurns, allRequests) {
  const container = document.getElementById('turnUnifiedBody');
  if (!container) return;

  // anomaly-bloated-sys T-16: turn 단위 agent_spike 인덱스 — 헤더 spike summary 용.
  //   현재 활성 턴에 한해 flow-head 옆 spike summary 칩을 노출한다.
  const spikeByTurn = new Map();
  const samplesByTurn = new Map();
  if (Array.isArray(allRequests)) {
    for (const r of allRequests) {
      if (!r?.turn_id) continue;
      if (r.agent_spike && (r.agent_spike.stage === 'spike' || r.agent_spike.stage === 'critical')) {
        const cur = spikeByTurn.get(r.turn_id);
        const m = Number(r.agent_spike.multiplier ?? r.agent_spike.ratio);
        if (!cur || Number(cur.multiplier ?? cur.ratio) < m) spikeByTurn.set(r.turn_id, r.agent_spike);
      }
    }
    for (const r of allRequests) {
      if (!r?.turn_id || !r.parent_tool_use_id) continue;
      const v = (r.tokens_input || 0) + (r.tokens_output || 0);
      if (v <= 0) continue;
      const arr = samplesByTurn.get(r.turn_id) || [];
      arr.push({ ts: r.timestamp || 0, v });
      samplesByTurn.set(r.turn_id, arr);
    }
    for (const [k, arr] of samplesByTurn) {
      arr.sort((a, b) => a.ts - b.ts);
      samplesByTurn.set(k, arr.map(x => x.v));
    }
  }

  const bTurns = (badgeTurns && badgeTurns.length) ? badgeTurns : turns;
  const sessionTotalTokens = bTurns.reduce((s, t) => s + (t.summary.total_tokens || 0), 0);
  updateSessionBadges(bTurns, sessionTotalTokens);

  // ADR-001 P1 — 프롤로그 카드 (turn_id NULL 행). 비면 빈 문자열.
  const prologueHtml = renderPrologueCardHtml(getDetailPrologue());

  if (!turns.length) {
    container.innerHTML = prologueHtml
      || `<div class="state-empty"><span class="state-empty-title">${window.I18n.t('common.no-data')}</span></div>`;
    return;
  }

  // ── 활성 턴 ID 결정 ─────────────────────────────────────────────────────────
  //  - 명시적 _activeTurnId 가 현재 turns 안에 있으면 유지.
  //  - 그렇지 않으면 가장 최신 턴(turn_index 최대)을 활성으로.
  //  - "활성 턴 좁힘"(plan §3.6 Option α) — 동시에 1개만 활성.
  const currentIds = new Set(turns.map(t => t.turn_id));
  if (!_activeTurnId || !currentIds.has(_activeTurnId)) {
    const latest = turns.slice().sort((a, b) => b.turn_index - a.turn_index)[0];
    _activeTurnId = latest ? latest.turn_id : null;
  }

  // ── 활성 턴 메타 보조 — system reminder / spike summary ────────────────────
  const newRemindersByTurn = computeNewRemindersByTurn(turns);
  const activeTurn = turns.find(t => t.turn_id === _activeTurnId) || null;
  const activeReminders = activeTurn ? (newRemindersByTurn.get(activeTurn.turn_id) || []) : [];
  const reminderChipHtml = activeTurn ? buildSystemReminderChip(activeTurn.turn_index, activeReminders) : '';
  const agentSpike = activeTurn ? (spikeByTurn.get(activeTurn.turn_id) || activeTurn.agent_spike || null) : null;
  const spikeSamples = activeTurn ? (
    (agentSpike?.samples)
      || samplesByTurn.get(activeTurn.turn_id)
      || (activeTurn.tool_calls || [])
        .map(tc => (tc.tokens_input || 0) + (tc.tokens_output || 0))
        .filter(v => v > 0)
  ) : [];
  const spikeSummary = activeTurn ? turnSpikeSummaryHtml(agentSpike, spikeSamples) : '';

  // ── 골격 멱등 주입 — flow-pane + log-pane ─────────────────────────────────
  //   책임:
  //     영역 헤드라인(h2) 미사용 — UI/UX 자체가 자기설명 (ADR-002).
  //     첫 렌더에는 전체 골격을 주입하고, 이후 SSE/필터 갱신에서는 골격을 그대로 두고
  //     `flow-summary` 텍스트와 `#fhExtra` 안쪽만 in-place 갱신한다.
  //
  //   왜 멱등인가:
  //     이전에는 매 호출마다 container.innerHTML 을 통째로 교체했다. 그 결과
  //     1) 사용자가 펼쳐 보던 prompt-expand-row(`[data-expand-for]`) 가 매번 닫히고,
  //     2) col-resize 가 보존한 컬럼 너비가 매번 초기화되었다.
  //     renderLogPane 안의 expand-id 캡처 로직은 이미 wipe 된 tbody 를 들여다보므로
  //     영영 도달하지 않는 dead path 였다. 골격을 한 번만 만들면 두 회귀가 동시에 해소된다.
  //
  //   의존성:
  //     - turn-rows.js#makeTurnLogRows  : tbody 콘텐츠 SSoT (renderLogPane 가 호출).
  //     - render/expand.js#togglePromptExpand : tbody 교체 후 펼침 행 복원.
  //     - render/col-resize.js#initColResize  : 첫 골격 주입 시 한 번만 부착.
  //
  //   호출 흐름 (SSE 신규 turn 도착):
  //     applyDetailFilter → renderTurnCards → (skeleton 재사용) → renderActiveTurn →
  //     renderLogPane(expand 캡처 → tbody 교체 → expand 복원).
  const summaryLabel = window.I18n.t('session.session-detail.turn-views.meta-tool-count', { count: turns.length });
  const skeletonExists = !!container.querySelector('#turnLogBody');
  // prologue (turn_id NULL 행) 변경 감지 — 세션 도중 신규 NULL 행이 들어오면 골격을 다시 만든다.
  //   대부분의 세션은 세션 시작 시 prologue 길이가 고정되므로 skeleton 재사용 경로를 탄다.
  const prologueLen = (getDetailPrologue() || []).length;
  const prologueChanged = String(prologueLen) !== (container.dataset.prologueLen ?? '');

  if (!skeletonExists || prologueChanged) {
    container.innerHTML = `
      ${prologueHtml}
      <section class="flow-pane" aria-label="${window.I18n.t('session.session-detail.turn-views.prologue-aria')}" data-region="flow">
        <header class="flow-head">
          <div class="flow-head-row flow-head-active" id="flowHeadActive">
            <span class="turn-line-prompt" id="fhPrompt" title=""></span>
            <span class="turn-line-meta">
              IN <span id="fhTokIn">—</span>
              <span class="meta-sep">·</span>
              OUT <span id="fhTokOut">—</span>
              <span class="meta-sep">·</span>
              <span class="ds-badge" data-tone="neutral" id="fhComplexity"></span>
              <span class="meta-sep">·</span>
              <span id="fhCost">—</span>
            </span>
            <span class="flow-head-extra" id="fhExtra">${reminderChipHtml}${spikeSummary}</span>
          </div>
        </header>
        <div class="turn-spine" id="turnSpine" role="tablist" aria-label="${escHtml(summaryLabel)}"></div>
      </section>
      <section class="log-pane" aria-label="활성 턴 요청 로그" data-region="log">
        <div class="log-table-wrap">
          <table class="requests-table" id="turnLogTable">
            <colgroup>
              <col style="width:100px">
              <col style="width:88px">
              <col style="width:120px">
              <col style="width:130px">
              <col>
              <col style="width:48px"><col style="width:48px"><col style="width:52px"><col style="width:68px">
            </colgroup>
            <thead><tr>
              <th>Time</th><th>Action</th><th>Target</th><th>Model</th><th>Message</th>
              <th style="text-align:right">in</th><th style="text-align:right">out</th>
              <th style="text-align:right">Cache</th><th style="text-align:right">Duration</th>
            </tr></thead>
            <tbody id="turnLogBody"></tbody>
          </table>
        </div>
      </section>
    `;
    container.dataset.prologueLen = String(prologueLen);
    // col-resize 핸들 부착 — 골격을 새로 만들 때만 1회. 재사용 경로에서는 기존 핸들 유지.
    initColResize(document.getElementById('turnLogTable'));
  } else {
    // 골격 재사용 — fhExtra 안쪽과 spine aria-label 만 in-place 갱신.
    //   이렇게 해야 tbody 안의 [data-expand-for] 펼침 행과 col-resize 너비가 보존된다.
    //   summaryLabel 은 더 이상 시각 노출되지 않고 turn-spine aria-label 로만 사용된다.
    const extraEl = document.getElementById('fhExtra');
    if (extraEl) extraEl.innerHTML = reminderChipHtml + spikeSummary;
    const spineEl = container.querySelector('#turnSpine');
    if (spineEl) spineEl.setAttribute('aria-label', summaryLabel);
  }

  // 활성 턴 동기화 — spine + flow-head + log-pane.
  renderActiveTurn({ turns, badgeTurns: bTurns });

  // search-expand-payload: 직전 검색어가 있으면 마커 가시성 동기.
  //   applyDetailFilter 흐름이 flat-view 갱신과 함께 호출하므로 첫 렌더에서도 정합 유지.
  //   기존 turn-card 단위 dataset.searchHaystack 은 turn-spine 모델에선 마커(span.turn-line)
  //   레벨로 옮겨 동일한 작동을 유지하기 위해 spine 렌더 직후 dataset 부착이 필요. (아래 attach)
  attachHaystackToTurnLines(turns, newRemindersByTurn);

  const query = (getSearchQuery?.() ?? '').toLowerCase();
  if (query) applyTurnCardSearch(query);
}

/**
 * turn-spine 안 span.turn-line 마커에 검색용 haystack을 dataset으로 박는다.
 *  - 기존 turn-card 단위로 부여하던 data-search-haystack 을 turn-spine 모델에선
 *    .turn-line 단위로 옮겨 동일 검색 어휘를 유지.
 *  - applyTurnCardSearch가 query 매칭 안 되는 turn-line을 display:none으로 숨김.
 */
function attachHaystackToTurnLines(turns, newRemindersByTurn) {
  const spineEl = document.getElementById('turnSpine');
  if (!spineEl) return;
  const byId = new Map(turns.map(t => [t.turn_id, t]));
  spineEl.querySelectorAll('.turn-line[data-turn]').forEach(el => {
    const id = el.getAttribute('data-turn');
    const turn = byId.get(id);
    if (!turn) return;
    const reminders = newRemindersByTurn.get(turn.turn_id);
    el.dataset.searchHaystack = buildTurnHaystack(turn, reminders);
  });
}

/**
 * 통합 뷰 검색 적용 — turn-spine 모델에선 turn-line(마커) 가시성 토글이 SSoT.
 *  - haystack은 spine 마운트 시 박힌 dataset.searchHaystack.
 *  - 빈 query는 모든 turn-line 노출.
 *  - 매칭 안 되면 display:none.
 *
 * 호출자: session-detail/flat-view.js applyDetailFilter (DETAIL_FILTER_CHANGED listener).
 */
export function applyTurnCardSearch(query) {
  const q = (query || '').toLowerCase();
  // 신 모델 — turn-spine 안 .turn-line[data-turn]
  const lines = document.querySelectorAll('#turnSpine .turn-line[data-turn]');
  lines.forEach(line => {
    if (!q) { line.style.display = ''; return; }
    const haystack = line.dataset.searchHaystack || '';
    line.style.display = haystack.includes(q) ? '' : 'none';
  });
  // SPINE_ARROW 인접 처리: 인접 마커가 숨겨질 때 spine-arrow도 함께 숨김.
  // (구조상 turn-line 다음 형제 svg.spine-arrow가 매칭됨)
  const arrows = document.querySelectorAll('#turnSpine .spine-arrow');
  arrows.forEach(svg => {
    if (!q) { svg.style.display = ''; return; }
    const prev = svg.previousElementSibling;
    const next = svg.nextElementSibling;
    const prevVisible = prev && prev.style.display !== 'none';
    const nextVisible = next && next.style.display !== 'none';
    svg.style.display = (prevVisible && nextVisible) ? '' : 'none';
  });

  // 폴백 — 구버전 turn-card 가 아직 있을 수 있는 환경 호환.
  const cards = document.querySelectorAll('#turnUnifiedBody .turn-card[data-card-turn-id]');
  cards.forEach(card => {
    if (!q) { card.style.display = ''; return; }
    const haystack = card.dataset.searchHaystack || '';
    card.style.display = haystack.includes(q) ? '' : 'none';
  });
}

// =============================================================================
// 사이드 효과 — getExpandedTurnIds 호환 (기존 외부 의존 코드 보호)
// =============================================================================
//
// 신 모델에선 "활성 턴 1개"만 의미를 가지지만, 검색 expand row 복원 흐름이
// _promptCache + togglePromptExpand 의 조합에 의존하므로 import 만 유지.
// 본 모듈은 _promptCache / togglePromptExpand 자체는 사용하지 않지만 향후 확장 룸으로 keep-alive.
export { _promptCache, togglePromptExpand };
// getExpandedTurnIds도 외부에서 import할 가능성이 있어 silent re-export — 향후 정리 가능.
export { getExpandedTurnIds };
