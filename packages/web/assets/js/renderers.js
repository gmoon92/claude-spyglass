// HTML 빌더 모듈 — DOM 조작 없이 HTML 문자열 반환
import { escHtml, fmtToken, fmtRelative, formatDuration, fmtTimestamp } from './formatters.js';

export const FLAT_VIEW_COLS  = 9;  // Time Action Target Model Message in out Cache Duration
export const RECENT_REQ_COLS = 10; // + Session

const PROMPT_CACHE_MAX = 500;
export const _promptCache = new Map(); // export: togglePromptExpand 공유

export function makeSkeletonRows(cols, count = 2) {
  const row = `<tr><td colspan="${cols}" class="table-empty"><span class="skeleton"></span></td></tr>`;
  return row.repeat(count);
}

export function typeBadge(type) {
  const known = ['prompt', 'tool_call', 'system'];
  const cls   = known.includes(type) ? type : 'unknown';
  const label = known.includes(type) ? type : (type || '?');
  return `<span class="type-badge type-${cls}" title="${escHtml(type)}" aria-label="${escHtml(type)}">${escHtml(label)}</span>`;
}

export function toolIconHtml(toolName) {
  const isAgent = toolName && /^(Agent|Skill|Task)/.test(toolName);
  return isAgent
    ? '<span class="tool-icon tool-icon-agent">◎</span>'
    : '<span class="tool-icon tool-icon-tool">◉</span>';
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

export function makeActionCell(r) {
  return typeBadge(r.type);
}

export function makeTargetCell(r) {
  if (r.type === 'prompt') {
    return `<td class="cell-target"><span class="target-role-badge role-badge-user"><span class="role-icon">◉</span>user</span></td>`;
  }
  if (r.type === 'system') {
    return `<td class="cell-target"><span class="target-role-badge role-badge-system"><span class="role-icon">◉</span>system</span></td>`;
  }
  if (r.type !== 'tool_call' || !r.tool_name) {
    return `<td class="cell-target cell-empty">—</td>`;
  }
  const icon = toolIconHtml(r.tool_name);
  const inProgress = r.event_type === 'pre_tool';
  let nameHtml;
  if ((r.tool_name === 'Skill' || r.tool_name === 'Agent') && r.tool_detail) {
    nameHtml = `<span class="action-name">${icon}${escHtml(r.tool_name)}(<span class="action-sub-name">${escHtml(r.tool_detail)}</span>)</span>`;
  } else {
    nameHtml = `<span class="action-name">${icon}${escHtml(r.tool_name)}</span>`;
  }
  const statusBadge = inProgress
    ? `<span class="mini-badge badge-running">실행 중</span>`
    : toolStatusBadge(r);
  return `<td class="cell-target"><span class="target-cell-inner">${nameHtml}${statusBadge}</span></td>`;
}

export function makeModelCell(r) {
  if (!r.model) {
    return `<td class="cell-model cell-empty">—</td>`;
  }
  return `<td class="cell-model"><span class="model-name">${escHtml(r.model)}</span></td>`;
}

export function makeCacheCell(r) {
  if (r.type !== 'prompt' || !r.cache_read_tokens || r.cache_read_tokens <= 0) {
    return `<td class="cell-token num cell-empty">—</td>`;
  }
  const readVal  = r.cache_read_tokens;
  const writeVal = r.cache_creation_tokens || 0;
  return `<td class="cell-token num cache-cell" data-cache-read="${readVal}" data-cache-write="${writeVal}">${fmtToken(readVal)}</td>`;
}

export function getContextText(r) {
  if (!r) return null;
  if (r.type === 'tool_call') {
    if (r.tool_name === 'Agent' || r.tool_name === 'Skill') {
      try {
        const p  = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
        const ti = p?.tool_input || {};
        const text = r.tool_name === 'Agent'
          ? (ti.description || ti.prompt || r.tool_detail)
          : (ti.args || r.tool_detail);
        if (text) return text;
      } catch {}
    }
    return r.tool_detail || null;
  }
  if (r.type === 'prompt')   return r.preview || extractPromptText(r) || null;
  if (r.type === 'system')   return extractPromptText(r) || null;
  return null;
}

export function parseToolDetail(raw) {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return Object.entries(obj).slice(0, 3)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(' · ');
    }
  } catch {}
  try {
    const lines = raw.split('\n').filter(l => /^\w[\w\s]*=/.test(l.trim()));
    if (lines.length) return lines.slice(0, 3).map(l => l.trim()).join(' · ');
  } catch {}
  return raw;
}

export function extractPromptText(r) {
  if (r.preview && typeof r.preview === 'string' && r.preview.trim()) return r.preview;
  if (!r.payload) return '';
  try {
    const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
    return p?.prompt ?? p?.content ?? p?.tool_input ?? (typeof p === 'string' ? p : '') ?? '';
  } catch { return ''; }
}

export function contextPreview(r, maxLen = 60) {
  const rawText = getContextText(r);
  if (!rawText) return '';
  if (_promptCache.size >= PROMPT_CACHE_MAX) {
    _promptCache.delete(_promptCache.keys().next().value);
  }
  _promptCache.set(r.id, rawText);
  const displayText = r.type === 'tool_call'
    ? (parseToolDetail(rawText) ?? rawText)
    : rawText;
  const flat    = displayText.replace(/\n/g, ' ');
  const display = flat.slice(0, maxLen);
  const tooltip = rawText.length > 200
    ? rawText.slice(0, 200) + `… (총 ${rawText.length.toLocaleString('ko-KR')}자)`
    : rawText;
  // tool_call 타입에만 힌트 서픽스 추가 (maxLen 초과해도 힌트는 잘리지 않음)
  const hint = r.type === 'tool_call' ? toolResponseHint(r) : '';
  const hintHtml = hint ? ` <span class="tool-response-hint">${escHtml(hint)}</span>` : '';
  return `<span class="prompt-preview" data-expand-id="${escHtml(r.id)}" title="${escHtml(tooltip)}">${escHtml(display)}${flat.length > maxLen ? '…' : ''}${hintHtml}</span>`;
}

export function togglePromptExpand(rid, container, cols) {
  document.querySelectorAll('[data-expand-for]').forEach(el => el.remove());
  if (container.dataset.expanded === rid) { delete container.dataset.expanded; return; }
  container.dataset.expanded = rid;
  const text        = _promptCache.get(rid) || '';
  const lengthHint  = text.length > 500 ? `\n─── 총 ${text.length.toLocaleString('ko-KR')}자 ───` : '';
  const fullDisplay = text + lengthHint;
  const boxHtml     = `<div class="prompt-expand-box"><button class="expand-copy-btn" onclick="navigator.clipboard.writeText(this.nextElementSibling.textContent).then(()=>{this.textContent='✓복사됨';setTimeout(()=>{this.textContent='복사'},1500)})">복사</button><pre style="margin:0;white-space:pre-wrap;word-break:break-all">${escHtml(fullDisplay)}</pre></div>`;
  if (container.closest('table')) {
    const colCount  = cols ?? container.closest('table')?.querySelector('thead tr')?.children?.length ?? FLAT_VIEW_COLS;
    const expandTr  = document.createElement('tr');
    expandTr.dataset.expandFor = rid;
    expandTr.className = 'prompt-expand-row';
    expandTr.innerHTML = `<td colspan="${colCount}">${boxHtml}</td>`;
    container.after(expandTr);
  } else {
    const expandDiv = document.createElement('div');
    expandDiv.dataset.expandFor = rid;
    expandDiv.style.cssText = 'grid-column:1/-1;border-bottom:1px solid var(--border);padding:0;';
    expandDiv.innerHTML = boxHtml;
    container.after(expandDiv);
  }
}

export function makeRequestRow(r, opts = {}) {
  const fmtTs  = opts.fmtTime || fmtTimestamp;
  const sessTd = opts.showSession
    ? `<td class="cell-sess"><span class="sess-id" title="${escHtml(r.session_id||'')}">${r.session_id ? r.session_id.slice(0,12)+'…' : '—'}</span></td>`
    : '';
  const msgPreview = contextPreview(r);
  const msgHtml    = msgPreview
    ? msgPreview
    : `<span class="cell-msg-empty" aria-label="메시지 없음">—</span>`;
  return `<tr data-type="${escHtml(r.type||'')}">
    <td class="cell-time num">${fmtTs(r.timestamp)}</td>
    <td class="cell-action">${makeActionCell(r)}</td>
    ${makeTargetCell(r)}
    ${makeModelCell(r)}
    <td class="cell-msg">${msgHtml}</td>
    <td class="cell-token num">${r.tokens_input  > 0 ? fmtToken(r.tokens_input)  : '—'}</td>
    <td class="cell-token num">${r.tokens_output > 0 ? fmtToken(r.tokens_output) : '—'}</td>
    ${makeCacheCell(r)}
    <td class="cell-token num">${formatDuration(r.duration_ms)}</td>
    ${sessTd}
  </tr>`;
}

export function extractFirstPrompt(payload) {
  if (!payload) return '';
  function clean(text) {
    return text.replace(/<[^>]+>/g, '').replace(/[\n\r]+/g, ' ').trim().slice(0, 60);
  }
  try {
    const p    = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const text = p?.preview ?? p?.prompt ?? p?.content ?? (typeof p === 'string' ? p : '');
    return text ? clean(text) : '';
  } catch {
    const m = typeof payload === 'string' && payload.match(/"prompt"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) return clean(m[1].replace(/\\n/g, ' '));
    return '';
  }
}

export function makeSessionRow(s, isSelected) {
  const isActive = !s.ended_at;
  const shortId  = s.id.slice(0, 8);
  const preview  = extractFirstPrompt(s.first_prompt_payload);
  const rel      = fmtRelative(s.started_at);
  return `<tr class="clickable${isSelected ? ' row-selected' : ''}" data-session-id="${escHtml(s.id)}">
    <td colspan="4" class="sess-row-cell" style="padding:5px 10px">
      <div class="sess-row-header">
        <span class="sess-id" title="${escHtml(s.id)}">${escHtml(shortId)}</span>
        <span class="sess-row-time">${rel}</span>
        <span class="sess-row-tokens">${fmtToken(s.total_tokens)}</span>
        <span class="sess-row-status${isActive ? ' active' : ''}">${isActive ? '●' : '○'}</span>
      </div>
      ${preview ? `<div class="sess-row-preview" title="${escHtml(preview)}">${escHtml(preview)}</div>` : ''}
    </td>
  </tr>`;
}

export function renderRequests(list) {
  document.getElementById('requestCount').textContent = `${list.length}건`;
  const body = document.getElementById('requestsBody');
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="${RECENT_REQ_COLS}" class="table-empty">데이터 없음</td></tr>`;
    return;
  }
  body.innerHTML = list.map(r => makeRequestRow(r, { showSession: true })).join('');
}

export function appendRequests(list) {
  const body = document.getElementById('requestsBody');
  if (!list.length) return;
  body.insertAdjacentHTML('beforeend', list.map(r => makeRequestRow(r, { showSession: true })).join(''));
}
