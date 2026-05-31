/**
 * features/llm-input/llm-input-state.ts — 아코디언 상태 전이 순수 로직 SSoT (P3-08)
 *
 * 원본: assets/js/llm-input-view.js 의 명령형 상태(`state.expandedMessages: Set`,
 * `state.currentSearch`) + DOM-변이 핸들러를 선언적 순수 함수로 정제.
 *
 * 정제 원칙(명령형 → 선언적):
 *  - 원본은 `details.open` 을 직접 set 하고 Set 을 mutate 했다(setAllExpanded:761-770,
 *    applySearchHighlight:793-827, onAccordionChange:553-570). 본 모듈은 동일한 동작 계약을
 *    **불변(immutable) 전이 함수**로 표현 — LLMInput.tsx 의 useState 핸들러가 이 함수를 호출한다
 *    (컴포넌트는 전이 로직을 재구현하지 않는다).
 *  - 키 규약은 원본과 동일하게 `m-${index}` (renderMessageDetails:466).
 *
 * @module features/llm-input/llm-input-state
 */

/** 메시지 summary 미리보기 길이 (원본 SUMMARY_PREVIEW_LEN:42 — 처음 100자). */
export const SUMMARY_PREVIEW_LEN = 100;

/** 검색 매칭 최소 길이 (원본 SEARCH_MIN_LEN:45 — 너무 짧은 입력으로 전체 펼침 방지). */
export const SEARCH_MIN_LEN = 2;

/** content part 의 느슨한 형태(text 파트 + tool_use/tool_result 등). */
export interface ContentPart {
  type?: string;
  text?: string;
  [k: string]: unknown;
}

/** LLM 입력 메시지(role + content). 원본 messages 배열 요소와 동일 느슨한 형태. */
export interface MessageLike {
  role?: string;
  content?: string | ContentPart[] | unknown;
  [k: string]: unknown;
}

/** 메시지 id 별 펼침 상태 맵(원본 expandedMessages Set 의 선언적 대응). */
export type ExpandedMap = Record<string, boolean>;

/** index → 메시지 id (원본 renderMessageDetails `m-${i}`). */
export function messageId(index: number): string {
  return `m-${index}`;
}

/**
 * 페이지 로드 시 초기 펼침 상태 — system role 만 true(원본 renderMessageDetails:467-468,
 * isSystem → `<details open>` + expandedMessages.add).
 */
export function initialExpanded(messages: MessageLike[]): ExpandedMap {
  const map: ExpandedMap = {};
  messages.forEach((m, i) => {
    map[messageId(i)] = String(m?.role ?? '') === 'system';
  });
  return map;
}

/**
 * 개별 메시지 토글 — 불변 갱신(원본 onAccordionChange:565-569 add/delete).
 */
export function toggleExpanded(state: ExpandedMap, id: string, open: boolean): ExpandedMap {
  return { ...state, [id]: open };
}

/**
 * 전체 펼침/접기 — system 포함 모든 메시지(원본 setAllExpanded:760-770 정책:
 * "전체 접기는 시스템 메시지도 함께 접는다").
 */
export function setAllExpanded(messages: MessageLike[], open: boolean): ExpandedMap {
  const map: ExpandedMap = {};
  messages.forEach((_m, i) => {
    map[messageId(i)] = open;
  });
  return map;
}

/**
 * 검색어 적용 시 펼침 상태 전이(원본 applySearchHighlight:793-827).
 *
 * 정책 1:1:
 *  - term.length < SEARCH_MIN_LEN: open 상태 불변(원본 "짧은 입력은 highlight 제거만, open 보존").
 *  - 매칭 메시지: open = true 로 add(원본 d.open=true + expandedMessages.add).
 *  - 미매칭 메시지: 이전 상태 보존(원본 "open 상태 변경 없음").
 */
export function applySearchExpansion(
  state: ExpandedMap,
  messages: MessageLike[],
  term: string,
): ExpandedMap {
  const t = String(term ?? '').trim();
  if (t.length < SEARCH_MIN_LEN) return state; // 짧은 입력 → 불변(open 보존)
  const needle = t.toLowerCase();
  const next: ExpandedMap = { ...state };
  messages.forEach((m, i) => {
    if (messageHaystack(m).includes(needle)) {
      next[messageId(i)] = true; // 매칭 → 펼침(additive)
    }
    // 미매칭: next 에 손대지 않음 → 이전 상태 보존
  });
  return next;
}

/**
 * content 미리보기 텍스트(원본 previewFromContent:493-511).
 * string 은 그대로, array 는 text 파트 join(비-text 는 `[type]` 라벨), 100자 초과 ellipsis.
 */
export function previewFromContent(content: unknown): string {
  let raw = '';
  if (typeof content === 'string') {
    raw = content;
  } else if (Array.isArray(content)) {
    raw = content
      .map((part) => {
        if (!part || typeof part !== 'object') return '';
        const p = part as ContentPart;
        if (p.type === 'text' && typeof p.text === 'string') return p.text;
        return `[${String(p.type ?? 'part')}]`;
      })
      .filter(Boolean)
      .join(' ');
  }
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (flat.length <= SUMMARY_PREVIEW_LEN) return flat || '(empty)';
  return flat.slice(0, SUMMARY_PREVIEW_LEN) + '…';
}

/**
 * content 의 평탄화 본문 텍스트 — 검색 매칭/하이라이트 대상.
 * array 는 text 파트만 join(원본 applySearchHighlight 가 body.textContent 로 매칭한 것의 선언적 대응).
 */
export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') return '';
        const p = part as ContentPart;
        if (p.type === 'text' && typeof p.text === 'string') return p.text;
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

/**
 * 검색 매칭용 haystack — preview + 본문 텍스트(소문자). 원본은 dataset.messagePreview 와
 * body.textContent 둘 다 검사(applySearchHighlight:813-816); 그 합집합을 선언적으로 합성.
 */
export function messageHaystack(m: MessageLike): string {
  const preview = previewFromContent(m?.content);
  const body = contentText(m?.content);
  return `${preview} ${body}`.toLowerCase();
}

/** 바이트 포맷(원본 formatBytes:893-898). */
export function formatBytes(n: number): string {
  if (typeof n !== 'number' || !isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** 하이라이트 분절 결과 한 조각. */
export interface HighlightSegment {
  text: string;
  mark: boolean;
}

/**
 * 텍스트를 검색어 기준으로 분절 — 선언적 하이라이트(원본 highlightTextNodes:833-872 의
 * TreeWalker DOM-변이를 데이터 변환으로 대체). 대소문자 무시 매칭, 원문 대소문자 보존.
 * term 이 비었거나 < SEARCH_MIN_LEN 이면 단일 비-mark 세그먼트(하이라이트 없음).
 */
export function splitHighlight(text: string, term: string): HighlightSegment[] {
  const t = String(term ?? '').trim();
  if (!text || t.length < SEARCH_MIN_LEN) return [{ text, mark: false }];
  const needle = t.toLowerCase();
  const lower = text.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  let idx = lower.indexOf(needle);
  while (idx !== -1) {
    if (idx > cursor) segments.push({ text: text.slice(cursor, idx), mark: false });
    segments.push({ text: text.slice(idx, idx + t.length), mark: true });
    cursor = idx + t.length;
    idx = lower.indexOf(needle, cursor);
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), mark: false });
  return segments.length ? segments : [{ text, mark: false }];
}
