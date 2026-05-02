/**
 * proxy 모듈 — hook 측 NULL/0 데이터 backfill (v19+v21)
 *
 * 책임:
 *  - 새 클로드 코드 세션의 첫 prompt/tool 행은 transcript flush 전이라
 *    model NULL + tokens=0 + tokens_source='unavailable'로 들어감.
 *  - proxy 응답 시점엔 model·usage·api_request_id를 100% 알고 있으므로
 *    같은 session_id의 NULL/미정 행을 즉시 채워 정합성을 회복한다.
 *
 * 시간 윈도우: proxyStartMs - 30s ~ proxyStartMs + 5s
 *  - 보통은 hook이 proxy보다 먼저 도달하지만, 새 세션 시작 직후엔 proxy가 살짝 먼저 들어올 수 있어
 *    양방향으로 잡음. 5초 이상 차이 나는 행은 다른 turn으로 간주하여 건드리지 않음.
 *
 * 갱신 컬럼:
 *  1. model               — NULL이면 proxy의 model로 채움 (v19 원본 동작)
 *  2. tokens_input/output — tokens_source='unavailable'이면 proxy usage로 갱신 (v21 추가)
 *  3. cache_creation/read — 같이 갱신 (v21)
 *  4. tokens_confidence   — 'error' → 'high'로 승격
 *  5. tokens_source       — 'unavailable' → 'proxy' (출처 명시)
 *  6. api_request_id      — NULL이면 proxy의 api_request_id로 채움 (cross-link 강화)
 *
 * 부수 효과:
 *  - 새 세션 첫 prompt에 표시되던 "추정" 배지(tokens_source='unavailable' 기준)가 자연 소멸
 *  - hook ↔ proxy 양방향 cross-link이 prompt/tool 단계에서도 가능해짐
 *
 * 외부 노출: backfillRequestFromProxy(db, params)
 * 호출자: handler.ts (createProxyRequest 직후)
 * 의존성: bun:sqlite Database
 */

import type { Database } from 'bun:sqlite';

interface BackfillParams {
  sessionId: string | null;
  model: string | null;
  apiRequestId: string | null;
  tokensInput: number;
  tokensOutput: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  proxyStartMs: number;
}

/**
 * 같은 session_id + 시간 윈도우 안의 미완성 hook 행을 proxy 데이터로 백필.
 *
 * 두 단계 UPDATE로 분리하여 각 컬럼이 독립적으로 갱신되도록 함:
 *  - 단계 1: model NULL인 행만 model 채움 (v19)
 *  - 단계 2: tokens_source='unavailable'인 행만 토큰·신뢰도·소스·api_request_id 채움 (v21)
 *  - 두 조건은 별개일 수 있음 (model은 정상인데 토큰만 실패한 케이스 등)
 *
 * sessionId 또는 model이 null이면 no-op (안전).
 */
export function backfillRequestFromProxy(db: Database, p: BackfillParams): void {
  if (!p.sessionId || !p.model) return;
  const lo = p.proxyStartMs - 30_000;
  const hi = p.proxyStartMs + 5_000;

  try {
    // 단계 1: model NULL 행에 model + (있으면) api_request_id 채움
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).run(
      `UPDATE requests
       SET model = ?,
           api_request_id = COALESCE(api_request_id, ?)
       WHERE session_id = ?
         AND model IS NULL
         AND timestamp BETWEEN ? AND ?`,
      p.model,
      p.apiRequestId,
      p.sessionId,
      lo,
      hi,
    );

    // 단계 2: 토큰 출처가 'unavailable'(transcript 파싱 실패)인 행에 proxy usage로 채움.
    //   - 'high'/'transcript'로 이미 정상 추출된 행은 건드리지 않음.
    //   - api_request_id도 함께 채움(이미 있으면 보존).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).run(
      `UPDATE requests
       SET tokens_input = ?,
           tokens_output = ?,
           tokens_total = ?,
           cache_creation_tokens = ?,
           cache_read_tokens = ?,
           tokens_confidence = 'high',
           tokens_source = 'proxy',
           api_request_id = COALESCE(api_request_id, ?)
       WHERE session_id = ?
         AND tokens_source = 'unavailable'
         AND timestamp BETWEEN ? AND ?`,
      p.tokensInput,
      p.tokensOutput,
      p.tokensInput + p.tokensOutput,
      p.cacheCreationTokens,
      p.cacheReadTokens,
      p.apiRequestId,
      p.sessionId,
      lo,
      hi,
    );
  } catch (err) {
    console.warn('[PROXY] backfill UPDATE failed:', err);
  }
}

/**
 * @deprecated v21에서 backfillRequestFromProxy로 확장됨. 외부 호환을 위해 alias 유지.
 */
export function backfillRequestModelFromProxy(
  db: Database,
  sessionId: string | null,
  model: string | null,
  proxyStartMs: number,
): void {
  backfillRequestFromProxy(db, {
    sessionId,
    model,
    apiRequestId: null,
    tokensInput: 0,
    tokensOutput: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    proxyStartMs,
  });
}
