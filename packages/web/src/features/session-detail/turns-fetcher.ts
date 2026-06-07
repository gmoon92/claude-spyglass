/**
 * features/session-detail/turns-fetcher.ts — 세션 turns 데이터 fetcher (colocated, P3-07 데이터 배선)
 *
 * 원본: assets/js/session-detail/index.js#loadSessionDetail (session-detail/index.js:79-99) 의
 *   `/api/sessions/:id/turns` fetch 부. 원본은 fetch 직후 setDetailTurns/setDetailPrologue/
 *   applyDetailFilter 등 store·DOM 사이드이펙트를 동기 호출했다. 본 fetcher 는
 *   **fetch → Zod 파싱 → {turns, prologue} raw 반환** 만 한다(api/fetchers.ts 패턴 1:1 — render·DOM 0).
 *
 *   colocated 사유: api/fetchers.ts 는 공유 파일(다른 작업자 소유)이라 수정 금지. turns 응답은
 *   `{data, prologue}` 가 형제 키라 ApiListEnvelopeSchema(data 만) 로 표현 불가 → 본 폴더에 전용 스키마.
 *
 * 응답 형태(curl 실측): `{ success, data: TurnRow[], prologue: PrologueRow[], meta }`.
 *   - data: turn_id/turn_index 필수 + prompt/tool_calls/responses/summary/system_reminder/items passthrough.
 *   - prologue: turn_id NULL 행 별도 배열(서버가 분리 제공 — 본 fetcher 는 그대로 반환).
 *
 * @module features/session-detail/turns-fetcher
 * @see packages/web/src/api/fetchers.ts (사이드이펙트 0 fetcher 패턴)
 * @see packages/web/assets/js/session-detail/index.js#loadSessionDetail (원본)
 */
import { z } from 'zod';

const API = '';
const DEFAULT_TIMEOUT_MS = 8000;

/** turn 행(최소 계약). turn_id/turn_index 만 필수, 나머지(prompt/tool_calls/...)는 passthrough 로 보존. */
const TurnRowSchema = z.object({ turn_id: z.string(), turn_index: z.number() }).passthrough();
export type TurnRow = z.infer<typeof TurnRowSchema>;

/** prologue 행(turn_id NULL 행) — 형태 자유, passthrough 보존. */
const PrologueRowSchema = z.object({}).passthrough();
export type PrologueRow = z.infer<typeof PrologueRowSchema>;

/** /api/sessions/:id/turns envelope — data·prologue 형제 키(passthrough 로 success/meta 보존). */
const TurnsEnvelopeSchema = z
  .object({
    data: z.array(TurnRowSchema),
    prologue: z.array(PrologueRowSchema).optional(),
  })
  .passthrough();

/** fetchSessionTurns 결과 — turns 본문 + prologue 행(turn_id NULL). */
export interface SessionTurnsResult {
  turns: TurnRow[];
  prologue: PrologueRow[];
}

const EMPTY: SessionTurnsResult = { turns: [], prologue: [] };

/**
 * GET /api/sessions/:id/turns — {turns, prologue} raw 반환.
 *   원본 loadSessionDetail 의 setDetailTurns/setDetailPrologue/applyDetailFilter 사이드이펙트는
 *   **제거** — 필터/활성 턴/렌더는 호출처(useSessionDetail) 책임.
 *   실패(HTTP/스키마/abort)는 throw 없이 빈 결과 폴백(api/fetchers.ts silent catch 동형).
 *
 * @param sessionId 대상 세션(falsy 면 빈 결과).
 * @param signal AbortController.signal — 세션 변경 시 직전 요청 abort.
 */
export async function fetchSessionTurns(
  sessionId: string | null | undefined,
  signal?: AbortSignal,
  opts?: { includePayload?: boolean },
): Promise<SessionTurnsResult> {
  if (!sessionId) return EMPTY;
  try {
    // turns-payload-lazy-load: 초기 진입은 includePayload=false 로 payload BLOB 없이 즉시 받고,
    //   직후 background 로 includePayload=true(기본)를 다시 받아 payload 를 채운다(use-session-detail).
    //   서버 기본은 payload 포함이므로 ?payload=0 일 때만 명시.
    const qs = opts?.includePayload === false ? '?payload=0' : '';
    const url = `${API}/api/sessions/${encodeURIComponent(sessionId)}/turns${qs}`;
    const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    if (!res.ok) return EMPTY;
    const json: unknown = await res.json();
    const parsed = TurnsEnvelopeSchema.safeParse(json);
    if (!parsed.success) return EMPTY;
    return { turns: parsed.data.data, prologue: parsed.data.prologue ?? [] };
  } catch {
    return EMPTY;
  }
}

/** 단일 turn 의 행별 payload(on-demand lazy-load 응답 행). */
export interface TurnPayloadRow {
  id: string;
  payload: string | null;
}

const TurnPayloadsEnvelopeSchema = z
  .object({ data: z.array(z.object({ id: z.string(), payload: z.string().nullable() })) })
  .passthrough();

/**
 * GET /api/sessions/:id/turns/:turnId/payloads — 단일 turn 행별 payload 배치.
 *   turns fast 응답(payload 미포함) 이후, 활성 turn 으로 전환될 때 그 turn 의 payload 만 가져온다.
 *   실패/abort 는 빈 배열 폴백(렌더는 preview/tool_detail 로 이미 동작 — enrichment 누락만).
 */
export async function fetchTurnPayloads(
  sessionId: string | null | undefined,
  turnId: string | null | undefined,
  signal?: AbortSignal,
): Promise<TurnPayloadRow[]> {
  if (!sessionId || !turnId) return [];
  try {
    const url = `${API}/api/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/payloads`;
    const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    const parsed = TurnPayloadsEnvelopeSchema.safeParse(json);
    return parsed.success ? parsed.data.data : [];
  } catch {
    return [];
  }
}
