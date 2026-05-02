// HTML 빌더 모듈 — DOM 조작 없이 HTML 문자열 반환
import { escHtml, fmtToken, fmtRelative, formatDuration, fmtTimestamp, shortModelName } from './formatters.js';
import { subTypeOf } from './request-types.js';

export const FLAT_VIEW_COLS  = 9;  // Time Action Target Model Message in out Cache Duration
export const RECENT_REQ_COLS = 10; // + Session

const PROMPT_CACHE_MAX = 500;
export const _promptCache = new Map(); // export: togglePromptExpand 공유

export function makeSkeletonRows(cols, count = 2) {
  const row = `<tr><td colspan="${cols}" class="table-empty"><span class="skeleton"></span></td></tr>`;
  return row.repeat(count);
}

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

export function makeActionCell(r) {
  return typeBadge(r.type);
}

// Target 컬럼 내부 HTML (td 래퍼 없음) — 테이블/그리드 공용 재사용.
// 반환값: { html, empty } — empty=true면 호출자가 "—" 같은 빈 placeholder를 자유롭게 감쌈.
export function targetInnerHtml(r) {
  if (r.type === 'prompt') {
    return { html: `<span class="target-role-badge role-badge-user"><span class="role-icon">◉</span>user</span>`, empty: false };
  }
  if (r.type === 'response') {
    return { html: `<span class="target-role-badge role-badge-assistant"><span class="role-icon">◉</span>assistant</span>`, empty: false };
  }
  if (r.type === 'system') {
    return { html: `<span class="target-role-badge role-badge-system"><span class="role-icon">◉</span>system</span>`, empty: false };
  }
  if (r.type !== 'tool_call' || !r.tool_name) {
    return { html: '—', empty: true };
  }
  const inProgress = r.event_type === 'pre_tool';
  const icon = toolIconHtml(r.tool_name, r.event_type); // event_type 직접 전달
  let nameHtml;
  if ((r.tool_name === 'Skill' || r.tool_name === 'Agent') && r.tool_detail) {
    const ms = shortModelName(r.model);
    const modelBadge = ms ? ` <span class="action-model">${escHtml(ms)}</span>` : '';
    nameHtml = `<span class="action-name">${icon}${escHtml(r.tool_name)}(<span class="action-sub-name">${escHtml(r.tool_detail)}</span>)${modelBadge}</span>`;
  } else {
    nameHtml = `<span class="action-name">${icon}${escHtml(r.tool_name)}</span>`;
  }
  const statusBadge = inProgress ? '' : toolStatusBadge(r);
  return { html: `<span class="target-cell-inner">${nameHtml}${statusBadge}</span>`, empty: false };
}

export function makeTargetCell(r) {
  const { html, empty } = targetInnerHtml(r);
  return empty
    ? `<td class="cell-target cell-empty">${html}</td>`
    : `<td class="cell-target">${html}</td>`;
}

/**
 * 모델 분류 — ADR-data-trust-visual-001
 * @param {string|null} model
 * @returns {'haiku'|'sonnet'|'opus'|'external'|'synthetic'|'unknown'}
 */
export function modelClassOf(model) {
  if (!model) return 'unknown';
  const m = String(model).toLowerCase();
  if (m === 'synthetic' || m === '<synthetic>') return 'synthetic';
  // claude-haiku-..., claude-3-5-haiku, claude-3.5-haiku-... 모두 매칭
  if (m.includes('haiku'))  return 'haiku';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('opus'))   return 'opus';
  if (m.startsWith('kimi-') || m.startsWith('kimi'))           return 'external';
  return 'unknown';
}

/**
 * 신뢰도 분류 — ADR-data-trust-visual-001 / ADR-token-trust-cleanup-001
 *
 * 책임:
 *   행(prompt/response) 렌더링 시 model/토큰 신뢰도를 단일 키워드로 분류한다.
 *
 * 호출자:
 *   - makeRequestRow → rowTrustClass / data-trust 속성
 *   - session-detail.buildTurnDetailRows → turn-row data-trust 속성
 *   - modelChipHtml 내부 (보조 라벨 결정용 — 현재는 라벨 없음)
 *
 * 우선순위:
 *   synthetic > unknown > trusted (external은 trusted로 처리)
 *
 * 'estimated' 제거 사유 (ADR-token-trust-cleanup-001):
 *   - 'estimated'는 토큰 출처 추정이지 model 추정이 아닌데,
 *     UI에서는 model 칩 옆에 라벨링되어 명칭 오용 발생.
 *   - server proxy backfill 확장으로 hook 행의 tokens_source가
 *     proxy 응답 시점에 'proxy'/'high'로 승격되므로 'unavailable'은
 *     1~2초 transient 상태로만 존재 → 시각 표지 가치 소멸.
 *   - synthetic/unknown은 운영자가 알아야 하는 비정상 상태이므로 유지.
 *
 * @param {{model?: string|null, tokens_source?: string|null}} r
 * @returns {'trusted'|'synthetic'|'unknown'}
 */
export function trustOf(r) {
  const cls = modelClassOf(r?.model);
  if (cls === 'synthetic') return 'synthetic';
  if (cls === 'unknown')   return 'unknown';
  return 'trusted';
}

/**
 * 모델 칩의 짧은 라벨 — ADR-data-trust-visual-001
 * 예: "claude-sonnet-4-5-20250929" → "Sonnet 4.5"
 *     "claude-opus-4-7-20260101"   → "Opus 4.7"
 *     "kimi-k2-0905-preview"        → "Kimi k2"
 *     null                          → "모델불명"
 *     "<synthetic>" / "synthetic"   → "SDK 합성"
 */
export function modelChipLabel(model, cls) {
  if (cls === 'unknown')   return '모델불명';
  if (cls === 'synthetic') return 'SDK 합성';
  if (cls === 'external') {
    const m = String(model);
    const head = m.split('-').slice(0, 2).join(' ');
    return head.charAt(0).toUpperCase() + head.slice(1);
  }
  // claude-{family}-{major}-{minor}-{date} 또는 claude-{major}-{minor}-{family}-{date}
  const m = String(model);
  // 신형: claude-(haiku|sonnet|opus)-{major}-{minor}
  let match = m.match(/claude-(haiku|sonnet|opus)-(\d+)(?:[-.](\d+))?/i);
  if (match) {
    const family = match[1].charAt(0).toUpperCase() + match[1].slice(1);
    const ver = match[3] ? `${match[2]}.${match[3]}` : match[2];
    return `${family} ${ver}`;
  }
  // 구형: claude-{major}-{minor}-(haiku|sonnet|opus)
  match = m.match(/claude-(\d+)(?:[-.](\d+))?-(haiku|sonnet|opus)/i);
  if (match) {
    const family = match[3].charAt(0).toUpperCase() + match[3].slice(1);
    const ver = match[2] ? `${match[1]}.${match[2]}` : match[1];
    return `${family} ${ver}`;
  }
  // 기타 — family 단어만 추출
  const fm = m.match(/(haiku|sonnet|opus)/i);
  if (fm) return fm[1].charAt(0).toUpperCase() + fm[1].slice(1);
  return model;
}

/**
 * 모델 칩 HTML — title 속성에 풀네임 보관
 *
 * 책임:
 *   model 식별 칩(둥근 dot + family-version 라벨)을 단일 HTML 토큰으로 반환.
 *   호출자는 prompt/response/tool_call 행 어디에서나 동일 칩을 재사용한다.
 *
 * 호출자:
 *   - makeModelCell (테이블 셀)
 *   - session-detail.buildTurnDetailRows (turn-row main span, mini variant)
 *   - targetInnerHtml (Skill/Agent target에서 model 보조 표시)
 *
 * 의존성:
 *   - modelClassOf, modelChipLabel — 칩 클래스/라벨 결정
 *   - escHtml — XSS 방어
 *
 * @param {object} r 행 raw 데이터 (model, tokens_source 필드 사용)
 * @param {object} [opts]
 * @param {boolean} [opts.mini] turn view용 mini variant 적용
 *
 * 'trust-label' 제거 (ADR-token-trust-cleanup-001):
 *   기존에는 tokens_source==='unavailable' 시 칩 옆 dashed "추정" 라벨을 부착했으나,
 *   명칭 오용 + transient 상태라 제거. trustOf 분기에서도 'estimated'가 사라졌다.
 */
export function modelChipHtml(r, opts = {}) {
  const cls     = modelClassOf(r?.model);
  const label   = modelChipLabel(r?.model, cls);
  const title   = r?.model || '모델 정보 없음';
  const sizeCls = opts.mini ? ' model-chip-mini' : '';
  return `<span class="model-chip model-chip-${cls}${sizeCls}" title="${escHtml(title)}">${escHtml(label)}</span>`;
}

export function makeModelCell(r) {
  // 모든 타입에서 model을 표시. model이 없으면 "—".
  // (이전: tool_call/system은 무조건 "—" 처리 → 사용자가 LLM 모델을 알 수 없음)
  if (!r?.model) {
    return `<td class="cell-model cell-empty">—</td>`;
  }
  return `<td class="cell-model">${modelChipHtml(r)}</td>`;
}

/**
 * row trust 클래스 — synthetic / unknown 행에만 ' row-trust-{name}' 클래스 부여.
 *
 * 책임:
 *   makeRequestRow의 <tr> 클래스 결정. 비정상 신뢰도 행만 시각 dim 처리.
 *
 * 호출자:
 *   - makeRequestRow (단일 호출 지점)
 *
 * 의존성:
 *   - trustOf — 신뢰도 분류
 *
 * 분기:
 *   - tool_call / system: model 무의미 → dim 적용 안 함
 *   - trusted / external: 정상 → dim 적용 안 함
 *   - synthetic / unknown: ' row-trust-{name}' 클래스 부여
 *
 * 'estimated' 분기는 ADR-token-trust-cleanup-001로 제거됨.
 */
function rowTrustClass(r) {
  if (r.type === 'tool_call' || r.type === 'system') return '';
  const t = trustOf(r);
  if (t === 'trusted' || t === 'external') return '';
  return ` row-trust-${t}`;
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
          : ti.args;
        return text || null;
      } catch {}
      return r.tool_name === 'Agent' ? (r.tool_detail || null) : null;
    }
    return r.tool_detail || null;
  }
  if (r.type === 'prompt')   return extractPromptText(r) || null;
  if (r.type === 'response') return extractAssistantText(r) || null;
  if (r.type === 'system')   return extractPromptText(r) || null;
  return null;
}

// 클릭 확장 시 보여줄 상세 텍스트 — preview와 별도로 관리
function getDetailText(r) {
  if (!r) return null;
  if (r.type === 'tool_call') {
    try {
      const p  = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
      const ti = p?.tool_input || {};
      if (r.tool_name === 'Agent') {
        return ti.prompt || ti.description || r.tool_detail || null;
      }
      if (r.tool_name === 'Skill') {
        return ti.args || r.tool_detail || null;
      }
      if (r.tool_name === 'Bash') {
        return ti.command || r.tool_detail || null;
      }
      if (['Read', 'Edit', 'Write', 'MultiEdit'].includes(r.tool_name)) {
        return ti.file_path || r.tool_detail || null;
      }
      if (r.tool_name === 'Grep') {
        const parts = [ti.pattern, ti.path ? `in ${ti.path}` : null].filter(Boolean);
        return parts.join(' ') || r.tool_detail || null;
      }
      if (r.tool_name === 'Glob') {
        const parts = [ti.pattern, ti.path ? `in ${ti.path}` : null].filter(Boolean);
        return parts.join(' ') || r.tool_detail || null;
      }
      if (r.tool_name?.startsWith('mcp__')) {
        const keys = Object.keys(ti);
        if (keys.length > 0) return JSON.stringify(ti, null, 2);
      }
    } catch {}
    return r.tool_detail || null;
  }
  if (r.type === 'prompt' || r.type === 'system') return extractPromptText(r) || null;
  if (r.type === 'response') return extractAssistantText(r) || null;
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
  // payload 우선: 원본 전체 텍스트 추출 (DB preview는 최대 2000자로 저장되나 payload는 무제한)
  if (r.payload) {
    try {
      const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
      const fromPayload = p?.prompt ?? p?.content ?? p?.tool_input ?? (typeof p === 'string' ? p : '');
      if (fromPayload && typeof fromPayload === 'string' && fromPayload.trim()) return fromPayload;
    } catch { /* 파싱 실패 시 fallback */ }
  }
  // fallback: DB에 저장된 preview (payload 파싱 실패 또는 prompt 필드 없을 때)
  if (r.preview && typeof r.preview === 'string' && r.preview.trim()) return r.preview;
  return '';
}

// type='response' 행의 본문 추출 — Stop 훅의 last_assistant_message
// payload 우선, preview fallback (extractPromptText와 같은 패턴)
export function extractAssistantText(r) {
  if (r.payload) {
    try {
      const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
      const fromPayload = p?.last_assistant_message ?? p?.preview ?? '';
      if (fromPayload && typeof fromPayload === 'string' && fromPayload.trim()) return fromPayload;
    } catch { /* 파싱 실패 시 fallback */ }
  }
  if (r.preview && typeof r.preview === 'string' && r.preview.trim()) return r.preview;
  return '';
}

export function contextPreview(r, maxLen = 60) {
  const rawText = getContextText(r);
  if (!rawText) return '';
  if (_promptCache.size >= PROMPT_CACHE_MAX) {
    _promptCache.delete(_promptCache.keys().next().value);
  }
  const detailText = getDetailText(r) || rawText;
  _promptCache.set(r.id, detailText);
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
  const text    = _promptCache.get(rid) || '';
  const boxHtml = `<div class="prompt-expand-box"><button class="expand-copy-btn" onclick="navigator.clipboard.writeText(this.nextElementSibling.textContent).then(()=>{this.textContent='✓복사됨';setTimeout(()=>{this.textContent='복사'},1500)})">복사</button><pre style="margin:0;white-space:pre-wrap;word-break:break-all">${escHtml(text)}</pre></div>`;
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

function anomalyBadgesHtml(flags) {
  if (!flags || flags.size === 0) return '';
  return [...flags].map(f => `<span class="mini-badge badge-${f}" data-mini-badge-tooltip="${f}">${f}</span>`).join('');
}


export function makeRequestRow(r, opts = {}) {
  const fmtTs  = opts.fmtTime || fmtTimestamp;
  const flags  = opts.anomalyFlags || null;
  const sessTd = opts.showSession
    ? `<td class="cell-sess"><span class="sess-id sess-id-link" data-goto-session="${escHtml(r.session_id||'')}" data-goto-project="${escHtml(r.project_name||'')}" title="${escHtml(r.session_id||'')}">${r.session_id ? r.session_id.slice(0,12)+'…' : '—'}</span></td>`
    : '';
  const msgPreview = contextPreview(r);
  const msgHtml    = msgPreview
    ? msgPreview
    : `<span class="cell-msg-empty" aria-label="메시지 없음">—</span>`;

  const spikeLoopBadges = flags ? anomalyBadgesHtml(new Set([...flags].filter(f => f !== 'slow'))) : '';
  const slowBadge       = flags && flags.has('slow') ? `<span class="mini-badge badge-slow" data-mini-badge-tooltip="slow">slow</span>` : '';

  const trustCls = rowTrustClass(r);
  return `<tr class="${trustCls.trim()}" data-type="${escHtml(r.type||'')}" data-sub-type="${subTypeOf(r)}" data-trust="${trustOf(r)}" data-request-id="${escHtml(r.id||'')}">
    <td class="cell-time num">${fmtTs(r.timestamp)}</td>
    <td class="cell-action">${makeActionCell(r)}</td>
    ${makeTargetCellWithBadges(r, spikeLoopBadges)}
    ${makeModelCell(r)}
    <td class="cell-msg">${msgHtml}</td>
    <td class="cell-token num">${r.tokens_input  > 0 ? fmtToken(r.tokens_input)  : '—'}</td>
    <td class="cell-token num">${r.tokens_output > 0 ? fmtToken(r.tokens_output) : '—'}</td>
    ${makeCacheCell(r)}
    <td class="cell-token num">${formatDuration(r.duration_ms)}${slowBadge}</td>
    ${sessTd}
  </tr>`;
}

function makeTargetCellWithBadges(r, extraBadges) {
  if (!extraBadges) return makeTargetCell(r);
  const base = makeTargetCell(r);
  // </td> 직전에 배지 삽입
  return base.replace(/<\/td>$/, `${extraBadges}</td>`);
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

export function renderRequests(container, list, anomalyMap = new Map()) {
  if (!list.length) {
    container.innerHTML = `<tr><td colspan="${RECENT_REQ_COLS}" class="table-empty">데이터가 없습니다</td></tr>`;
    return;
  }
  container.innerHTML = list.map(r => makeRequestRow(r, { showSession: true, anomalyFlags: anomalyMap.get(r.id) || null })).join('');
}

export function appendRequests(container, list, anomalyMap = new Map()) {
  if (!list.length) return;
  container.insertAdjacentHTML('beforeend', list.map(r => makeRequestRow(r, { showSession: true, anomalyFlags: anomalyMap.get(r.id) || null })).join(''));
}
