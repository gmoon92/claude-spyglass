/**
 * features/dashboard/tool-stats-sort.ts — 프로젝트 도구 통계 정렬/포맷 순수 로직 (P3-09)
 *
 * 원본: assets/js/tool-stats.js (ADR-007/004).
 *  - 정렬 SSoT(SORTABLE_KEYS/DEFAULT_DIR/COMPARATORS/applySort/applySortChange) + fmtDur 추출.
 *  - 원본은 모듈 전역 _sortKey/_sortDir 를 mutate 했으나, 본 모듈은 (key,dir) 입력 → 새 (key,dir)
 *    반환하는 순수 전이로 분리(상태는 컴포넌트/스토어 소유 — 전역 mutate 폐기).
 *  - collator 는 i18n-utils.js getCollator(window-safe) 재사용 — chart/syslib 정렬과 통일.
 *
 * @module features/dashboard/tool-stats-sort
 */
import { getCollator } from '../../lib/i18n-utils';

/** 도구 통계 행(getProjectToolStats 결과). */
export interface ToolStatRow {
  tool_name?: string;
  avg_duration_ms?: number;
  call_count?: number;
  total_tokens?: number;
  pct_of_total_tokens?: number;
  error_count?: number;
  confidence_error_count?: number;
  confidence_low_count?: number;
  has_low_confidence?: boolean;
  [k: string]: unknown;
}

export type ToolStatsSortKey = 'tool' | 'avg' | 'calls' | 'tokens' | 'pct' | 'errors';
export type SortDir = 'asc' | 'desc';

export const SORTABLE_KEYS: ReadonlySet<ToolStatsSortKey> = new Set([
  'tool',
  'avg',
  'calls',
  'tokens',
  'pct',
  'errors',
]);

/** 컬럼별 기본 정렬 방향(텍스트 asc / 숫자 desc). */
export const DEFAULT_DIR: Record<ToolStatsSortKey, SortDir> = {
  tool: 'asc',
  avg: 'desc',
  calls: 'desc',
  tokens: 'desc',
  pct: 'desc',
  errors: 'desc',
};

export const DEFAULT_SORT: { key: ToolStatsSortKey; dir: SortDir } = { key: 'tokens', dir: 'desc' };

function cmpString(a: unknown, b: unknown): number {
  const sa = a == null ? '' : String(a);
  const sb = b == null ? '' : String(b);
  const collator = getCollator();
  return collator ? collator.compare(sa, sb) : sa.localeCompare(sb);
}
function cmpNumber(a: number | undefined, b: number | undefined): number {
  return (a ?? 0) - (b ?? 0);
}

const COMPARATORS: Record<ToolStatsSortKey, (a: ToolStatRow, b: ToolStatRow) => number> = {
  tool: (a, b) => cmpString(a.tool_name, b.tool_name),
  avg: (a, b) => cmpNumber(a.avg_duration_ms, b.avg_duration_ms),
  calls: (a, b) => cmpNumber(a.call_count, b.call_count),
  tokens: (a, b) => cmpNumber(a.total_tokens, b.total_tokens),
  pct: (a, b) => cmpNumber(a.pct_of_total_tokens, b.pct_of_total_tokens),
  errors: (a, b) => cmpNumber(a.error_count, b.error_count),
};

/** 정렬 dispatcher — 원본 _rows 불변 유지(slice). 미존재 키 → tokens 폴백. */
export function applySort(
  rows: ReadonlyArray<ToolStatRow>,
  key: ToolStatsSortKey,
  dir: SortDir = 'desc',
): ToolStatRow[] {
  const cmp = COMPARATORS[key] ?? COMPARATORS.tokens;
  const factor = dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => factor * cmp(a, b));
}

/**
 * 정렬 토글 — 같은 키 재클릭 → 방향 토글, 다른 키 → 컬럼 기본 방향.
 * (원본 applySortChange 동치 — 순수 전이, 무효 키는 현재 상태 유지)
 */
export function nextSort(
  current: { key: ToolStatsSortKey; dir: SortDir },
  key: ToolStatsSortKey,
): { key: ToolStatsSortKey; dir: SortDir } {
  if (!SORTABLE_KEYS.has(key)) return current;
  if (current.key === key) {
    return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key, dir: DEFAULT_DIR[key] ?? 'desc' };
}

/** 응답시간 포맷(원본 fmtDur). 0/누락 → '—'. */
export function fmtDur(ms: number | null | undefined): string {
  if (!ms || ms === 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}

/** 헤더 정렬 상태 표지(idle/asc/desc) + aria-sort 값. */
export function sortState(
  current: { key: ToolStatsSortKey; dir: SortDir },
  key: ToolStatsSortKey,
): 'idle' | 'asc' | 'desc' {
  if (current.key !== key) return 'idle';
  return current.dir === 'asc' ? 'asc' : 'desc';
}
export function ariaSortValue(
  current: { key: ToolStatsSortKey; dir: SortDir },
  key: ToolStatsSortKey,
): 'none' | 'ascending' | 'descending' {
  if (current.key !== key) return 'none';
  return current.dir === 'asc' ? 'ascending' : 'descending';
}
