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
  // v21: system-reminder 원문 추출
  systemReminder: string | null;
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
}
