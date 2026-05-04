// Badge·아이콘 렌더링 — type / tool / status / hint / anomaly 표지.
//
// 변경 이유: 배지 라벨·아이콘·아이콘 색·오류 판정 기준 변경 시 묶여서 손이 가는 묶음.
//
// 외부 호출: tool-stats.js (toolIconHtml), turn-views.js (toolIconHtml).

import { escHtml } from '../formatters.js';

export function typeBadge(type) {
  const known = ['prompt', 'tool_call', 'system', 'response'];
  const cls   = known.includes(type) ? type : 'unknown';
  const label = known.includes(type) ? type : (type || '?');
  return `<span class="type-badge type-${cls}" title="${escHtml(type)}" aria-label="${escHtml(type)}">${escHtml(label)}</span>`;
}

// eventType: r.event_type 그대로 전달 — 'pre_tool'이면 pulse 애니메이션 자동 적용
export function toolIconHtml(toolName, eventType = null) {
  const isAgent  = toolName && /^(Agent|Skill|Task)/.test(toolName);
  const runCls   = eventType === 'pre_tool' ? ' tool-icon-running' : '';
  return isAgent
    ? `<span class="tool-icon tool-icon-agent${runCls}">◎</span>`
    : `<span class="tool-icon tool-icon-tool${runCls}">◉</span>`;
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
  return hasError ? `<span class="mini-badge badge-error">오류</span>` : '';
}

// 도구별 결과 힌트: "[202줄]" 등
export function toolResponseHint(r) {
  const tr = getToolResponse(r);
  if (!tr) return ''; // tool_response 없으면 미표시
  const tn = r.tool_name || '';
  try {
    if (tn === 'Read') {
      const lines = tr.totalLines ?? tr.total_lines;
      if (lines != null) return `[${lines}줄]`;
    }
    if (tn === 'Bash') {
      return (tr.stderr && tr.stderr.trim()) ? '[오류]' : '';
    }
    if (tn === 'Edit' || tn === 'Write' || tn === 'MultiEdit') {
      return '[저장됨]';
    }
    if (tn === 'Grep') {
      const num = tr.numFiles ?? tr.num_files;
      if (num != null) return `[${num}개 파일]`;
    }
    if (tn === 'Glob') {
      const arr = Array.isArray(tr.filenames ?? tr.results ?? tr.paths ?? tr) ? (tr.filenames ?? tr.results ?? tr.paths) : null;
      if (arr != null) return `[${arr.length}개 매칭]`;
    }
    if (tn === 'Agent' || tn === 'Skill') {
      return tr.is_error ? '[실패]' : '';
    }
  } catch { /* 파싱 실패는 무시 */ }
  return '';
}

export function anomalyBadgesHtml(flags) {
  if (!flags || flags.size === 0) return '';
  return [...flags].map(f => `<span class="mini-badge badge-${f}" data-mini-badge-tooltip="${f}">${f}</span>`).join('');
}
