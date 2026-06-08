/**
 * lib/tool-response-field.ts — tool_response payload 판정/추출 순수 SSoT (B-2)
 *
 * 책임:
 *   payload.tool_response(도구별 상이) 를 안전 파싱하고, tool-status(오류 여부)·
 *   tool-hint(결과 힌트) 판정을 단일화한다. 라벨(i18n) 은 여기서 결정하지 않는다 —
 *   힌트는 "i18n 키 + vars" 를 돌려주고, 라벨 자체는 호출 측(React t / window.I18n.t)이 해석한다.
 *
 * 연혁:
 *   원본 assets/js/render/badges.js 의 private 헬퍼 getToolResponse/nonEmptyStr/numVar 와
 *   toolStatusBadge / toolResponseHint 의 "판정" 로직을 1:1 추출.
 *
 * @module lib/tool-response-field
 */

/** tool_response 파싱본 — 접근 필드만 optional, 나머지는 index 허용(원본 ToolResponse 동치). */
export interface ToolResponse {
  stderr?: unknown;
  content?: unknown;
  is_error?: unknown;
  totalLines?: unknown;
  total_lines?: unknown;
  numFiles?: unknown;
  num_files?: unknown;
  filenames?: unknown;
  results?: unknown;
  paths?: unknown;
  [k: string]: unknown;
}

/** payload(string|object) 에서 tool_response 추출(실패/부재는 null). 원본 getToolResponse 1:1. */
export function getToolResponse(r: { payload?: unknown }): ToolResponse | null {
  if (!r.payload) return null;
  try {
    const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
    return (p as { tool_response?: ToolResponse } | null)?.tool_response ?? null;
  } catch {
    return null;
  }
}

/** "문자열이면서 trim 후 비어있지 않은가" — 원본 nonEmptyStr 1:1. */
function nonEmptyStr(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/** number|string 만 통과(객체/null/undefined 는 null) — 원본 numVar 1:1. */
function numVar(v: unknown): number | string | null {
  return typeof v === 'number' || typeof v === 'string' ? v : null;
}

/**
 * tool 응답 오류 여부 판정 — 원본 toolStatusBadge 의 hasError 분기 1:1.
 * tool_response 없으면 false(실행 전/중 — 호출 측이 미노출).
 */
export function toolHasError(r: { payload?: unknown; tool_name?: string | null }): boolean {
  const tr = getToolResponse(r);
  if (!tr) return false;
  const tn = r.tool_name || '';
  if (tn === 'Bash') {
    return nonEmptyStr(tr.stderr);
  }
  if (tn === 'Agent' || tn === 'Skill') {
    try {
      const content = Array.isArray(tr.content) ? tr.content : tr.content ? [tr.content] : [];
      let hasError = content.some((c: unknown) => {
        const o = c as { type?: unknown; is_error?: unknown } | null;
        return o?.type === 'tool_result' && !!o?.is_error;
      });
      if (!hasError && tr.is_error) hasError = true;
      return hasError;
    } catch {
      return !!tr.is_error;
    }
  }
  return !!tr.is_error;
}

/** tool-hint i18n 지시 — { key, vars }. 미표시면 null. */
export interface ToolHint {
  key: string;
  vars?: Record<string, number | string>;
}

/**
 * 도구별 결과 힌트 판정 — 원본 toolResponseHint 의 분기 1:1.
 * 반환은 i18n 키 + vars(라벨 해석은 호출 측). tool_response 없거나 힌트 없으면 null.
 */
export function toolResponseHintKey(r: { payload?: unknown; tool_name?: string | null }): ToolHint | null {
  const tr = getToolResponse(r);
  if (!tr) return null;
  const tn = r.tool_name || '';
  try {
    if (tn === 'Read') {
      const lines = numVar(tr.totalLines ?? tr.total_lines);
      if (lines != null) return { key: 'badges:renderers.tool-hint.lines', vars: { n: lines } };
    }
    if (tn === 'Bash') {
      return nonEmptyStr(tr.stderr) ? { key: 'badges:renderers.tool-hint.error' } : null;
    }
    if (tn === 'Edit' || tn === 'Write' || tn === 'MultiEdit') {
      return { key: 'badges:renderers.tool-hint.saved' };
    }
    if (tn === 'Grep') {
      const num = numVar(tr.numFiles ?? tr.num_files);
      if (num != null) return { key: 'badges:renderers.tool-hint.files', vars: { n: num } };
    }
    if (tn === 'Glob') {
      const arr = Array.isArray(tr.filenames ?? tr.results ?? tr.paths ?? tr)
        ? tr.filenames ?? tr.results ?? tr.paths
        : null;
      if (Array.isArray(arr)) return { key: 'badges:renderers.tool-hint.matches', vars: { n: arr.length } };
    }
    if (tn === 'Agent' || tn === 'Skill') {
      return tr.is_error ? { key: 'badges:renderers.tool-hint.failed' } : null;
    }
  } catch {
    /* 파싱 실패는 무시 */
  }
  return null;
}
