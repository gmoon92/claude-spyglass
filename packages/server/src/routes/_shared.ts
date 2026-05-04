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
  };
}

// =============================================================================
// 응답 빌더
// =============================================================================

/**
 * 통일된 JSON 응답 (CORS 헤더 포함).
 * 모든 routes/* 라우터가 이 함수를 사용 — API 응답 contract SSoT.
 */
export function jsonResponse(body: ApiResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
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
