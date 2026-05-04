/**
 * proxy 모듈 — 공용 타입 정의
 *
 * 책임:
 *  - proxy/* 내부에서만 사용하는 타입을 한 곳에 모음.
 *  - 외부 노출은 하지 않음 (barrel index.ts에서 re-export 안 함).
 *
 * 의존성: 없음
 */

/**
 * 요청 본문 파싱 결과 — DB의 proxy_requests 컬럼에 저장될 메타.
 *
 * v20: 감사 필드(thinkingType, temperature, systemPreview, toolNames, metadataUserId) 추가.
 * v21: systemReminder 추가 (user 메시지 내 <system-reminder> 블록).
 * v22: system_* dedup 필드 4개 추가 (ADR-001 / ADR-002 / ADR-007).
 *      - body.system 본문을 정규화하여 SHA-256 hash로 dedup. system_reminder와 직교.
 *      - optional `?:` 선언 — handler.ts의 RequestMeta fallback 객체 리터럴에 영향 없게.
 */
export interface RequestMeta {
  model: string | null;
  messagesCount: number;
  maxTokens: number | null;
  toolsCount: number;
  requestPreview: string | null;
  isStreamReq: boolean;
  // v20: 감사용 메타 (request body에서 추출)
  thinkingType: string | null;
  temperature: number | null;
  systemPreview: string | null;
  toolNames: string | null; // JSON array string
  metadataUserId: string | null;
  // v21: system-reminder 원문 추출 (user 메시지 안 reminder 블록 — body.system과 직교)
  systemReminder: string | null;
  // v22: body.system 정규화 dedup (system_prompts 테이블 참조용)
  /** SHA-256(normalized) hex 64자. system_prompts.hash로 사용. body.system 미존재 시 null/undefined. */
  systemHash?: string | null;
  /** 정규화된 system 본문. system_prompts.content INSERT용 (handler.ts UPSERT 직전 1회 사용). */
  systemContent?: string | null;
  /** UTF-8 byte 길이. proxy_requests.system_byte_size · system_prompts.byte_size 양쪽 사용. */
  systemByteSize?: number | null;
  /** 정규화에 사용된 text 항목 수. system_prompts.segment_count INSERT용. */
  systemSegmentCount?: number | null;
}

/** Anthropic API usage 구조 (요청·응답 본문에서 추출) */
export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * 스트리밍 SSE 또는 비스트리밍 JSON 응답에서 누적 추출한 상태.
 *
 * - parseSSEChunk가 chunk별로 mutate
 * - 핸들러가 응답 종료 시점에 한 번에 읽어 createProxyRequest로 전달
 *
 * v23 (ADR-001 P1-E): toolUses — content_block_start의 tool_use 블록 메타.
 *   응답 종료 시 proxy_tool_uses 테이블에 일괄 INSERT되어 hook의 PostToolUse가
 *   tool_use_id로 정확한 api_request_id를 역조회 가능하게 한다.
 */
export interface StreamState {
  model: string | null;
  apiRequestId: string | null;
  usage: AnthropicUsage;
  stopReason: string | null;
  responsePreview: string | null;
  errorType: string | null;
  errorMessage: string | null;
  firstTokenMs: number | null;
  lastTokenMs: number | null;
  toolUses: Array<{
    tool_use_id: string;
    tool_name: string | null;
    block_index: number | null;
  }>;
}
