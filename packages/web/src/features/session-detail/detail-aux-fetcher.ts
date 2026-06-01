/**
 * features/session-detail/detail-aux-fetcher.ts — 상세 보조 탭(LLM Input·System 라이브러리) 데이터 fetcher
 *
 * 원본 fetch 경로(레거시 .js):
 *  - llm-input-view.js#ensureSessionProxyList  → GET /api/proxy-requests?session_id=&limit=500
 *  - llm-input-view.js#renderLlmInput          → GET /api/proxy-requests/:id/messages
 *                                              → GET /api/system-prompts/:hash (hash 있을 때)
 *  - system-prompt-library.js#loadSystemPromptLibrary → GET /api/system-prompts?orderBy=last_seen_at&limit=100
 *
 * 본 fetcher 는 fetch → Zod 파싱 → raw 반환만 한다(turns-fetcher.ts 패턴 1:1, render·DOM 0).
 *   colocated 사유: api/fetchers.ts 는 공유 파일(수정 금지)이고, 이 응답들은 상세 보조 탭 전용이라
 *   features/session-detail 안에 둔다(task 지침: "필요한 fetcher 는 features/session-detail 내 colocated 신규").
 *
 * @module features/session-detail/detail-aux-fetcher
 * @see packages/web/assets/js/llm-input-view.js (원본 showLatestLlmInput/renderLlmInput)
 * @see packages/web/assets/js/system-prompt-library.js (원본 loadSystemPromptLibrary)
 */
import { z } from 'zod';

const API = '';
const DEFAULT_TIMEOUT_MS = 8000;

function signalOf(signal?: AbortSignal): AbortSignal {
  return signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
}

// ── proxy 목록(세션 컨텍스트 셀렉터 + latest 선택) ───────────────────────────
const ProxyMetaSchema = z.object({ id: z.string() }).passthrough();
export type ProxyMetaRow = z.infer<typeof ProxyMetaSchema>;
const ProxyListEnvelope = z.object({ data: z.array(ProxyMetaSchema) }).passthrough();

/**
 * GET /api/proxy-requests?session_id=&limit=500 — 세션의 proxy 요청 메타 목록(timestamp 오름차순 가정).
 * 원본 ensureSessionProxyList. 실패/abort 는 빈 배열 폴백.
 */
export async function fetchSessionProxyList(
  sessionId: string | null | undefined,
  signal?: AbortSignal,
): Promise<ProxyMetaRow[]> {
  if (!sessionId) return [];
  try {
    const url = `${API}/api/proxy-requests?session_id=${encodeURIComponent(sessionId)}&limit=500`;
    const res = await fetch(url, { signal: signalOf(signal) });
    if (!res.ok) return [];
    const parsed = ProxyListEnvelope.safeParse(await res.json());
    return parsed.success ? parsed.data.data : [];
  } catch {
    return [];
  }
}

// ── proxy 요청 messages(LLM Input 본문) ──────────────────────────────────────
const MessagesDataSchema = z
  .object({
    id: z.string().optional(),
    system_hash: z.string().nullable().optional(),
    system_byte_size: z.number().nullable().optional(),
    messages: z.array(z.unknown()).optional(),
    decode_error: z.string().nullable().optional(),
  })
  .passthrough();
const MessagesEnvelope = z.object({ data: MessagesDataSchema.nullable() }).passthrough();

/** /api/proxy-requests/:id/messages 결과(원본 renderLlmInput 1단계). */
export interface ProxyMessagesResult {
  systemHash: string | null;
  systemSize: number | null;
  messages: unknown[];
  decodeError: string | null;
}

const EMPTY_MESSAGES: ProxyMessagesResult = {
  systemHash: null,
  systemSize: null,
  messages: [],
  decodeError: null,
};

/**
 * GET /api/proxy-requests/:id/messages — system_hash + messages 수신. 원본 renderLlmInput:220.
 * 실패/abort/data 누락은 빈 결과 폴백(원본 request-not-found 분기는 표면 빈 메시지로 수렴).
 */
export async function fetchProxyMessages(
  requestId: string | null | undefined,
  signal?: AbortSignal,
): Promise<ProxyMessagesResult> {
  if (!requestId) return EMPTY_MESSAGES;
  try {
    const url = `${API}/api/proxy-requests/${encodeURIComponent(requestId)}/messages`;
    const res = await fetch(url, { signal: signalOf(signal) });
    if (!res.ok) return EMPTY_MESSAGES;
    const parsed = MessagesEnvelope.safeParse(await res.json());
    if (!parsed.success || !parsed.data.data) return EMPTY_MESSAGES;
    const d = parsed.data.data;
    return {
      systemHash: d.system_hash ?? null,
      systemSize: d.system_byte_size ?? null,
      messages: Array.isArray(d.messages) ? d.messages : [],
      decodeError: d.decode_error ?? null,
    };
  } catch {
    return EMPTY_MESSAGES;
  }
}

// ── system 본문 lazy-fetch ────────────────────────────────────────────────────
const SystemPromptSchema = z
  .object({
    hash: z.string().optional(),
    content: z.string().nullable().optional(),
    byte_size: z.number().nullable().optional(),
    segment_count: z.number().nullable().optional(),
    ref_count: z.number().nullable().optional(),
  })
  .passthrough();
const SystemPromptEnvelope = z.object({ data: SystemPromptSchema.nullable() }).passthrough();

/** /api/system-prompts/:hash 결과(content + meta). 원본 renderLlmInput:237. */
export interface SystemPromptResult {
  content: string | null;
  meta: z.infer<typeof SystemPromptSchema> | null;
}

/**
 * GET /api/system-prompts/:hash — system 본문 + meta. 원본 renderLlmInput 2단계(hash 있을 때만).
 * 실패/abort 는 {content:null, meta:null}(원본 catch — meta 만 표시 동작 대응).
 */
export async function fetchSystemPrompt(
  hash: string | null | undefined,
  signal?: AbortSignal,
): Promise<SystemPromptResult> {
  if (!hash) return { content: null, meta: null };
  try {
    const url = `${API}/api/system-prompts/${encodeURIComponent(hash)}`;
    const res = await fetch(url, { signal: signalOf(signal) });
    if (!res.ok) return { content: null, meta: null };
    const parsed = SystemPromptEnvelope.safeParse(await res.json());
    if (!parsed.success || !parsed.data.data) return { content: null, meta: null };
    return { content: parsed.data.data.content ?? null, meta: parsed.data.data };
  } catch {
    return { content: null, meta: null };
  }
}

// ── system prompt 라이브러리 목록 ─────────────────────────────────────────────
const SysLibRowSchema = z
  .object({ hash: z.string() })
  .passthrough();
export type SysLibRowRaw = z.infer<typeof SysLibRowSchema>;
const SysLibEnvelope = z.object({ data: z.array(SysLibRowSchema) }).passthrough();

/**
 * GET /api/system-prompts?orderBy=last_seen_at&limit=100 — dedup 카탈로그 목록.
 * 원본 loadSystemPromptLibrary. 실패/abort 는 빈 배열 폴백.
 */
export async function fetchSystemPromptLibrary(
  signal?: AbortSignal,
): Promise<SysLibRowRaw[]> {
  try {
    const url = `${API}/api/system-prompts?orderBy=last_seen_at&limit=100`;
    const res = await fetch(url, { signal: signalOf(signal) });
    if (!res.ok) return [];
    const parsed = SysLibEnvelope.safeParse(await res.json());
    return parsed.success ? parsed.data.data : [];
  } catch {
    return [];
  }
}
