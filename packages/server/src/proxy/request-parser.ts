/**
 * proxy 모듈 — 요청 본문 파싱 (RequestMeta 추출)
 *
 * 책임:
 *  - 클라이언트가 /v1/messages로 보낸 JSON 본문에서 DB·감사용 메타를 추출.
 *  - 응답이 도착하기 전에 한 번에 파싱 (헤더 단계).
 *
 * 추출 필드:
 *  기본 (v15~):
 *    - model, max_tokens, stream, messages.length, tools.length, last user message preview
 *  v20 감사 추가:
 *    - thinking.type   : extended thinking 모드 ('adaptive' 등)
 *    - temperature     : 샘플링 다양성
 *    - system          : 첫 200자 (변경 추적)
 *    - tools[].name    : JSON array string (어떤 도구가 컨텍스트에 노출됐는지)
 *    - metadata.user_id: Anthropic 측 디바이스/계정 식별자
 *
 * 외부 노출: parseRequestBody(buffer)
 * 호출자: handler.ts (요청 진입 직후)
 * 의존성: types
 */

import type { RequestMeta } from './types';

/**
 * 요청 본문 ArrayBuffer를 파싱하여 RequestMeta로 반환.
 *
 * 본문이 비었거나 JSON 파싱 실패 시 모든 필드 null/0의 기본값 반환 (예외 던지지 않음).
 */
export function parseRequestBody(buffer: ArrayBuffer): RequestMeta {
  const meta: RequestMeta = {
    model: null, messagesCount: 0, maxTokens: null,
    toolsCount: 0, requestPreview: null, isStreamReq: false,
    thinkingType: null, temperature: null, systemPreview: null,
    toolNames: null, metadataUserId: null, systemReminder: null,
  };
  if (!buffer || buffer.byteLength === 0) return meta;

  try {
    const body = JSON.parse(new TextDecoder().decode(buffer));
    meta.model = typeof body.model === 'string' ? body.model : null;
    meta.maxTokens = typeof body.max_tokens === 'number' ? body.max_tokens : null;
    meta.isStreamReq = body.stream === true;
    meta.temperature = typeof body.temperature === 'number' ? body.temperature : null;

    if (body.thinking && typeof body.thinking === 'object'
        && typeof body.thinking.type === 'string') {
      meta.thinkingType = body.thinking.type;
    }

    if (body.metadata && typeof body.metadata === 'object'
        && typeof body.metadata.user_id === 'string') {
      meta.metadataUserId = body.metadata.user_id;
    }

    // system: string 또는 [{type:'text', text:...}] 배열 — 둘 다 처리
    if (typeof body.system === 'string') {
      meta.systemPreview = body.system.slice(0, 200);
    } else if (Array.isArray(body.system)) {
      const joined = body.system
        .filter((s: { type?: string }) => s.type === 'text')
        .map((s: { text?: string }) => s.text ?? '')
        .join(' ');
      meta.systemPreview = joined.slice(0, 200) || null;
    }

    if (Array.isArray(body.messages)) {
      meta.messagesCount = body.messages.length;
      meta.systemReminder = extractSystemReminders(body.messages);
      meta.requestPreview = extractLastUserPreview(body.messages);
    }

    if (Array.isArray(body.tools)) {
      meta.toolsCount = body.tools.length;
      const names = body.tools
        .map((t: { name?: string }) => (typeof t.name === 'string' ? t.name : null))
        .filter((n: string | null): n is string => n !== null);
      meta.toolNames = names.length > 0 ? JSON.stringify(names) : null;
    }
  } catch {
    // 파싱 실패 무시 — meta는 기본값 유지
  }

  return meta;
}

/**
 * 모든 user 메시지의 content에서 <system-reminder> 블록을 모아 반환 (v21).
 *
 * 책임:
 *  - role==='user' 메시지를 전부 순회해 reminder가 들어있는 text 항목 수집.
 *  - content가 string 형태인 경우(레거시 호환)도 동일 검사.
 *  - 멀티턴 대화에서 reminder는 첫 user에만 있는 게 아니라 후속 user에도 누적되므로 전부 모은다.
 *
 * 호출자: parseRequestBody (메시지 파싱 직후 1회)
 * 의존성: 없음 (순수 함수)
 *
 * @returns 발견된 reminder들을 \n으로 연결한 문자열, 없으면 null
 */
function extractSystemReminders(messages: ReadonlyArray<unknown>): string | null {
  const reminders: string[] = [];
  for (const raw of messages) {
    const m = raw as { role?: string; content?: unknown };
    if (m?.role !== 'user') continue;
    const content = m.content;
    if (typeof content === 'string') {
      if (content.includes('<system-reminder>')) reminders.push(content);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const c = part as { type?: string; text?: string };
      if (c?.type === 'text' && typeof c.text === 'string'
        && c.text.includes('<system-reminder>')) {
        reminders.push(c.text);
      }
    }
  }
  return reminders.length > 0 ? reminders.join('\n') : null;
}

/**
 * 마지막 user 메시지의 텍스트 200자 미리보기 (UI 행 표시용).
 * content는 string 또는 [{type:'text',text}] 배열 둘 다 처리.
 *
 * 호출자: parseRequestBody
 */
function extractLastUserPreview(messages: ReadonlyArray<unknown>): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown };
    if (m?.role !== 'user') continue;
    const content = m.content;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .filter((c) => (c as { type?: string }).type === 'text')
            .map((c) => (c as { text?: string }).text ?? '')
            .join(' ')
        : '';
    return text.slice(0, 200) || null;
  }
  return null;
}
