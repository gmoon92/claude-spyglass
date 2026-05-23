/**
 * session-detail/turn-rows.js — 활성 턴의 요청 로그 행 빌더 (얇은 위임 모듈).
 *
 * 책임:
 *  - 활성 턴을 받아 prompt + 도구·응답 인터리빙을 `makeRequestRow`(render/rows.js)에
 *    위임해 9컬럼 표 HTML로 조립한다.
 *  - 칩 ↔ 행 1:1 점프(ADR-turn-view-revamp-003)를 위해 각 행에 `data-chip-key`를
 *    주입한다 — 키 생성 규칙은 본 모듈의 `chipKey` SSoT로 단일화.
 *  - 흐름 그룹화 헬퍼(`compressContinuousTools`, `compressFlowWithResponses`)는
 *    turn-views.js의 칩 렌더러가 재사용하므로 유지.
 *
 * 호출자:
 *  - turn-views.js : renderTurnCards (새 spine + flow-head + log-table 모델)
 *
 * 의존성:
 *  - render/rows.js : `makeRequestRow(r, opts)` — 9컬럼 행 빌더 SSoT
 *  - request-types  : `subTypeOf` — agent/skill/mcp 분류 SSoT
 *  - formatters     : escHtml
 *
 * 설계 메모:
 *  v22 이후 한 turn 안에서 어시스턴트가 도구 호출 사이사이에 텍스트(중간 응답)를 출력한다.
 *  서버 정규화로 `turn.items[]`가 timestamp 오름차순 + `{kind:'tool'|'response', request}`로
 *  도착하므로 본 모듈은 인터리빙/정렬 책임을 지지 않는다 (ADR-006 server-led ordering).
 *
 * @see ADR-turn-view-revamp-003 — 칩 → 첫 매칭 행 스크롤 (data-chip-key SSoT)
 * @see ADR-turn-view-revamp-004 — turn-rows.js → makeRequestRow 위임
 */

import { escHtml } from '../formatters.js';
import { makeRequestRow } from '../render/rows.js';
import { subTypeOf, isAnchorTool } from '../request-types.js';

// =============================================================================
// 흐름 그룹화 헬퍼 — turn-views.js 칩 렌더러가 재사용한다 (SSoT 유지).
// =============================================================================

/**
 * 연속된 동일 도구 호출을 그룹화한다 (SSoT — chip 렌더링에서 재사용).
 *
 * Agent / Skill / Task family는 `tool_detail`(agent sub-name) 까지 압축 키에 포함해
 * 서로 다른 에이전트를 구분 — 동일 라벨로 인접해야 카운트가 증가한다. MCP는 도구 이름 자체가
 * 이미 식별자이므로(`tool_name`이 detail 역할) detail은 합치지 않는다.
 *
 * 필드 `isAgent`의 의미 (2026-05-24 일반화):
 *   "이 칩이 turn-spine에서 아이콘 + 이름 패턴(agent-chip)으로 렌더되어야 하는가?"
 *   원래는 Agent/Skill/Task 정규식 묶음이었으나, MCP·SlashCommand 등 1급 분류 확장에 맞춰
 *   `subTypeOf` 기반으로 일반화. 외부 호환을 위해 필드명은 그대로 유지한다 (chip 렌더러는
 *   agent-chip 분기에 들어가야 할지만 본다). 향후 PR에서 `isNamedTool` 등으로 리네임 권장.
 *
 * @param {Array<object>} toolCalls 도구 호출 요청 배열 (시간순)
 * @returns {Array<{key:string,name:string,count:number,isAgent:boolean,agentName:string,items:object[]}>}
 */
export function compressContinuousTools(toolCalls) {
  const compressed = [];
  for (const tc of toolCalls) {
    const name      = tc.tool_name || '?';
    const sub       = subTypeOf(tc);
    // agent-chip 패턴(아이콘 + 이름)을 받을 named-tool 분류 — Agent/Skill/Task/MCP.
    // (필드명 isAgent는 외부 호환 보존 — 의미만 확장.)
    const isAgent   = sub === 'agent' || sub === 'skill' || sub === 'task' || sub === 'mcp';
    // detail 키 — MCP는 tool_name 자체가 식별자라 detail을 합치지 않는다.
    //   Agent/Skill/Task family는 tool_detail(agent sub-name·task subject 등)까지 키에 포함.
    const agentName = (sub === 'agent' || sub === 'skill' || sub === 'task') ? (tc.tool_detail || '') : '';
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
 * 도구 + 어시스턴트 응답을 시간순 흐름 항목으로 변환한다 (turn-spine 칩 SSoT).
 *
 * 반환 항목:
 *   { kind: 'tool', name, count, isAgent, agentName, items }   — compressContinuousTools 그룹
 *   { kind: 'response', request }                              — 어시스턴트 중간/최종 응답
 *
 * 입력 우선순위:
 *  1) `turn.items[]` (서버 ADR-006 인터리빙) — 사용 가능하면 그대로 신뢰.
 *  2) 폴백: `turn.tool_calls` + `turn.responses`를 timestamp 기준 머지.
 *
 * 결과적으로 화면 칩이 "Bash → Read → ◆ → Edit → ◆ → Edit ×2"처럼 실제 흐름과 일치.
 *
 * @param {object} turn TurnItem (server normalized)
 * @returns {Array<object>} 흐름 항목 배열
 */
export function compressFlowWithResponses(turn) {
  const flow = (turn?.items && turn.items.length)
    ? compressItemsFlow(turn.items)
    : compressLegacyFlow(turn?.tool_calls || [], turn?.responses || []);
  return compressNeutralWindows(flow);
}

/**
 * ANCHOR(색상 시그널) 사이의 연속 NEUTRAL 도구 그룹을 한 칩으로 묶는다.
 *
 * 동기 (chip-density-noise):
 *   `compressContinuousTools` 는 "연속 동일 도구" 만 ×N 압축한다. Bash→Read→Bash→Read 처럼
 *   비연속 패턴은 1×N 그룹 200개로 풀려 flow-head 가 화면을 도배한다 (T2 활성 턴 200건).
 *   디자인 어휘 "무채색 = 시각 노이즈" 를 따르면 노이즈를 한 단계 더 압축하는 게 자연스럽다.
 *
 * 정책:
 *   - ANCHOR  : isAnchorTool(items[0]) true | kind==='response'
 *   - NEUTRAL : 그 외 도구 그룹.
 *   - 윈도우  : ANCHOR 사이의 연속 NEUTRAL 그룹들. items 합산 개수 N≥2 일 때만 묶음.
 *               N=1 이면 단일 칩과 라벨 시각 차이가 모호하므로 통과시킨다.
 *   - 라벨    : 첫 3종 ·-join, 4종+면 "·…" 꼬리. 카운트 = Σ items.length.
 *
 * 묶음 객체 모양 — chipHtml(turn-views.js) isGroup 분기와 동기:
 *   { kind:'tool', name, count, items, kinds, isGroup:true, isAgent:false, agentName:'' }
 *   - items[0] 가 chipKey 결정에 사용되어 묶음 클릭 → 첫 NEUTRAL 행 점프(turn-rows.js#injectChipKey).
 *
 * @param {Array<object>} flow compressFlowWithResponses 1차 결과
 * @returns {Array<object>} ANCHOR 보존 + NEUTRAL 윈도우 묶음 적용
 */
export function compressNeutralWindows(flow) {
  const out = [];
  let buf = [];
  const flush = () => {
    if (buf.length === 0) return;
    if (buf.length === 1) out.push(buf[0]);
    else out.push(makeNeutralGroup(buf));
    buf = [];
  };
  for (const item of flow) {
    if (item.kind === 'response') { flush(); out.push(item); continue; }
    const first = item.items?.[0];
    if (isAnchorTool(first)) { flush(); out.push(item); continue; }
    buf.push(item);
  }
  flush();
  return out;
}

/**
 * NEUTRAL 그룹들을 합쳐 묶음 칩 객체 1개로 만든다.
 *
 *  - items  : 모든 NEUTRAL 요청 flat 누적 (clickThru 점프 타겟 = items[0])
 *  - count  : Σ g.items.length = Σ g.count (compressContinuousTools 가 g.count===g.items.length 보장)
 *  - kinds  : 등장 순서 유지 중복 제거된 도구 이름 목록
 *  - name   : "Read·Bash·Edit" 형태. 4종+ 면 "·…" 로 꼬리 축약 — 칩 폭 폭주 방지.
 *
 * @param {Array<{name:string,items:object[],count:number}>} groups
 * @returns {object} 묶음 칩 메타
 */
function makeNeutralGroup(groups) {
  const items = groups.flatMap(g => g.items);
  const seen = new Set();
  const kinds = [];
  for (const g of groups) {
    if (!seen.has(g.name)) { seen.add(g.name); kinds.push(g.name); }
  }
  const head = kinds.slice(0, 3).join('·');
  const name = kinds.length > 3 ? `${head}·…` : head;
  return {
    kind: 'tool',
    name,
    count: items.length,
    items,
    kinds,
    isGroup: true,
    isAgent: false,
    agentName: '',
    key: `group|${kinds.join(',')}|${items.length}`,
  };
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
      flow.push({ kind: 'response', request: it.request });
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
    flow.push({ kind: 'response', request: r });
  }
  if (i < tools.length) {
    compressContinuousTools(tools.slice(i)).forEach(g => flow.push({ kind: 'tool', ...g }));
  }
  return flow;
}

// =============================================================================
// data-chip-key SSoT — 칩과 행이 같은 키를 공유해 1:1 점프를 결정적으로 보장
// =============================================================================

/**
 * 단일 요청에서 TaskUpdate task id를 추출한다.
 *
 *  - payload.tool_input.taskId(원본 구조 그대로) → 1순위
 *  - tool_detail(렌더 단계에서 합성된 "Task #N…") → fallback. "#6" 패턴에서 숫자만 잡는다.
 *
 * @param {object} r request
 * @returns {string} taskId (없으면 빈 문자열)
 */
function parseTaskId(r) {
  const fromInput = r?.payload?.tool_input?.taskId;
  if (fromInput != null) return String(fromInput);
  const detail = r?.tool_detail || '';
  const m = detail.match(/#(\d+)/);
  return m ? m[1] : '';
}

/**
 * 단일 요청을 chip 메타 객체로 정규화한다 (SSoT — chipKey/chipHtml이 공유).
 *
 *  - response → { type:'response', respSeq }
 *  - TaskUpdate → { type:'task-event', id, status }
 *  - Agent/Skill → { type:'agent'|'skill', label: tool_detail }
 *  - MCP → { type:'mcp', label: shortName, fullName: tool_name }
 *  - 그 외 tool → { type:'tool', label: tool_name }
 *  - prompt / system / 정체 불명 → null (칩 없음)
 *
 * @param {object} r request (NormalizedRequest)
 * @param {number} respSeq 응답일 때 턴 내 ◆ 등장 순번 (1-based)
 * @returns {object|null} chip 메타
 */
export function chipFromRequest(r, respSeq) {
  if (!r) return null;
  if (r.type === 'response') return { type: 'response', respSeq };
  if (r.type !== 'tool_call') return null;
  if (!r.tool_name) return null;

  if (r.tool_name === 'TaskUpdate') {
    const id = parseTaskId(r);
    const status = r?.payload?.tool_input?.status || '';
    return id ? { type: 'task-event', id, status } : null;
  }
  const sub = subTypeOf(r);
  if (sub === 'agent') return { type: 'agent', label: r.tool_detail || r.tool_name };
  if (sub === 'skill') return { type: 'skill', label: r.tool_detail || r.tool_name };
  if (sub === 'mcp')   return { type: 'mcp', label: r.tool_name.split('__').pop() || r.tool_name, fullName: r.tool_name };
  return { type: 'tool', label: r.tool_name };
}

/**
 * 정규화된 chip 메타 → 결정적 키 문자열 (SSoT — turn-spine / log-row 양쪽이 동일 키 사용).
 *
 * 키 형식 (plan §3.3):
 *  - tool       → `tool:<label>`
 *  - response   → `resp:<respSeq>`
 *  - task-event → `task:<id>`
 *  - agent      → `agent:<label>`
 *  - skill      → `skill:<label>`
 *  - mcp        → `mcp:<fullName>`
 *
 * count tool(×N)은 동일 키를 공유한다 — 첫 매칭 행이 점프 타겟.
 *
 * @param {object|null} chip chip 메타 (chipFromRequest 결과)
 * @returns {string} chip key (불가능하면 빈 문자열)
 *
 * @see ADR-turn-view-revamp-003
 */
export function chipKey(chip) {
  if (!chip) return '';
  switch (chip.type) {
    case 'response':   return chip.respSeq ? `resp:${chip.respSeq}` : '';
    case 'task-event': return chip.id ? `task:${chip.id}` : '';
    case 'agent':      return chip.label ? `agent:${chip.label}` : '';
    case 'skill':      return chip.label ? `skill:${chip.label}` : '';
    case 'mcp':        return `mcp:${chip.fullName || chip.label || ''}`;
    case 'tool':       return chip.label ? `tool:${chip.label}` : '';
    default:           return '';
  }
}

/**
 * 단일 요청을 받아 그 요청에 해당하는 행 chip-key를 계산한다 (편의 wrapper).
 * `chipKey(chipFromRequest(r, respSeq))`와 동치.
 */
export function chipKeyForRequest(r, respSeq) {
  return chipKey(chipFromRequest(r, respSeq));
}

// =============================================================================
// 활성 턴 로그 행 빌더 — makeRequestRow 위임 + data-chip-key 주입
// =============================================================================

/**
 * makeRequestRow 산출 HTML에 `data-chip-key="..."` 속성을 주입한다.
 *
 * 정책:
 *  - 키가 빈 문자열이면 속성 자체를 부여하지 않는다 (불필요한 노이즈 회피).
 *  - 행 시작 태그(`<tr ...>`)의 첫 공백 직후에 삽입 — 다른 속성 순서 보존.
 *  - 같은 키가 여러 행에 박혀도 querySelector는 첫 매칭만 반환하므로 안전.
 *
 * @param {string} rowHtml makeRequestRow 결과 (`<tr ...>...</tr>`)
 * @param {string} key 행의 chip-key
 * @returns {string} chip-key가 주입된 행 HTML
 */
function injectChipKey(rowHtml, key) {
  if (!key) return rowHtml;
  return rowHtml.replace(/^<tr /, `<tr data-chip-key="${escHtml(key)}" `);
}

/**
 * 활성 턴의 prompt + tool_calls + responses를 9컬럼 `<tr>` 행 HTML로 직렬화한다.
 *
 * 데이터 흐름:
 *  1) prompt 행 → makeRequestRow({...turn.prompt, type:'prompt'}) — chip-key 없음.
 *  2) 본문 행들 → `turn.items[]` 또는 폴백(tool_calls+responses) 시간순 머지.
 *     각 행에 chipKey 주입 (response 행은 ◆ 등장 순번을 1-based로 누적).
 *
 * 옵션:
 *  - `anomalyFlags`  : Map<requestId, Set<string>> — Spike/loop/slow 뱃지 부여용
 *  - `showSession`   : 기본 false (활성 턴 1개에 묶인 행만 노출)
 *
 * @param {object} turn TurnItem (server normalized)
 * @param {{anomalyFlags?: Map<string, Set<string>>, showSession?: boolean}} [opts]
 * @returns {string} `<tr>` 행들의 HTML concat
 *
 * @see ADR-turn-view-revamp-004 — 하단 표는 기존 요청 탭 모듈(`makeRequestRow`) 100% 재사용.
 */
export function makeTurnLogRows(turn, opts = {}) {
  if (!turn) return '';
  const anomalyMap = opts.anomalyFlags || null;
  const showSession = !!opts.showSession; // 기본 false — 활성 턴 좁힘 정책(Option α).
  const rowOpts = (r) => ({
    showSession,
    anomalyFlags: anomalyMap?.get(r.id) || null,
  });

  const parts = [];

  // 1) prompt 행 — chip-key 없음 (prompt에는 spine 칩이 존재하지 않음).
  if (turn.prompt) {
    const promptReq = { ...turn.prompt, type: 'prompt' };
    parts.push(makeRequestRow(promptReq, rowOpts(promptReq)));
  }

  // 2) 본문 행 — 서버 인터리빙 items[] 우선, 미제공 시 시간순 머지로 폴백.
  let respSeq = 0;
  const walkItems = turn.items?.length
    ? turn.items
    : legacyInterleave(turn.tool_calls || [], turn.responses || []);

  for (const it of walkItems) {
    if (it.kind === 'response') {
      respSeq += 1;
      const req = { ...it.request, type: 'response' };
      const key = chipKeyForRequest(req, respSeq);
      parts.push(injectChipKey(makeRequestRow(req, rowOpts(req)), key));
    } else if (it.kind === 'tool') {
      const req = { ...it.request, type: 'tool_call' };
      const key = chipKeyForRequest(req, respSeq);
      parts.push(injectChipKey(makeRequestRow(req, rowOpts(req)), key));
    }
  }

  return parts.join('');
}

/**
 * 서버 인터리빙(`turn.items`)을 제공하지 않는 구버전 응답을 위한 폴백.
 *
 * tool_calls와 responses를 timestamp 기준으로 머지해 `{kind, request}` 시퀀스로 반환한다.
 * 새 데이터 경로는 서버 SSoT의 items[]를 우선 사용 — 본 함수는 미세한 누락만 보정.
 */
function legacyInterleave(toolCalls, responses) {
  const tools = toolCalls.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const resps = responses.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const out = [];
  let i = 0;
  for (const r of resps) {
    while (i < tools.length && (tools[i].timestamp || 0) <= (r.timestamp || 0)) {
      out.push({ kind: 'tool', request: tools[i++] });
    }
    out.push({ kind: 'response', request: r });
  }
  while (i < tools.length) out.push({ kind: 'tool', request: tools[i++] });
  return out;
}
