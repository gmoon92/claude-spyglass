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
    toolNames: null, metadataUserId: null,
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
      // 마지막 user 메시지를 preview로 추출 (UI 행에 표시용)
      const lastUser = [...body.messages].reverse().find((m: { role?: string }) => m.role === 'user');
      if (lastUser) {
        const content = lastUser.content;
        const text = typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .filter((c: { type?: string }) => c.type === 'text')
                .map((c: { text?: string }) => c.text ?? '')
                .join(' ')
            : '';
        meta.requestPreview = text.slice(0, 200) || null;
      }
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
