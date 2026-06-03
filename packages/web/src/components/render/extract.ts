// @ts-check
// payload·preview에서 표시 텍스트 추출 + 펼침 캐시.
//
// 변경 이유: payload 스키마 / preview 추출 정책 / AskUserQuestion 시각화 정책 변경 시 묶여서 손이 가는 묶음.
//
// 외부 노출: _promptCache (turn-views.js), contextPreview/extractPromptText/extractAssistantText/extractFirstPrompt/parseToolDetail (turn-rows·flat-view).

import { toolResponseHintKey, type ToolHint } from '../../lib/tool-response-field';
import type { RowTextReader } from '../../../assets/js/view-types.js';

const PROMPT_CACHE_MAX = 500;
export const _promptCache = new Map<string, ExpandContent>(); // export: togglePromptExpand 공유

/** AskUserQuestion 옵션 — 라벨/설명/선택 여부/multi 마커. */
export interface AskOption {
  label: string;
  desc: string;
  selected: boolean;
  multi: boolean;
}

/** AskUserQuestion 질문 블록 — 헤더/질문/multi/옵션. */
export interface AskQuestion {
  header: string;
  question: string;
  multi: boolean;
  options: AskOption[];
}

/**
 * 펼침 캐시/getDetailText 반환 — 텍스트 모드 또는 AskUserQuestion 구조화 모드.
 * (B-2) 과거 { kind:'html', html } 문자열 모드는 구조화 { kind:'askq', questions } 로 대체 —
 *   PromptExpandRow 가 dangerouslySetInnerHTML 대신 AskUserQuestionCard(JSX) 로 렌더.
 */
type ExpandContent = string | { kind: 'askq'; questions: AskQuestion[] };

/** JSON.parse 결과를 읽기 전용 record 로 안전 취급(필드는 unknown). any 누출 방지. */
type JsonRecord = Record<string, unknown>;

/** payload 문자열/객체를 record 로 파싱(실패/비객체는 null). */
function parsePayload(payload: unknown): JsonRecord | null {
  try {
    const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
    return p && typeof p === 'object' ? (p as JsonRecord) : null;
  } catch { return null; }
}

/** record 필드를 문자열로만 안전 추출(비문자열은 null). */
function strOf(o: JsonRecord | null, key: string): string | null {
  const v = o?.[key];
  return typeof v === 'string' ? v : null;
}

/**
 * payload 를 파싱하여 tool_input record 를 반환. 기존 `(JSON.parse(payload)).tool_input || {}` 와 동치이되,
 * 파싱/비객체 실패 시 null 을 반환해 호출부가 폴백하도록 한다(기존 try/catch → tool_detail 폴백과 동일).
 */
function parsePayloadToolInput(payload: unknown): JsonRecord | null {
  const p = parsePayload(payload);
  if (!p) return null;
  const ti = p.tool_input;
  return ti && typeof ti === 'object' ? (ti as JsonRecord) : {};
}

/**
 * 본문 텍스트 추출 — 기존 `JSON.parse(payload)` 후 `keys ?? (parsed가 string이면 그 string)` 와 1:1.
 * 파싱 실패(throw)는 null(원문 미채택 → preview 폴백). parsed 가 string 이면 그 자체가 본문.
 */
function parsePayloadText(payload: unknown, keys: string[]): string | null {
  let parsed: unknown;
  try {
    parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  } catch {
    return null; // 비 JSON 문자열 → 기존엔 throw 로 preview 폴백
  }
  if (parsed && typeof parsed === 'object') {
    const o = parsed as JsonRecord;
    for (const k of keys) {
      const v = o[k];
      if (typeof v === 'string') return v; // 첫 string 필드 채택(객체 tool_input 은 건너뜀 = 기존 동치)
    }
    return null;
  }
  // parsed 가 원시 string(payload 가 JSON 인코딩된 문자열)인 경우 — 기존 `?? (typeof p==='string'? p)`.
  return typeof parsed === 'string' ? parsed : null;
}

export function getContextText(r: RowTextReader) {
  if (!r) return null;
  if (r.type === 'tool_call') {
    if (r.tool_name === 'Agent' || r.tool_name === 'Skill') {
      const ti = parsePayloadToolInput(r.payload);
      if (ti) {
        // Skill은 args(실제 요청 내용)를 우선 노출 — TARGET 컬럼이 이미 skill 이름을 보여주므로
        // MESSAGE에 이름을 반복하지 않는다. args 없을 때만 tool_detail(=skill 이름)으로 폴백.
        const text = r.tool_name === 'Agent'
          ? (strOf(ti, 'description') || strOf(ti, 'prompt') || r.tool_detail)
          : (strOf(ti, 'args') || r.tool_detail || strOf(ti, 'skill'));
        return text || null;
      }
      return r.tool_detail || null;
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
function getDetailText(r: RowTextReader | null | undefined): ExpandContent | null {
  if (!r) return null;
  if (r.type === 'tool_call') {
    const ti = parsePayloadToolInput(r.payload);
    if (ti) {
      const tn = r.tool_name;
      if (tn === 'AskUserQuestion') {
        const questions = parseAskUserQuestion(ti);
        if (questions) return { kind: 'askq', questions };
        // payload 파싱 실패 시 tool_detail 텍스트로 폴백.
        return r.tool_detail || null;
      }
      if (tn === 'Agent') {
        return strOf(ti, 'prompt') || strOf(ti, 'description') || r.tool_detail || null;
      }
      if (tn === 'Skill') {
        // preview(getContextText)와 동일 우선순위 — args(실제 요청 내용) 우선, 없으면 skill 이름 폴백.
        return strOf(ti, 'args') || r.tool_detail || strOf(ti, 'skill') || null;
      }
      if (tn === 'Bash') {
        return strOf(ti, 'command') || r.tool_detail || null;
      }
      if (tn && ['Read', 'Edit', 'Write', 'MultiEdit'].includes(tn)) {
        return strOf(ti, 'file_path') || r.tool_detail || null;
      }
      if (tn === 'Grep' || tn === 'Glob') {
        const path = strOf(ti, 'path');
        const parts = [strOf(ti, 'pattern'), path ? `in ${path}` : null].filter(Boolean);
        return parts.join(' ') || r.tool_detail || null;
      }
      if (tn?.startsWith('mcp__')) {
        if (Object.keys(ti).length > 0) return JSON.stringify(ti, null, 2);
      }
      // ADR-001 P1 (UX): Task*/SendMessage/Web* 등은 subject·summary만 tool_detail로 들어와
      // 펼침이 행 미리보기와 동일해진다. payload.tool_input의 풍부한 필드를 합쳐 노출.
      if (tn === 'TaskCreate') {
        const subject = strOf(ti, 'subject');
        const activeForm = strOf(ti, 'activeForm');
        const description = strOf(ti, 'description');
        const lines = [
          subject ? `Subject: ${subject}` : null,
          activeForm ? `Active form: ${activeForm}` : null,
          description ? `\nDescription:\n${description}` : null,
        ].filter(Boolean);
        return lines.length > 0 ? lines.join('\n') : (r.tool_detail || null);
      }
      if (tn === 'TaskUpdate') {
        const fields = ['status', 'subject', 'description', 'activeForm', 'owner']
          .filter((k) => ti[k] != null)
          .map((k) => `${k}: ${typeof ti[k] === 'string' ? (ti[k] as string) : JSON.stringify(ti[k])}`);
        const head = ti.taskId != null ? `Task #${String(ti.taskId)}` : 'TaskUpdate';
        return [head, ...fields].join('\n') || (r.tool_detail || null);
      }
      if (tn === 'SendMessage') {
        const to = strOf(ti, 'to');
        const summary = strOf(ti, 'summary');
        const head = to ? `→ ${to}` : 'SendMessage';
        const msg = ti.message;
        const body = typeof msg === 'string'
          ? `\nMessage:\n${msg}`
          : (msg ? `\nMessage:\n${JSON.stringify(msg, null, 2)}` : null);
        const out = [head, summary ? `Summary: ${summary}` : null, body].filter(Boolean).join('\n');
        return out || (r.tool_detail || null);
      }
      if (tn === 'WebFetch') {
        const url = strOf(ti, 'url');
        const prompt = strOf(ti, 'prompt');
        const out = [
          url ? `URL: ${url}` : null,
          prompt ? `\nPrompt:\n${prompt}` : null,
        ].filter(Boolean).join('\n');
        return out || (r.tool_detail || null);
      }
      if (tn === 'WebSearch') {
        const query = strOf(ti, 'query');
        const allowed = ti.allowed_domains;
        const blocked = ti.blocked_domains;
        const out = [
          query ? `Query: ${query}` : null,
          Array.isArray(allowed) && allowed.length ? `Allowed: ${allowed.join(', ')}` : null,
          Array.isArray(blocked) && blocked.length ? `Blocked: ${blocked.join(', ')}` : null,
        ].filter(Boolean).join('\n');
        return out || (r.tool_detail || null);
      }
    }
    return r.tool_detail || null;
  }
  if (r.type === 'prompt' || r.type === 'system') return extractPromptText(r) || null;
  if (r.type === 'response') return extractAssistantText(r) || null;
  return null;
}

/**
 * AskUserQuestion payload(tool_input)를 받아 구조화 질문 모델로 파싱한다(B-2: HTML 미생성).
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
 * 책임 단일화: 옵션 selected 판단·multiSelect 마커·description 노출 정책은 이 파서가 SSoT.
 * 마크업은 AskUserQuestionCard(JSX)가 이 모델을 받아 렌더한다.
 *
 * @param toolInput payload.tool_input 객체.
 * @returns 질문 배열 또는 questions 가 비어있으면 null.
 */
export function parseAskUserQuestion(toolInput: JsonRecord | null): AskQuestion[] | null {
  const questions = Array.isArray(toolInput?.questions) ? toolInput.questions : null;
  if (!questions || questions.length === 0) return null;
  const answersRaw = toolInput?.answers;
  const answers: Record<string, unknown> =
    answersRaw && typeof answersRaw === 'object' ? (answersRaw as Record<string, unknown>) : {};

  return questions.map((q: unknown): AskQuestion => {
    const qo = (q && typeof q === 'object' ? q : {}) as JsonRecord;
    const qText = typeof qo.question === 'string' ? qo.question : '';
    const header = typeof qo.header === 'string' ? qo.header : '';
    const multi = !!qo.multiSelect;
    const opts = Array.isArray(qo.options) ? qo.options : [];

    // answers는 question 텍스트를 키로, 선택된 label을 값으로 매핑.
    // multiSelect가 true면 콤마/세미콜론 구분 문자열로 저장될 수 있어 두 형태 모두 허용.
    const rawAnswer = answers[qText];
    const selectedSet = new Set<string>();
    if (typeof rawAnswer === 'string' && rawAnswer.length > 0) {
      rawAnswer.split(/\s*[,;]\s*/).forEach((v) => { if (v) selectedSet.add(v); });
    } else if (Array.isArray(rawAnswer)) {
      rawAnswer.forEach((v) => { if (typeof v === 'string') selectedSet.add(v); });
    }

    const options: AskOption[] = opts.map((opt: unknown): AskOption => {
      const oo = (opt && typeof opt === 'object' ? opt : {}) as JsonRecord;
      const label = typeof oo.label === 'string' ? oo.label : '';
      const desc = typeof oo.description === 'string' ? oo.description : '';
      return { label, desc, selected: selectedSet.has(label), multi };
    });

    return { header, question: qText, multi, options };
  });
}

export function parseToolDetail(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return Object.entries(obj).slice(0, 3)
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(' · ');
      }
    } catch { /* JSON 아님 → key=value 라인 파싱 시도 */ }
    const lines = raw.split('\n').filter((l) => /^\w[\w\s]*=/.test(l.trim()));
    if (lines.length) return lines.slice(0, 3).map((l) => l.trim()).join(' · ');
    return raw;
  }
  // 비문자열 raw(객체 등): 기존엔 JSON.parse 가 throw → 그대로 반환했다. 동치로 String 화.
  return typeof raw === 'string' ? raw : String(raw);
}

export function extractPromptText(r: RowTextReader) {
  // payload 우선: 원본 전체 텍스트 추출 (DB preview는 최대 2000자로 저장되나 payload는 무제한)
  if (r.payload) {
    // 기존: JSON.parse 후 prompt ?? content ?? tool_input ?? (parsed가 string이면 그 string).
    //   파싱 실패(비 JSON 문자열)는 throw → preview 폴백(원문 미채택)이었다. parsePrimary 로 1:1 보존.
    const fromPayload = parsePayloadText(r.payload, ['prompt', 'content', 'tool_input']);
    if (fromPayload && fromPayload.trim()) return fromPayload;
  }
  // fallback: DB에 저장된 preview (payload 파싱 실패 또는 prompt 필드 없을 때)
  if (r.preview && typeof r.preview === 'string' && r.preview.trim()) return r.preview;
  return '';
}

// type='response' 행의 본문 추출 — Stop 훅의 last_assistant_message
// payload 우선, preview fallback (extractPromptText와 같은 패턴)
export function extractAssistantText(r: RowTextReader) {
  if (r.payload) {
    const p = parsePayload(r.payload);
    const fromPayload = strOf(p, 'last_assistant_message') ?? strOf(p, 'preview');
    if (fromPayload && fromPayload.trim()) return fromPayload;
  }
  if (r.preview && typeof r.preview === 'string' && r.preview.trim()) return r.preview;
  return '';
}

/**
 * context preview 구조화 데이터 — 원본 contextPreview 의 텍스트/툴팁/힌트 계산 1:1.
 * 반환 데이터를 ContextPreview(React) 가 JSX 로 렌더한다(B-2: HTML 문자열·dangerouslySetInnerHTML 제거).
 *
 * 부수효과(SSoT 보존): 원본과 동일하게 _promptCache 를 채운다(PromptExpandRow 가 읽음).
 * i18n: 힌트는 키+vars(ToolHint), 툴팁 char-count 도 키+vars(라벨 해석은 컴포넌트의 t).
 *
 * @returns null  표시할 텍스트 없으면(원본 빈 문자열) — 호출 측이 cell-msg-empty 렌더.
 */
export interface ContextPreviewData {
  /** data-expand-id (r.id). */
  expandId: string;
  /** 표시 텍스트(maxLen slice, 개행 평탄화). */
  display: string;
  /** maxLen 초과로 '…' 말줄임 여부. */
  ellipsis: boolean;
  /** title 본문(≤200 은 rawText 그대로). truncated 면 컴포넌트가 char-count 라벨을 붙인다. */
  tooltipBase: string;
  /** title 가 200자 초과로 잘렸는지 — true 면 char-count 서픽스 필요. */
  tooltipTruncated: boolean;
  /** char-count 서픽스용 원문 전체 길이(toLocaleString 은 컴포넌트가 적용). */
  rawLength: number;
  /** tool_call 결과 힌트 i18n 지시(없으면 null). 원본은 tool_call 타입에만 부여. */
  hint: ToolHint | null;
}

export function contextPreviewData(r: RowTextReader, maxLen = 60): ContextPreviewData | null {
  const rawText = getContextText(r);
  if (!rawText) return null;
  if (_promptCache.size >= PROMPT_CACHE_MAX) {
    const oldest = _promptCache.keys().next().value;
    if (oldest !== undefined) _promptCache.delete(oldest);
  }
  const detailText = getDetailText(r) || rawText;
  _promptCache.set(r.id ?? '', detailText);
  const displayText = r.type === 'tool_call'
    ? (parseToolDetail(rawText) ?? rawText)
    : rawText;
  const flat    = displayText.replace(/\n/g, ' ');
  const display = flat.slice(0, maxLen);
  const tooltipTruncated = rawText.length > 200;
  const tooltipBase = tooltipTruncated ? rawText.slice(0, 200) : rawText;
  // tool_call 타입에만 힌트 서픽스 추가 (maxLen 초과해도 힌트는 잘리지 않음)
  const hint = r.type === 'tool_call' ? toolResponseHintKey(r) : null;
  return {
    expandId: r.id ?? '',
    display,
    ellipsis: flat.length > maxLen,
    tooltipBase,
    tooltipTruncated,
    rawLength: rawText.length,
    hint,
  };
}

export function extractFirstPrompt(payload: unknown) {
  if (!payload) return '';
  function clean(text: string) {
    return text.replace(/<[^>]+>/g, '').replace(/[\n\r]+/g, ' ').trim().slice(0, 60);
  }
  try {
    const p    = typeof payload === 'string' ? JSON.parse(payload) : payload;
    let text = '';
    if (p && typeof p === 'object') {
      const o = p as JsonRecord;
      text = (strOf(o, 'preview') ?? strOf(o, 'prompt') ?? strOf(o, 'content')) ?? '';
    } else if (typeof p === 'string') {
      text = p;
    }
    return text ? clean(text) : '';
  } catch {
    const m = typeof payload === 'string' && payload.match(/"prompt"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) return clean(m[1].replace(/\\n/g, ' '));
    return '';
  }
}
