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
): Promise<SessionTurnsResult> {
  if (!sessionId) return EMPTY;
  try {
    const url = `${API}/api/sessions/${encodeURIComponent(sessionId)}/turns`;
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
