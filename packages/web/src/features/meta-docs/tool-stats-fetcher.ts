/**
 * features/meta-docs/tool-stats-fetcher.ts — 프로젝트 도구 통계 colocated fetcher (vanilla→React 배선)
 *
 * 원본: assets/js/tool-stats.js loadProjectToolStats(:66-106).
 *   GET /api/projects/:name/tool-stats?from&to → { success, data: ToolStatRow[] }.
 *   원본은 fetch 직후 #metaToolStatsBody 에 renderMatrix 사이드이펙트를 냈으나,
 *   본 모듈은 **fetch → Zod 파싱 → raw rows 반환** 만 한다(사이드이펙트 0 — DOM/render/throw 없음).
 *
 * api/fetchers.ts 와 동형 계약:
 *   - ApiListEnvelopeSchema(P1-07) passthrough 로 후방호환(any 금지, z.infer 로 구체화).
 *   - 실패(HTTP/스키마/abort) → [] 안전 폴백(원본 catch 블록 동치).
 *   - range from/to 는 인자 주입(store/모듈 역참조 없음 — 데이터 역전 핵심).
 *   - fetchers.ts 수정 금지 규칙으로 meta-docs 폴더에 colocated(절대 규칙).
 *
 * @module features/meta-docs/tool-stats-fetcher
 */
import { z } from 'zod';
import { ApiListEnvelopeSchema, parseApiEnvelope } from '../../schema/api-schema';
import type { ToolStatRow } from '../dashboard/tool-stats-sort';

const API = '';
const DEFAULT_TIMEOUT_MS = 8000;

/** 도구 통계 행(getProjectToolStats 결과). 정렬/렌더에 쓰는 최소 필드, 나머지 passthrough. */
const ToolStatRowSchema = z.object({ tool_name: z.string() }).passthrough();
const ToolStatsEnvelope = ApiListEnvelopeSchema(ToolStatRowSchema);

/** fetchProjectToolStats 파라미터. project null → 빈 결과(원본 select-project 빈 상태 분기). */
export interface FetchProjectToolStatsParams {
  /** 좌측 선택 프로젝트명. null/빈 문자열이면 fetch 생략 → []. */
  project: string | null;
  /** 날짜 range — 원본 from/to 키로 직렬화(tool-stats.js:88-90). */
  from?: number;
  to?: number;
  signal?: AbortSignal;
}

/** URLSearchParams 직렬화 — 무상태 순수 헬퍼(fetchers.withQuery 동형). */
function withQuery(base: string, params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    usp.set(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * GET /api/projects/:name/tool-stats — 프로젝트 도구 통계 raw rows 반환.
 *  원본 loadProjectToolStats 의 skeleton/renderMatrix/retry DOM 사이드이펙트는 제거 —
 *  정렬/empty/error 표현은 호출처(ToolStatsMatrix)가 책임. project null → 즉시 [].
 */
export async function fetchProjectToolStats(params: FetchProjectToolStatsParams): Promise<ToolStatRow[]> {
  const project = params.project;
  if (!project) return [];
  const url = withQuery(`${API}/api/projects/${encodeURIComponent(project)}/tool-stats`, {
    from: params.from,
    to: params.to,
  });
  try {
    const res = await fetch(url, { signal: params.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    const parsed = parseApiEnvelope<{ data: ToolStatRow[] }>(
      ToolStatsEnvelope as z.ZodType<{ data: ToolStatRow[] }>,
      json,
    );
    return parsed.ok && parsed.data ? parsed.data.data : [];
  } catch {
    return [];
  }
}
