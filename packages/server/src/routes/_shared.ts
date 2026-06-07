/**
 * routes/_shared.ts — REST API 라우터 공통 헬퍼.
 *
 * @description
 *   srp-redesign Phase 2 분해 결과. routes/* 모든 라우터가 의존하는 공통 모듈.
 *   변경 이유: "API 응답 포맷·헤더·에러 형식 변경" — 한 곳만 수정하면 모든 라우트 자동 반영.
 *
 *   기존 api.ts(406줄)에 응답 헬퍼·타입·라우터 로직이 혼재되어 있던 것을 분리:
 *   - 이 파일: 응답 contract (변경 이유: 응답 포맷)
 *   - routes/{domain}.ts: 도메인별 라우트 (변경 이유: 라우트별 비즈니스)
 *   - api.ts: 라우터 fan-out + dashboard 캐시 무효화 export
 */

import type { Database } from 'bun:sqlite';

// =============================================================================
// 응답 타입
// =============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** ADR-001 P1: turn_id가 NULL인 행 (session-prologue) — turns 응답 옵션 필드 */
  prologue?: unknown;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    offset?: number;
    p95DurationMs?: number;
    /** ADR-001 P1: prologue 배열 길이 (편의용) */
    prologue_count?: number;
    /** prompt 행이 없는 진행 중 세션을 단일 implicit turn으로 합성해 반환한 경우 표지 */
    implicit_turn?: boolean;
    /** /api/conversations: MAX_ROWS 상한에 걸려 결과가 잘렸는지 표지 */
    truncated?: boolean;
  };
}

// =============================================================================
// 응답 빌더
// =============================================================================

/**
 * 통일된 JSON 응답. 모든 routes/* 라우터가 이 함수를 사용 — API 응답 contract SSoT.
 *
 * CORS 헤더는 여기서 부여하지 않는다 — origin 허용 판단·헤더 부여는 /api/* 진입점
 * (api.ts apiRouter)에서 SSoT(@spyglass/types corsHeaders)를 1회 경유해 모든 응답에
 * 일괄 적용한다 ("동일 판단 로직은 한 곳에만"). 97개 호출 측이 req 를 다시 넘길 필요가
 * 없도록 하기 위함이며, 와일드카드('*')는 이 전환으로 완전히 제거됐다.
 */
export function jsonResponse(body: ApiResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * gzip 압축 임계값(byte). 이보다 작은 본문은 압축 이득 < CPU/헤더 오버헤드라 평문 유지.
 * 일반적 MTU(~1500B) 근처 — 대부분의 작은 JSON 응답은 그대로 통과한다.
 */
const GZIP_MIN_BYTES = 1400;

/**
 * Accept-Encoding 협상 기반 gzip 응답 압축 — `/api/*` 응답 contract 의 cross-cutting 변환.
 *
 *   apiRouter(api.ts) 단일 choke point 에서만 호출된다. CORS 와 동일하게 "한 곳에서 일괄"
 *   적용하는 응답 변환이며, 97개 jsonResponse 호출 측은 압축을 알 필요가 없다.
 *
 * 안전 가드(다른 기능 사이드이펙트 방지):
 *   - SSE(/events)·프록시(/v1)·hook(/collect)·static 은 dispatch.ts 에서 apiRouter 를
 *     거치지 않으므로 애초에 대상이 아니다 — 스트리밍/이벤트 본문을 버퍼링할 위험 없음.
 *   - Accept-Encoding 에 gzip 이 없으면 평문 그대로(비-gzip 클라이언트 폴백).
 *   - 이미 Content-Encoding 이 있으면 건너뜀(이중 압축 방지).
 *   - Content-Type 이 JSON/text 가 아니면 건너뜀(이미 압축된 바이너리 등 무의미·역효과 방지).
 *   - 본문이 임계값 미만이면 평문 유지.
 *
 * Vary: CORS 가 먼저 부여한 `Vary: Origin` 을 보존하며 `Accept-Encoding` 을 **병합**한다
 *   (캐시 정합 — origin·encoding 둘 다에 따라 응답이 달라짐). 따라서 호출 순서는
 *   applyCorsHeaders → compressResponse 여야 한다.
 */
export async function compressResponse(res: Response, req: Request): Promise<Response> {
  if (res.headers.has('Content-Encoding')) return res;

  const accept = req.headers.get('accept-encoding') ?? '';
  if (!/\bgzip\b/i.test(accept)) return res;

  const ctype = res.headers.get('Content-Type') ?? '';
  if (!/application\/json|text\//i.test(ctype)) return res;

  // 본문 버퍼링(여기 도달하는 응답은 jsonResponse 류 버퍼드 JSON — 스트리밍 아님).
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < GZIP_MIN_BYTES) {
    // 본문은 이미 소비됐으므로 동일 헤더로 재구성(CORS 헤더 포함)해 평문 반환.
    return new Response(buf, { status: res.status, headers: res.headers });
  }

  const gz = Bun.gzipSync(buf);
  const headers = new Headers(res.headers); // ACAO·Vary:Origin·Content-Type 보존
  headers.set('Content-Encoding', 'gzip');
  const existingVary = headers.get('Vary');
  headers.set('Vary', existingVary ? `${existingVary}, Accept-Encoding` : 'Accept-Encoding');
  headers.delete('Content-Length'); // Bun 이 압축 길이로 재계산
  return new Response(gz, { status: res.status, headers });
}

// =============================================================================
// 라우터 시그니처
// =============================================================================

/**
 * 라우터 함수 시그니처 — 매칭되는 라우트면 Response 반환, 아니면 null.
 *
 * api.ts가 routes/* 라우터를 차례로 시도(fan-out)하며 첫 non-null 응답을 반환한다.
 * null 반환 = "이 라우터가 처리하지 않음 → 다음 라우터 시도".
 */
export type RouteHandler = (
  req: Request,
  db: Database,
  url: URL,
  path: string,
  method: string,
) => Response | null;
