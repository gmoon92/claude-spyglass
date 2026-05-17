// Badge·아이콘 렌더링 — type / tool / status / hint / anomaly / sub-type 표지.
//
// 변경 이유: 배지 라벨·아이콘·아이콘 색·오류 판정 기준 변경 시 묶여서 손이 가는 묶음.
// Wave 2: 이중 클래스 패턴 — 기존 CSS 클래스 유지 + ds-badge/ds-chip + data-tone 추가.
//
// 외부 호출: tool-stats.js (toolIconHtml), turn-views.js (toolIconHtml),
//            turn-rows.js / cells.js (subTypeBadgeHtml).

import { escHtml } from '../formatters.js';
import { subTypeOf } from '../request-types.js';
import { svgToolDot, svgAgentDot } from '../design-system/icons/_index.js';

export function typeBadge(type) {
  const known = ['prompt', 'tool_call', 'system', 'response'];
  const cls   = known.includes(type) ? type : 'unknown';
  const label = known.includes(type) ? type : (type || '?');
  const toneMap = { prompt: 'brand', tool_call: 'success', system: 'warn', response: 'info' };
  const tone = toneMap[type] ?? 'neutral';
  return `<span class="type-badge type-${cls} ds-badge" data-tone="${tone}" title="${escHtml(type)}" aria-label="${escHtml(type)}">${escHtml(label)}</span>`;
}

// eventType: r.event_type 그대로 전달 — 'pre_tool'이면 pulse 애니메이션 자동 적용
export function toolIconHtml(toolName, eventType = null) {
  const isAgent  = toolName && /^(Agent|Skill|Task)/.test(toolName);
  const runCls   = eventType === 'pre_tool' ? ' tool-icon-running' : '';
  return isAgent
    ? `<span class="tool-icon tool-icon-agent${runCls} ds-icon">${svgAgentDot({ size: 12 })}</span>`
    : `<span class="tool-icon tool-icon-tool${runCls} ds-icon">${svgToolDot({ size: 12 })}</span>`;
}

// payload에서 tool_response 추출
function getToolResponse(r) {
  if (!r.payload) return null;
  try {
    const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
    return p?.tool_response ?? null;
  } catch { return null; }
}

// 상태 배지: 오류만 표시 (Signal over Noise 원칙)
export function toolStatusBadge(r) {
  const tr = getToolResponse(r);
  if (!tr) return ''; // tool_response 없으면 미표시 (실행 전/중)
  const tn = r.tool_name || '';
  let hasError = false;
  if (tn === 'Bash') {
    hasError = !!(tr.stderr && tr.stderr.trim());
  } else if (tn === 'Agent' || tn === 'Skill') {
    try {
      const content = Array.isArray(tr.content) ? tr.content : (tr.content ? [tr.content] : []);
      hasError = content.some(c => c?.type === 'tool_result' && c?.is_error);
      if (!hasError && tr.is_error) hasError = true;
    } catch { hasError = !!tr.is_error; }
  } else {
    hasError = !!tr.is_error;
  }
  return hasError ? `<span class="mini-badge badge-error ds-badge" data-tone="error">${window.I18n.t('badges.renderers.tool-status.error')}</span>` : '';
}

// 도구별 결과 힌트: "[202줄]" 등
export function toolResponseHint(r) {
  const tr = getToolResponse(r);
  if (!tr) return ''; // tool_response 없으면 미표시
  const tn = r.tool_name || '';
  try {
    if (tn === 'Read') {
      const lines = tr.totalLines ?? tr.total_lines;
      if (lines != null) return window.I18n.t('badges.renderers.tool-hint.lines', { n: lines });
    }
    if (tn === 'Bash') {
      return (tr.stderr && tr.stderr.trim()) ? window.I18n.t('badges.renderers.tool-hint.error') : '';
    }
    if (tn === 'Edit' || tn === 'Write' || tn === 'MultiEdit') {
      return window.I18n.t('badges.renderers.tool-hint.saved');
    }
    if (tn === 'Grep') {
      const num = tr.numFiles ?? tr.num_files;
      if (num != null) return window.I18n.t('badges.renderers.tool-hint.files', { n: num });
    }
    if (tn === 'Glob') {
      const arr = Array.isArray(tr.filenames ?? tr.results ?? tr.paths ?? tr) ? (tr.filenames ?? tr.results ?? tr.paths) : null;
      if (arr != null) return window.I18n.t('badges.renderers.tool-hint.matches', { n: arr.length });
    }
    if (tn === 'Agent' || tn === 'Skill') {
      return tr.is_error ? window.I18n.t('badges.renderers.tool-hint.failed') : '';
    }
  } catch { /* 파싱 실패는 무시 */ }
  return '';
}

export function anomalyBadgesHtml(flags) {
  if (!flags || flags.size === 0) return '';
  const toneMap = { spike: 'warn', loop: 'info', slow: 'warn' };
  return [...flags].map(f => {
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
export function subTypeBadgeHtml(r) {
  const sub = subTypeOf(r);
  if (!sub) return '';
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
    const detail = r.tool_detail || r.tool_input?.subagent_type || '?';
    fullId = `Agent · ${detail}`;
    deepLinkAttrs = ` data-meta-doc-type="agent" data-meta-doc-id="${escHtml(detail)}" role="button" tabindex="0"`;
  } else if (sub === 'skill') {
    label  = 'Skill';
    const detail = r.tool_detail || r.tool_input?.skill || '?';
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
  const toneMap = { mcp: 'mcp', agent: 'agent', skill: 'skill', task: 'task' };
  const tone = toneMap[sub] ?? 'neutral';
  return `<span class="sub-type-chip sub-type-chip-${sub} ds-chip" data-tone="${tone}" title="${escHtml(fullId)}" aria-label="${escHtml(fullId)}"${deepLinkAttrs}>${label}</span>`;
}
