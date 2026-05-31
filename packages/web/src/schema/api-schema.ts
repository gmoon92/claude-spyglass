/**
 * api-schema.ts — REST API 응답 envelope Zod 스키마 (P1-07).
 *
 * @description
 *   api.js 의 fetch → res.json() 응답을 런타임 검증/정규화한다.
 *   서버 응답 공통 형태는 `{ data: ... }` envelope (api.js 전반: json.data 추출).
 *
 *   제공 스키마:
 *     - ApiListEnvelopeSchema(item) : `{ data: item[] }` (requests/sessions/proxy-requests 등)
 *     - ApiObjectEnvelopeSchema(obj): `{ data: obj }`   (단일 객체 응답)
 *     - DashboardEnvelopeSchema     : /api/dashboard `{ data: { summary, ... } }`
 *
 *   설계 원칙(sse-schema.ts 와 동일):
 *     1. SSoT 재사용 — 도메인 항목 스키마는 sse-schema.ts/types 를 재사용. 여기선 envelope만.
 *     2. 안전 처리 — parseApiEnvelope 는 throw 없이 ParseResult 반환.
 *     3. 후방호환 — envelope/summary 객체는 .passthrough().
 *
 *   본 task(P1-07)는 스키마 "설계·생성"만. api.js 결선(파싱부 교체)은 후속 P3.
 *
 * @see packages/web/assets/js/api.js
 * @see packages/web/src/schema/sse-schema.ts
 */

import { z } from 'zod';
import type { ParseResult } from './sse-schema';

/** ZodError → 단일 문자열 (로깅/폴백용). sse-schema.ts 와 동일 포맷. */
function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

// =============================================================================
// 공통 envelope 빌더
// =============================================================================

/**
 * `{ data: item[] }` 리스트 envelope 스키마 생성기.
 * @param item 배열 항목 스키마 (예: NewRequestEventSchema)
 */
export function ApiListEnvelopeSchema<T extends z.ZodTypeAny>(item: T) {
  return z
    .object({ data: z.array(item) })
    .passthrough();
}

/**
 * `{ data: obj }` 단일 객체 envelope 스키마 생성기.
 * @param obj data 객체 스키마
 */
export function ApiObjectEnvelopeSchema<T extends z.ZodTypeAny>(obj: T) {
  return z
    .object({ data: obj })
    .passthrough();
}

// =============================================================================
// /api/dashboard — DashboardData (api.js DashboardData typedef 1:1)
// =============================================================================

const DashboardSummarySchema = z
  .object({
    totalSessions: z.number(),
    totalRequests: z.number(),
    totalTokens: z.number(),
    activeSessions: z.number(),
    avgDurationMs: z.number().nullable(),
    p95DurationMs: z.number().nullable(),
    errorRate: z.number().nullable(),
  })
  .passthrough();

const DashboardDataSchema = z
  .object({
    summary: DashboardSummarySchema,
    requests: z
      .object({ avg_duration_ms: z.number().optional() })
      .passthrough()
      .nullable(),
    projects: z.array(z.object({ project_name: z.string() }).passthrough()),
    types: z.array(z.object({ count: z.number() }).passthrough()),
    active: z.array(z.unknown()),
  })
  .passthrough();

export const DashboardEnvelopeSchema = ApiObjectEnvelopeSchema(DashboardDataSchema);

export type DashboardData = z.infer<typeof DashboardDataSchema>;

// =============================================================================
// 안전 파싱 API
// =============================================================================

/**
 * 임의 envelope 스키마로 입력을 안전 파싱한다. throw 없이 ParseResult 반환.
 *
 * @param schema ApiListEnvelopeSchema(...) / DashboardEnvelopeSchema 등
 * @param input  res.json() 결과 (undefined/null 포함 가능 — 안전 폴백)
 */
export function parseApiEnvelope<T>(
  schema: z.ZodType<T>,
  input: unknown,
): ParseResult<T> {
  const parsed = schema.safeParse(input);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, error: formatZodError(parsed.error) };
}
