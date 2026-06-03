/**
 * features/session-detail/turn-rows.ts — 활성 턴 칩/흐름 순수 로직 (React 소비).
 *
 * (이전 위치 assets/js/session-detail/turn-rows.ts → src 이동. assets 잔존 소비처 0.
 *  request-types(assets) 는 정방향(src→assets) import 로 유지.)
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
 * @see ADR-turn-view-revamp-003: 칩 → 첫 매칭 행 스크롤 (data-chip-key SSoT)
 * @see ADR-turn-view-revamp-004: turn-rows.js → makeRequestRow 위임
 */

import { subTypeOf, isAnchorTool } from '../../../assets/js/request-types.js';

// any 제거(P5-03): 디스플레이 레이어가 실제 접근하는 필드만 명시하고 나머지는 index signature(unknown).
// src/features/session-detail/TurnRows.tsx 의 RowLike/TurnLike 패턴과 동형(legacy → src 단방향 import 라 재선언).
/** 서버 JSON 파생 요청 행(NormalizedRequest 부분). chip/그룹화에 읽는 필드만 명시. */
interface Req {
  id?: string | null;
  type?: string | null;
  tool_name?: string | null;
  tool_detail?: string | null;
  timestamp?: string | number | null;
  payload?: { tool_input?: { status?: unknown; [k: string]: unknown }; [k: string]: unknown } | null;
  [k: string]: unknown;
}
/** 서버 JSON 파생 턴. 인터리브 소스(items) 또는 폴백(tool_calls/responses). */
interface Turn {
  prompt?: Req | null;
  items?: FlowItem[] | null;
  tool_calls?: Req[] | null;
  responses?: Req[] | null;
  [k: string]: unknown;
}
/** 인터리빙된 흐름 항목. 두 형태를 겸한다: {kind,request} 또는 그룹 {kind,name,items,count,...}. */
interface FlowItem {
  kind?: string;
  request?: Req;
  name?: string;
  items?: Req[];
  count?: number;
  [k: string]: unknown;
}
/** chipFromRequest 산출 chip 메타(chipKey/chipHtml 공유 SSoT). */
interface Chip {
  type: string;
  respSeq?: number;
  id?: string;
  status?: string;
  label?: string;
  fullName?: string;
  [k: string]: unknown;
}
interface ToolGroup { key: string; name: string; count: number; isAgent: boolean; agentName: string; items: Req[]; kinds?: string[]; isGroup?: boolean; }

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
export function compressContinuousTools(toolCalls: Req[]): ToolGroup[] {
  const compressed: ToolGroup[] = [];
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
export function compressFlowWithResponses(turn: Turn) {
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
export function compressNeutralWindows(flow: FlowItem[]) {
  const out: FlowItem[] = [];
  let buf: FlowItem[] = [];
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
function makeNeutralGroup(groups: FlowItem[]) {
  const items = groups.flatMap((g: FlowItem) => g.items as Req[]);
  const seen = new Set<string>();
  const kinds: string[] = [];
  for (const g of groups) {
    const nm = g.name ?? '';
    if (!seen.has(nm)) { seen.add(nm); kinds.push(nm); }
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

// items 는 인터리브 흐름 항목(FlowItem: {kind, request}) — Req[] 오타정정(호출처 turn.items:FlowItem[]).
// it.request 가 Req|undefined 로 정확히 좁혀져 캐스트 없이 SSoT 정합.
function compressItemsFlow(items: FlowItem[]) {
  const flow: FlowItem[] = [];
  let toolBuf: Req[] = [];
  const flushTools = () => {
    if (toolBuf.length) {
      compressContinuousTools(toolBuf).forEach(g => flow.push({ kind: 'tool', ...g }));
      toolBuf = [];
    }
  };
  for (const it of items) {
    if (it.kind === 'tool' && it.request) toolBuf.push(it.request);
    else if (it.kind === 'response') {
      flushTools();
      flow.push({ kind: 'response', request: it.request });
    }
  }
  flushTools();
  return flow;
}

function compressLegacyFlow(toolCalls: Req[], responses: Req[]) {
  // timestamp 는 string|number — 원본 동작(`|| 0` 후 산술, ISO는 NaN→no-op) 보존 위해 number 캐스트.
  const tools = toolCalls.slice().sort((a: Req, b: Req) => ((a.timestamp || 0) as number) - ((b.timestamp || 0) as number));
  const resps = responses.slice().sort((a: Req, b: Req) => ((a.timestamp || 0) as number) - ((b.timestamp || 0) as number));
  if (resps.length === 0) {
    return compressContinuousTools(tools).map(g => ({ kind: 'tool', ...g }));
  }
  const flow: FlowItem[] = [];
  let i = 0;
  for (const r of resps) {
    const seg: Req[] = [];
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
function parseTaskId(r: Req) {
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
export function chipFromRequest(r: Req, respSeq?: number): Chip | null {
  if (!r) return null;
  if (r.type === 'response') return { type: 'response', respSeq };
  if (r.type !== 'tool_call') return null;
  if (!r.tool_name) return null;

  if (r.tool_name === 'TaskUpdate') {
    const id = parseTaskId(r);
    const status = String(r?.payload?.tool_input?.status ?? '');
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
export function chipKey(chip: Chip | null) {
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
export function chipKeyForRequest(r: Req, respSeq?: number) {
  return chipKey(chipFromRequest(r, respSeq));
}

// =============================================================================
// 활성 턴 로그 행 빌더(makeTurnLogRows) 및 makeRequestRow 위임은 P5 데드 vanilla 삭제에서
// 제거됨 — React TurnRows.tsx 가 행 렌더를 전담한다. 본 모듈은 순수 chip 압축/키 로직만 제공.
// =============================================================================
