/**
 * proxy 모듈 — Anthropic 스트리밍 응답(SSE) 파서
 *
 * 책임:
 *  - upstream에서 받은 SSE chunk를 누적 파싱하여 StreamState에 usage·model·stop_reason·preview 등을 기록.
 *  - 핸들러는 chunk가 도착할 때마다 parseSSEChunk를 호출하고, 끝나면 state를 그대로 createProxyRequest에 전달.
 *
 * 추출 이벤트:
 *  - message_start       : model, apiRequestId, usage(input/cache)
 *  - content_block_start : firstTokenMs (TTFT) 측정 + tool_use 블록 메타 캡처 (v23 ADR-001 P1-E)
 *  - content_block_delta : firstTokenMs/lastTokenMs, responsePreview 누적 (200자 캡)
 *  - message_delta       : stop_reason, output_tokens (lastTokenMs 갱신)
 *  - error               : errorType, errorMessage
 *
 * 외부 노출: parseSSEChunk(text, state, startMs)
 * 호출자: handler.ts (스트리밍 응답 처리 루프 내부)
 * 의존성: types
 */

import type { StreamState, AnthropicUsage } from './types';

/**
 * SSE chunk 1개를 파싱하여 state를 mutate.
 *
 * 부분 chunk가 들어와도 안전하게 동작 (라인 단위로 분리, JSON 파싱 실패한 라인은 skip).
 *
 * @param text     decoder가 변환한 chunk 텍스트
 * @param state    누적 상태 (이 함수가 mutate)
 * @param startMs  요청 시작 시각 (TTFT 계산 기준)
 */
export function parseSSEChunk(text: string, state: StreamState, startMs: number): void {
  const lines = text.split('\n');
  let currentEvent = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
      continue;
    }
    if (!line.startsWith('data: ')) continue;
    const raw = line.slice(6).trim();
    if (raw === '[DONE]') continue;

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }

    switch (currentEvent) {
      case 'message_start': {
        const msg = data.message as Record<string, unknown> | undefined;
        if (!msg) break;
        state.model = (msg.model as string) ?? state.model;
        state.apiRequestId = (msg.id as string) ?? state.apiRequestId;
        const u = msg.usage as AnthropicUsage | undefined;
        if (u) {
          state.usage.input_tokens = u.input_tokens ?? 0;
          state.usage.cache_creation_input_tokens = u.cache_creation_input_tokens ?? 0;
          state.usage.cache_read_input_tokens = u.cache_read_input_tokens ?? 0;
        }
        break;
      }
      case 'content_block_start': {
        if (state.firstTokenMs === null) state.firstTokenMs = Date.now() - startMs;
        // v23 (ADR-001 P1-E): tool_use 블록의 id·name·index를 캡처해 hook ↔ proxy 정확 매칭에 사용.
        // SSE schema: { index, content_block: { type: 'tool_use', id: 'toolu_...', name: '...' } }
        const block = data.content_block as Record<string, unknown> | undefined;
        if (block && block.type === 'tool_use' && typeof block.id === 'string') {
          state.toolUses.push({
            tool_use_id: block.id,
            tool_name: typeof block.name === 'string' ? block.name : null,
            block_index: typeof data.index === 'number' ? data.index : null,
          });
        }
        break;
      }
      case 'content_block_delta': {
        if (state.firstTokenMs === null) state.firstTokenMs = Date.now() - startMs;
        state.lastTokenMs = Date.now() - startMs;
        const delta = (data.delta as Record<string, unknown>) ?? {};
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          if (state.responsePreview === null) state.responsePreview = '';
          if (state.responsePreview.length < 200) {
            state.responsePreview = (state.responsePreview + delta.text).slice(0, 200);
          }
        }
        break;
      }
      case 'message_delta': {
        const d = data.delta as Record<string, unknown> | undefined;
        if (d?.stop_reason) state.stopReason = d.stop_reason as string;
        const u = data.usage as AnthropicUsage | undefined;
        if (u?.output_tokens != null) {
          state.usage.output_tokens = u.output_tokens;
          state.lastTokenMs = Date.now() - startMs;
        }
        break;
      }
      case 'error': {
        const err = data.error as Record<string, unknown> | undefined;
        if (err) {
          state.errorType = (err.type as string) ?? null;
          state.errorMessage = (err.message as string) ?? null;
        }
        break;
      }
    }
  }
}
