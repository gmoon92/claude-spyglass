// @ts-check
// Badge·아이콘 렌더링 — type / tool / sub-type 표지.
//
// 변경 이유: 배지 라벨·아이콘·아이콘 색 변경 시 묶여서 손이 가는 묶음.
// Wave 2: 이중 클래스 패턴 — 기존 CSS 클래스 유지 + ds-badge/ds-chip + data-tone 추가.
//
// B-2(2026): anomaly(bloated-sys/context-saturation/agent-spike/turn-spike) + tool-status/hint
//   HTML-string producer 는 React 컴포넌트(src/components/render/anomaly-badges.tsx·tool-status-badge.tsx)
//   + 순수 SSoT(src/lib/anomaly-field.ts·tool-response-field.ts·render/extract.ts)로 이관·제거됨.

import { escHtml } from '../formatters.js';
import { subTypeOf } from '../request-types.js';
import { svgToolDot, svgAgentDot, svgSkillDot, svgMcpDot } from '../design-system/icons/_index.js';
import type { RowChipReader } from '../view-types.js';

export function typeBadge(type: string) {
  const known = ['prompt', 'tool_call', 'system', 'response'];
  const cls   = known.includes(type) ? type : 'unknown';
  const label = known.includes(type) ? type : (type || '?');
  const toneMap: Record<string, string> = { prompt: 'brand', tool_call: 'success', system: 'warn', response: 'info' };
  const tone = toneMap[type] ?? 'neutral';
  return `<span class="type-badge type-${cls} ds-badge" data-tone="${tone}" title="${escHtml(type)}" aria-label="${escHtml(type)}">${escHtml(label)}</span>`;
}

/**
 * 도구 아이콘 라우팅 SSoT — 도구 이름과 이벤트 타입으로 SVG 글리프와 톤 클래스를 결정.
 *
 * 디자인 어휘 (2026-05-24 4종 분리):
 *  - Skill / SlashCommand → svgSkillDot (fish-eye: 외곽 링 + 채워진 점), tone="skill" (#FACC15 황금)
 *  - MCP (mcp__*)         → svgMcpDot   (plug/socket: 사방 점 + 중앙 원),  tone="mcp"   (#22D3EE cyan)
 *  - Task family          → svgAgentDot (bullseye: 이중 stroke 링),       tone="task"  (#F77F00 오렌지)
 *  - Agent                → svgAgentDot (bullseye: 이중 stroke 링),       tone="agent" (#FF9B6E 살구)
 *  - 그 외 일반 도구       → svgToolDot  (fish-eye: tool-dot.js),          tone="tool"  (녹색)
 *
 * 왜 4종을 모두 분리했나:
 *  - 사용자 요구: turn-spine 칩에서 Skill / Agent / Task / MCP가 모두 시각적으로 식별되어야 함.
 *  - 이전엔 isAgent 정규식 `/^(Agent|Skill|Task)/` 으로 셋 다 동일 bullseye를 받았고,
 *    MCP는 아이콘 자체가 없어 칩 텍스트만 노출됐다.
 *  - 디자인 토큰(--sub-type-{agent|skill|mcp|task}-color)은 이미 분리되어 있었으나
 *    글리프가 동일/부재해 신호가 약했다 — 글리프+색의 이중 신호로 강화.
 *  - SlashCommand(향후)는 Skill과 동일 분기로 처리 — 사용자 결정.
 *
 * 분기 우선순위 (mcp__·Task·Skill 접두사 충돌 없음 — 순서 무관하지만 가독성 위해 명시):
 *   1) Skill (정확 매칭 / 접두사) → SlashCommand도 여기로
 *   2) mcp__ 접두사               → MCP plug 글리프
 *   3) Task 접두사                → Task family (TaskCreate/Update/Get/List/Output/Stop)
 *   4) Agent (정확 매칭 / 접두사)  → Agent
 *   5) 그 외                       → 일반 도구
 *
 * 호출자(전 적용 면):
 *  - session-detail/turn-views.js#chipHtml  : turn-spine inline-flow 칩
 *  - render/cells.js#targetInnerHtml        : flat-view 행 Target 셀 role-icon
 *  - tool-stats.js (per-tool 통계 행)
 *  - meta-docs-view.js#metaDocTypeBadge     : 'Agent' 하드코딩으로 호출 (Behavior Definitions
 *    카탈로그는 의도적으로 동일 톤 — 변경 영향 없음)
 *
 * @param {string|null|undefined} toolName  도구 식별자 (예: 'Skill', 'Agent', 'mcp__redmine__getIssue', 'TaskCreate', 'Bash')
 * @param {string|null} [eventType=null]    'pre_tool'이면 실행 중 pulse 애니메이션 클래스 부착
 * @returns {string} 아이콘 SVG를 감싼 `<span>` HTML
 */
export function toolIconHtml(toolName: string | null | undefined, eventType: string | null = null) {
  const name    = typeof toolName === 'string' ? toolName : '';
  const isSkill = name === 'Skill' || name.startsWith('Skill');
  const isMcp   = !isSkill && name.startsWith('mcp__');
  const isTask  = !isSkill && !isMcp && name.startsWith('Task');
  const isAgent = !isSkill && !isMcp && !isTask && (name === 'Agent' || name.startsWith('Agent'));
  const runCls  = eventType === 'pre_tool' ? ' tool-icon-running' : '';
  if (isSkill) {
    return `<span class="tool-icon tool-icon-skill${runCls} ds-icon">${svgSkillDot({ size: 12 })}</span>`;
  }
  if (isMcp) {
    return `<span class="tool-icon tool-icon-mcp${runCls} ds-icon">${svgMcpDot({ size: 12 })}</span>`;
  }
  if (isTask) {
    return `<span class="tool-icon tool-icon-task${runCls} ds-icon">${svgAgentDot({ size: 12 })}</span>`;
  }
  if (isAgent) {
    return `<span class="tool-icon tool-icon-agent${runCls} ds-icon">${svgAgentDot({ size: 12 })}</span>`;
  }
  return `<span class="tool-icon tool-icon-tool${runCls} ds-icon">${svgToolDot({ size: 12 })}</span>`;
}

export function anomalyBadgesHtml(flags: Set<string> | null | undefined) {
  if (!flags || flags.size === 0) return '';
  const toneMap: Record<string, string> = { spike: 'warn', loop: 'info', slow: 'warn' };
  return [...flags].map((f: string) => {
    const tone = toneMap[f] ?? 'neutral';
    return `<span class="mini-badge badge-${f} ds-badge" data-tone="${tone}" data-mini-badge-tooltip="${f}">${f}</span>`;
  }).join('');
}

/**
 * Sub-type chip HTML SSoT (turn-view-badges ADR-001 + R2).
 *
 * 책임:
 *   tool_call 행 옆에 분류 라벨(MCP / Agent / Skill / Task)을 일관된 시각 어휘로 부착한다.
 *   subTypeOf(r) 결과에 따라 chip HTML 또는 빈 문자열을 반환.
 *
 * 호출자:
 *   - session-detail/turn-rows.js : renderToolRow / renderToolSegmentHtml (단독·그룹 머리)
 *   - render/cells.js             : targetInnerHtml (평면 뷰 cell-target, ADR-006)
 *   - 향후 분류 chip 등장 위치는 모두 이 함수 경유 (HTML 직접 작성 금지)
 *
 * 호버 정책:
 *   네이티브 title 속성으로 도구 전체 식별자 노출 (ADR-004).
 *     MCP   → r.tool_name 전체 (예: 'mcp__redmine__getIssue')
 *     Agent → 'Agent · {tool_detail | tool_input.subagent_type}'
 *     Skill → 'Skill · {tool_detail | tool_input.skill}'
 *     Task  → '{tool_name} · {tool_detail}' (예: 'TaskCreate · subject') — ADR-007 R2
 *   model 칩(model.js)이 채택한 title 패턴과 동일 — 코드베이스 일관성.
 *
 * 빈 sub_type(일반 Bash/Read/Edit 등)이면 ''을 반환해 기존 행 모양을 보존.
 * 이는 "Signal over Noise" 원칙 — 분류가 있는 행만 표지 노출.
 *
 * @param {object} r 행 raw 데이터 (tool_name / tool_detail / tool_input 사용)
 * @returns {string} chip HTML 또는 '' (빈 sub_type)
 */
export function subTypeBadgeHtml(r: RowChipReader) {
  const sub = subTypeOf(r);
  if (!sub) return '';
  // tool_input 필드(파싱본)에서 문자열만 안전 추출 — 기존 `r.tool_input?.X || ...` 와 동치(비문자열은 폴백).
  const tiStr = (key: string): string => {
    const v = r.tool_input?.[key];
    return typeof v === 'string' ? v : '';
  };
  let label;
  let fullId;
  // ADR-003 left-rail-meta-docs: agent/skill chip은 Behavior Definitions 딥링크 트리거.
  // data-meta-doc-{type,id} 속성을 부여하면 main.js 글로벌 위임에서 enterMetaDocsMode 호출.
  let deepLinkAttrs = '';
  if (sub === 'mcp') {
    label  = 'MCP';
    fullId = r.tool_name || 'mcp__?';
  } else if (sub === 'agent') {
    label  = 'Agent';
    const detail = r.tool_detail || tiStr('subagent_type') || '?';
    fullId = `Agent · ${detail}`;
    deepLinkAttrs = ` data-meta-doc-type="agent" data-meta-doc-id="${escHtml(detail)}" role="button" tabindex="0"`;
  } else if (sub === 'skill') {
    label  = 'Skill';
    const detail = r.tool_detail || tiStr('skill') || '?';
    fullId = `Skill · ${detail}`;
    deepLinkAttrs = ` data-meta-doc-type="skill" data-meta-doc-id="${escHtml(detail)}" role="button" tabindex="0"`;
  } else if (sub === 'task') {
    // Task family — 라벨은 'Task'로 통일, title에 실제 도구명(TaskCreate/Update/Get/List)과 detail 노출
    label  = 'Task';
    const detail = r.tool_detail || '';
    fullId = detail ? `${r.tool_name} · ${detail}` : (r.tool_name || 'Task');
  } else {
    return '';
  }
  const toneMap: Record<string, string> = { mcp: 'mcp', agent: 'agent', skill: 'skill', task: 'task' };
  const tone = toneMap[sub] ?? 'neutral';
  return `<span class="sub-type-chip sub-type-chip-${sub} ds-chip" data-tone="${tone}" title="${escHtml(fullId)}" aria-label="${escHtml(fullId)}"${deepLinkAttrs}>${label}</span>`;
}
