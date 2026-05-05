/**
 * session-detail/turn-rows.js — 턴 내부의 prompt/tool_call/response 세부 행을 만드는 빌더.
 *
 * 책임:
 *  - 단일 turn 객체를 받아 prompt 행 + 시간순(tool_call ↔ response) 인터리빙 + empty placeholder를
 *    HTML 문자열로 조립한다.
 *  - turn 행 빌더에 필요한 보조 helper(연속 도구 그룹화, 단일 행 빌더, 신뢰도 마크)를 함께 둔다.
 *  - 외부에서는 buildTurnDetailRows / compressContinuousTools / fmtActionLabel만 사용한다.
 *
 * 호출자:
 *  - turn-views.js : renderTurnView, renderTurnCards (양쪽 뷰가 동일 helper 공유)
 *
 * 의존성:
 *  - formatters: escHtml, fmtToken, fmtDate, formatDuration
 *  - renderers : contextPreview, toolIconHtml,
 *                targetInnerHtml, modelChipHtml, trustOf
 *
 * 설계 메모:
 *  v22 이후 한 turn 안에서 어시스턴트가 도구 호출 사이사이에 텍스트(중간 응답)를 출력한다.
 *  storage 단의 TurnItem.responses 배열은 timestamp 오름차순으로 들어오며,
 *  interleaveToolsAndResponses가 각 응답 timestamp를 경계로 toolCalls를 슬라이스해
 *  "도구 그룹 → 응답 → 도구 그룹 → 응답 …" 형태로 자연스럽게 인터리빙한다.
 */

import { escHtml, fmtToken, fmtDate, formatDuration } from '../formatters.js';
import {
  contextPreview, toolIconHtml,
  targetInnerHtml, modelChipHtml, trustOf,
} from '../renderers.js';

/**
 * 도구 이름 + count를 "Grep ×6" 형식의 HTML로 포맷한다 (SSoT).
 * count=1이면 이름만 반환. ×와 count 사이 공백 없음, 이름과 × 사이 공백 1개.
 */
export function fmtActionLabel(baseName, count) {
  if (count <= 1) return escHtml(baseName);
  return `${escHtml(baseName)} <span class="turn-group-count">×${count}</span>`;
}

/**
 * 연속된 동일 도구 호출을 그룹화한다 (SSoT — chip/세부행 양쪽에서 재사용).
 * Agent/Skill/Task 계열은 agentName(tool_detail)까지 압축 키에 포함하여 서로 다른 에이전트를 구분.
 */
export function compressContinuousTools(toolCalls) {
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
 * 도구 + 어시스턴트 응답을 시간순 흐름 chip 시퀀스로 변환한다 (turn 카드 헤더 chip SSoT).
 *
 * 반환 항목:
 *   { kind: 'tool', name, count, isAgent, agentName, items }   — 기존 compressContinuousTools 그룹
 *   { kind: 'response' }                                       — 어시스턴트 중간/최종 응답
 *
 * 입력 우선순위:
 *  1) turn.items[] (서버 ADR-006 인터리빙) — 사용 가능하면 그대로 신뢰.
 *  2) 폴백: turn.tool_calls + turn.responses를 timestamp 기준 머지.
 *
 * 그룹화 규칙: tool은 인접 동일 이름끼리 count 증가. 사이에 response가 끼면 그룹 끊기.
 * 결과적으로 화면 chip이 "Bash → Read → ◆ → Edit → ◆ → Edit → ◆ → Edit ×2"처럼
 * 실제 흐름과 일치 — 이전엔 응답이 chip에서 누락되어 "Edit ×4"로 보이는 오해 발생.
 *
 * @param turn TurnItem (server normalized)
 * @returns 흐름 항목 배열
 */
export function compressFlowWithResponses(turn) {
  if (turn?.items && turn.items.length) return compressItemsFlow(turn.items);
  return compressLegacyFlow(turn?.tool_calls || [], turn?.responses || []);
}

function compressItemsFlow(items) {
  const flow = [];
  let toolBuf = [];
  const flushTools = () => {
    if (toolBuf.length) {
      compressContinuousTools(toolBuf).forEach(g => flow.push({ kind: 'tool', ...g }));
      toolBuf = [];
    }
  };
  for (const it of items) {
    if (it.kind === 'tool') toolBuf.push(it.request);
    else if (it.kind === 'response') {
      flushTools();
      flow.push({ kind: 'response' });
    }
  }
  flushTools();
  return flow;
}

function compressLegacyFlow(toolCalls, responses) {
  const tools = toolCalls.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const resps = responses.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  if (resps.length === 0) {
    return compressContinuousTools(tools).map(g => ({ kind: 'tool', ...g }));
  }
  const flow = [];
  let i = 0;
  for (const r of resps) {
    const seg = [];
    while (i < tools.length && (tools[i].timestamp || 0) <= (r.timestamp || 0)) seg.push(tools[i++]);
    if (seg.length) compressContinuousTools(seg).forEach(g => flow.push({ kind: 'tool', ...g }));
    flow.push({ kind: 'response' });
  }
  if (i < tools.length) {
    compressContinuousTools(tools.slice(i)).forEach(g => flow.push({ kind: 'tool', ...g }));
  }
  return flow;
}

/**
 * 턴 행 첫 컬럼 마커 아이콘 SSoT (web-design-balance-pass ADR-005).
 *  - 응답 행: `◆` info 톤 dot — 어시스턴트 텍스트 응답 표지.
 *  - 응답이 없는 tool-only turn placeholder: `—` dim 글리프(작게).
 *  - 도구 행 마커는 toolIconHtml(◉/◎)이 별도로 처리 — 여기서는 응답 전용만 캡슐화.
 *  - 호출자(renderResponseRow / renderEmptyResponseRow)는 이 함수를 통해서만 마커를 가져온다.
 *
 * 시각 어휘는 toolIconHtml의 ◉/◎와 형제 — 한 글리프, info 톤(--type-response-color)으로 구분.
 */
function responseMarkerHtml() {
  return `<span class="tool-icon tool-icon-response" aria-hidden="true">◆</span>`;
}
function emptyResponseMarkerHtml() {
  return `<span class="tool-icon text-dim" aria-hidden="true">—</span>`;
}

/** 단일 tool_call 행 HTML. tool_call 자체는 모델 의미 없으므로 trust 표시 생략. */
function renderToolRow(tc) {
  const tcData    = { ...tc, type: 'tool_call' };
  const tcPreview = contextPreview(tcData, 60); // toolResponseHint 힌트 포함 (중복 제거)
  const tcTarget  = targetInnerHtml(tcData).html; // toolStatusBadge 인라인 포함 (중복 제거)
  return `<div class="turn-row turn-row-tool" data-type="tool_call">
      <span>&nbsp;</span>
      <div class="tool-cell">
        <span class="tool-main">${tcTarget}</span>
        <span class="tool-sub">${tcPreview || ''}</span>
      </div>
      <span class="num cell-token">${tc.tokens_input  > 0 ? fmtToken(tc.tokens_input)  : '—'}</span>
      <span class="num cell-token">${tc.tokens_output > 0 ? fmtToken(tc.tokens_output) : '—'}</span>
      <span class="num cell-token text-dim">${formatDuration(tc.duration_ms)}</span>
      <span class="num cell-time text-dim">${fmtDate(tc.timestamp)}</span>
    </div>`;
}

/**
 * 연속 tool_call 그룹들의 HTML을 만들어 이어 붙인다.
 *  - 단독 도구: renderToolRow 그대로
 *  - 그룹: chevron + 합계 토큰/시간을 담은 머리 행 + 자식 행
 */
function renderToolSegmentHtml(toolCalls) {
  if (!toolCalls || toolCalls.length === 0) return '';
  const groups = compressContinuousTools(toolCalls);
  return groups.map(group => {
    if (group.count === 1) return renderToolRow(group.items[0]);
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
}

/**
 * 단일 assistant 응답 행 HTML.
 *
 * ADR-001 (log-view-unification): 서버 정규화로 response.model이 이미 turn.prompt.model로
 *   폴백 적용된 상태로 도착 (`NormalizedRequest.model_fallback_applied`로 추적 가능).
 *   따라서 클라에서의 자체 폴백 (`rawResp.model ?? promptModel ?? null`)은 제거됨.
 *
 * @deprecated `promptModel` 인자는 호환성을 위해 시그니처에 남기지만 무시됨.
 *   서버 정규화가 이미 폴백을 처리한다 (ADR-001).
 */
function renderResponseRow(rawResp, _promptModel /* unused — server already filled (ADR-001) */) {
  const respData = { ...rawResp, type: 'response' };
  const previewHtml = contextPreview(respData, 80);
  const target      = targetInnerHtml(respData).html;
  const trust       = trustOf(respData);
  const trustAttr   = (trust === 'synthetic' || trust === 'unknown')
    ? ` data-trust="${trust}"` : '';
  const modelChip   = modelChipHtml(respData, { mini: true });
  const confMark    = confidenceMarkHtml(respData.tokens_confidence);
  return `
    <div class="turn-row turn-row-response" data-type="response"${trustAttr}>
      <span>${responseMarkerHtml()}</span>
      <div class="tool-cell">
        <span class="tool-main">${target}${modelChip}${confMark}</span>
        ${previewHtml ? `<span class="tool-sub">${previewHtml}</span>` : ''}
      </div>
      <span class="num cell-token">${respData.tokens_input  > 0 ? fmtToken(respData.tokens_input)  : '—'}</span>
      <span class="num cell-token">${respData.tokens_output > 0 ? fmtToken(respData.tokens_output) : '—'}</span>
      <span class="num cell-token text-dim">—</span>
      <span class="num cell-time text-dim">${fmtDate(respData.timestamp)}</span>
    </div>`;
}

/** 응답이 하나도 없는 turn에 표시할 placeholder. tool-only turn임을 명시. */
function renderEmptyResponseRow() {
  return `
    <div class="turn-row turn-row-response turn-row-response--empty" data-type="response">
      <span>${emptyResponseMarkerHtml()}</span>
      <div class="tool-cell">
        <span class="tool-sub">(no text response — tool-only turn)</span>
      </div>
      <span class="num cell-token">—</span>
      <span class="num cell-token">—</span>
      <span class="num cell-token text-dim">—</span>
      <span class="num cell-time text-dim">—</span>
    </div>`;
}

/**
 * tool_calls와 responses를 timestamp 기준으로 시간순 머지하여 HTML을 조립한다.
 *
 * @deprecated ADR-006 (log-view-unification): 서버가 `turn.items[]`로 이미 인터리빙된
 *   `{kind:'tool'|'response', request}` 배열을 보내준다.
 *   호환성을 위해 함수는 보존 (구버전 응답 또는 다른 호출자 대비)하지만, `buildTurnDetailRows`는
 *   `turn.items`가 있으면 `renderItemsHtml`을 우선 사용한다.
 */
function interleaveToolsAndResponses(toolCalls, responses, promptModel) {
  const tools = toolCalls || [];
  const resps = responses || [];
  if (resps.length === 0) {
    return renderToolSegmentHtml(tools);
  }
  let i = 0;
  const parts = [];
  for (const resp of resps) {
    const segTools = [];
    while (i < tools.length && tools[i].timestamp <= resp.timestamp) {
      segTools.push(tools[i++]);
    }
    parts.push(renderToolSegmentHtml(segTools));
    parts.push(renderResponseRow(resp, promptModel));
  }
  if (i < tools.length) {
    parts.push(renderToolSegmentHtml(tools.slice(i)));
  }
  return parts.join('');
}

/**
 * 서버에서 인터리빙된 `turn.items[]`를 HTML로 조립 (ADR-006).
 *
 * `items`는 timestamp 오름차순으로 정렬된 `{kind:'tool'|'response', request:NormalizedRequest}` 배열.
 * 연속된 `kind:'tool'` 항목들은 하나의 segment로 묶어 `renderToolSegmentHtml`로 그룹화하고,
 * `kind:'response'` 항목마다 `renderResponseRow`를 호출한다.
 *
 * 클라는 더 이상 인터리빙·시간순 정렬 책임을 지지 않는다.
 */
function renderItemsHtml(items) {
  if (!items || items.length === 0) return '';
  const parts = [];
  let segTools = [];
  const flushTools = () => {
    if (segTools.length > 0) {
      parts.push(renderToolSegmentHtml(segTools));
      segTools = [];
    }
  };
  for (const it of items) {
    if (it.kind === 'tool') {
      segTools.push(it.request);
    } else if (it.kind === 'response') {
      flushTools();
      // promptModel 인자는 서버 폴백 적용으로 무시됨 (ADR-001)
      parts.push(renderResponseRow(it.request, null));
    }
  }
  flushTools();
  return parts.join('');
}

/**
 * 토큰 신뢰도 마크 (data-honesty-ui ADR-002).
 * tokens_confidence가 'low' 또는 'error'면 '*' + title 툴팁, 그 외엔 빈 문자열.
 */
function confidenceMarkHtml(confidence) {
  if (!confidence || confidence === 'high') return '';
  const tip = confidence === 'error'
    ? '응답 메타 신뢰도 오류 (수집 실패)'
    : '응답 메타 신뢰도 낮음 (proxy fallback)';
  return `<sup class="confidence-low-mark" title="${escHtml(tip)}">*</sup>`;
}

/**
 * 턴 내 세부 행(prompt + tool_call + responses 인터리빙)을 HTML로 조립한다.
 *  - prompt: 단일 행 (있을 때)
 *  - 본문: tool_calls와 responses의 시간순 머지 (interleaveToolsAndResponses)
 *  - 응답이 0개 + 도구가 있으면: tool-only turn placeholder
 *  - 둘 다 0개: '도구 호출 없음' 메시지
 *
 * 'estimated' 분기는 ADR-token-trust-cleanup-001로 제거됨 (trustOf가 더 이상 'estimated' 미발행).
 * response.model 폴백은 renderResponseRow 내부에서 처리한다.
 */
export function buildTurnDetailRows(turn) {
  const promptData        = turn.prompt ? { ...turn.prompt, type: 'prompt' } : null;
  const promptPreviewHtml = promptData ? contextPreview(promptData, 80) : '';
  const promptTarget      = promptData ? targetInnerHtml(promptData).html : '';
  const promptTrust       = promptData ? trustOf(promptData) : 'trusted';
  const promptTrustAttr   = (promptTrust === 'synthetic' || promptTrust === 'unknown')
    ? ` data-trust="${promptTrust}"` : '';
  const promptModelChip   = promptData ? modelChipHtml(promptData, { mini: true }) : '';
  const promptConfMark    = promptData ? confidenceMarkHtml(promptData.tokens_confidence) : '';
  const promptRow         = promptData ? `
    <div class="turn-row turn-row-prompt" data-type="prompt"${promptTrustAttr}>
      <span></span>
      <div class="tool-cell">
        <span class="tool-main">${promptTarget}${promptModelChip}${promptConfMark}</span>
        ${promptPreviewHtml ? `<span class="tool-sub">${promptPreviewHtml}</span>` : ''}
      </div>
      <span class="num cell-token">${promptData.tokens_input  > 0 ? fmtToken(promptData.tokens_input)  : '—'}</span>
      <span class="num cell-token">${promptData.tokens_output > 0 ? fmtToken(promptData.tokens_output) : '—'}</span>
      <span class="num cell-token text-dim">${formatDuration(promptData.duration_ms)}</span>
      <span class="num cell-time text-dim">${fmtDate(promptData.timestamp)}</span>
    </div>` : '';

  // ADR-006: 서버 정규화로 turn.items가 제공되면 우선 사용 (인터리빙 책임 서버 이관).
  // 호환성: items가 없는 응답이면 기존 tool_calls/responses 폴백 경로.
  const responses = turn.responses || [];
  const mergedRows = turn.items
    ? renderItemsHtml(turn.items)
    : interleaveToolsAndResponses(turn.tool_calls || [], responses, turn.prompt?.model);
  const responseRow = (responses.length === 0) ? renderEmptyResponseRow() : '';

  return promptRow + (mergedRows || '<div class="turn-row-empty">도구 호출 없음</div>') + responseRow;
}
