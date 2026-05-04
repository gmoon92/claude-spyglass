// payload·preview에서 표시 텍스트 추출 + 펼침 캐시.
//
// 변경 이유: payload 스키마 / preview 추출 정책 / AskUserQuestion 시각화 정책 변경 시 묶여서 손이 가는 묶음.
//
// 외부 노출: _promptCache (turn-views.js), contextPreview/extractPromptText/extractAssistantText/extractFirstPrompt/parseToolDetail (turn-rows·flat-view).

import { escHtml } from '../formatters.js';
import { toolResponseHint } from './badges.js';

const PROMPT_CACHE_MAX = 500;
export const _promptCache = new Map(); // export: togglePromptExpand 공유

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

/**
 * 클릭 확장 시 보여줄 상세 컨텐츠 — preview와 별도로 관리.
 *
 * 반환 형태:
 *  - string                          → 텍스트 모드 (기본). togglePromptExpand가 escHtml + <pre>로 렌더.
 *  - { kind: 'html', html: string }  → HTML 모드. togglePromptExpand가 escapeHtml 우회.
 *  - null                            → 펼칠 컨텐츠 없음.
 *
 * AskUserQuestion만 HTML 모드 — payload.tool_input의 questions/options/answers를
 * 구조화 카드로 시각화한다 (web-design-balance-pass ADR-004).
 * 다른 도구는 모두 텍스트 모드 유지 (회귀 안전).
 */
function getDetailText(r) {
  if (!r) return null;
  if (r.type === 'tool_call') {
    try {
      const p  = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
      const ti = p?.tool_input || {};
      if (r.tool_name === 'AskUserQuestion') {
        const html = buildAskUserQuestionHtml(ti);
        if (html) return { kind: 'html', html };
        // payload 파싱 실패 시 tool_detail 텍스트로 폴백.
        return r.tool_detail || null;
      }
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

/**
 * AskUserQuestion payload(tool_input)를 받아 펼침 영역에 표시할 풍부 HTML을 만든다.
 *
 * 입력 스키마:
 *   {
 *     questions: [
 *       { question: string, header?: string, multiSelect?: boolean,
 *         options: [{ label: string, description?: string }, ...] }
 *     ],
 *     answers?: { [questionText]: string }   // 사용자가 실제 선택한 label (PostToolUse에만 존재)
 *   }
 *
 * 책임 단일화: 호출자는 "AskUserQuestion이면 이 함수를 부른다"만 담당.
 * 옵션 selected 판단·multiSelect 마커·description hover 등 모든 표현은 이 함수 내부에 캡슐화.
 *
 * @param {object} toolInput   payload.tool_input 객체.
 * @returns {string|null}      HTML 문자열 또는 questions가 비어있으면 null.
 */
function buildAskUserQuestionHtml(toolInput) {
  const questions = Array.isArray(toolInput?.questions) ? toolInput.questions : null;
  if (!questions || questions.length === 0) return null;
  const answers = (toolInput && typeof toolInput.answers === 'object' && toolInput.answers) || {};

  const blocks = questions.map(q => {
    const qText  = typeof q?.question === 'string' ? q.question : '';
    const header = typeof q?.header   === 'string' ? q.header   : '';
    const multi  = !!q?.multiSelect;
    const opts   = Array.isArray(q?.options) ? q.options : [];

    // answers는 question 텍스트를 키로, 선택된 label을 값으로 매핑.
    // multiSelect가 true면 콤마/세미콜론 구분 문자열로 저장될 수 있어 두 형태 모두 허용.
    const rawAnswer = answers[qText];
    const selectedSet = new Set();
    if (typeof rawAnswer === 'string' && rawAnswer.length > 0) {
      // 단일 답이라도 split 결과의 첫 원소만 들어가므로 세트 처리에 안전.
      rawAnswer.split(/\s*[,;]\s*/).forEach(v => { if (v) selectedSet.add(v); });
    } else if (Array.isArray(rawAnswer)) {
      rawAnswer.forEach(v => { if (typeof v === 'string') selectedSet.add(v); });
    }

    const optsHtml = opts.map(opt => {
      const label    = typeof opt?.label       === 'string' ? opt.label       : '';
      const desc     = typeof opt?.description === 'string' ? opt.description : '';
      const selected = selectedSet.has(label);
      // marker: 선택됨 ✓ / multiSelect는 □ / 단일은 ○
      let marker = multi ? '☐' : '○';
      if (selected) marker = multi ? '☑' : '●';
      const cls = ['askq-option'];
      if (selected) cls.push('askq-option-selected');
      if (multi)    cls.push('askq-option-multi');
      const titleAttr = desc ? ` title="${escHtml(desc)}"` : '';
      const descHtml  = desc ? `<span class="askq-option-desc">${escHtml(desc)}</span>` : '';
      return `<li class="${cls.join(' ')}"${titleAttr}>` +
        `<span class="askq-option-marker" aria-hidden="true">${marker}</span>` +
        `<span class="askq-option-label">${escHtml(label)}</span>` +
        descHtml +
      `</li>`;
    }).join('');

    const headerHtml = header ? `<span class="askq-header">${escHtml(header)}</span>` : '';
    const multiHint  = multi  ? ' <span class="askq-multi-hint">(multi-select)</span>' : '';

    return `<div class="askq-q">
      <div class="askq-q-head">${headerHtml}<span class="askq-question">${escHtml(qText)}</span>${multiHint}</div>
      ${optsHtml ? `<ul class="askq-options">${optsHtml}</ul>` : ''}
    </div>`;
  }).join('');

  return `<div class="askq-block">${blocks}</div>`;
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
