/**
 * features/dashboard/syslib-sort.ts — System Prompt 라이브러리 정렬/포맷 순수 로직 (P3-09)
 *
 * 원본: assets/js/system-prompt-library.js (web-design-balance-pass ADR-007).
 *  - 정렬 SSoT(SORTABLE_KEYS/DEFAULT_DIR/COMPARATORS/applySort/applySortChange) +
 *    formatBytes/formatTime/sizeClassFor/refHotCutoff 추출. 전역 _sortKey/_sortDir → 순수 전이.
 *  - collator 는 i18n-utils getCollator(window-safe) 재사용(다른 정렬 모듈과 통일).
 *
 * @module features/dashboard/syslib-sort
 */
import { getCollator } from '../../../assets/js/i18n-utils.js';

/** 라이브러리 행(/api/system-prompts 메타). */
export interface SysLibRow {
  hash: string;
  byte_size?: number;
  segment_count?: number;
  ref_count?: number;
  first_seen_at?: number;
  last_seen_at?: number;
  content?: string;
  [k: string]: unknown;
}

export type SysLibSortKey =
  | 'hash'
  | 'byte_size'
  | 'segment_count'
  | 'ref_count'
  | 'first_seen_at'
  | 'last_seen_at';
export type SortDir = 'asc' | 'desc';

export const SORTABLE_KEYS: ReadonlySet<SysLibSortKey> = new Set([
  'hash',
  'byte_size',
  'segment_count',
  'ref_count',
  'first_seen_at',
  'last_seen_at',
]);

export const DEFAULT_DIR: Record<SysLibSortKey, SortDir> = {
  hash: 'asc',
  byte_size: 'desc',
  segment_count: 'desc',
  ref_count: 'desc',
  first_seen_at: 'desc',
  last_seen_at: 'desc',
};

export const DEFAULT_SORT: { key: SysLibSortKey; dir: SortDir } = {
  key: 'last_seen_at',
  dir: 'desc',
};

// 임계 SSoT(원본 동일).
export const SIZE_WARN_THRESHOLD = 16 * 1024;
export const SIZE_LARGE_THRESHOLD = 32 * 1024;
export const REF_HOT_RATIO = 0.25;

function cmpString(a: unknown, b: unknown): number {
  const sa = a == null ? '' : String(a);
  const sb = b == null ? '' : String(b);
  const collator = getCollator();
  return collator ? collator.compare(sa, sb) : sa.localeCompare(sb);
}
function cmpNumber(a: number | undefined, b: number | undefined): number {
  return (a ?? 0) - (b ?? 0);
}

const COMPARATORS: Record<SysLibSortKey, (a: SysLibRow, b: SysLibRow) => number> = {
  hash: (a, b) => cmpString(a.hash, b.hash),
  byte_size: (a, b) => cmpNumber(a.byte_size, b.byte_size),
  segment_count: (a, b) => cmpNumber(a.segment_count, b.segment_count),
  ref_count: (a, b) => cmpNumber(a.ref_count, b.ref_count),
  first_seen_at: (a, b) => cmpNumber(a.first_seen_at, b.first_seen_at),
  last_seen_at: (a, b) => cmpNumber(a.last_seen_at, b.last_seen_at),
};

/** 정렬 dispatcher — _rows 불변(slice). 미존재 키 → last_seen_at 폴백(원본 동일). */
export function applySort(
  rows: ReadonlyArray<SysLibRow>,
  key: SysLibSortKey,
  dir: SortDir = 'desc',
): SysLibRow[] {
  const cmp = COMPARATORS[key] ?? COMPARATORS.last_seen_at;
  const factor = dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => factor * cmp(a, b));
}

/** 정렬 토글(원본 applySortChange 동치 — 순수 전이). */
export function nextSort(
  current: { key: SysLibSortKey; dir: SortDir },
  key: SysLibSortKey,
): { key: SysLibSortKey; dir: SortDir } {
  if (!SORTABLE_KEYS.has(key)) return current;
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: DEFAULT_DIR[key] ?? 'desc' };
}

/** byte_size 임계 클래스(원본 sizeClassFor): >32KB large / >16KB warn / else ''. */
export function sizeClassFor(n: number | null | undefined): string {
  if (typeof n !== 'number' || !isFinite(n)) return '';
  if (n > SIZE_LARGE_THRESHOLD) return 'syslib-size-large';
  if (n > SIZE_WARN_THRESHOLD) return 'syslib-size-warn';
  return '';
}

/** byte → '- / N B / N.N KB / N.NN MB'(원본 formatBytes). */
export function formatBytes(n: number | null | undefined): string {
  if (typeof n !== 'number' || !isFinite(n)) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** ms → 'YYYY-MM-DD HH:MM'(원본 formatTime, 로컬 타임존). 누락 → '-'. */
export function formatTime(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !isFinite(ms)) return '-';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * ref_count Top N% cutoff — sort key 가 ref_count 일 때만 의미(원본 ADR-007).
 * @returns 상위 hot 행 개수(다른 키면 0).
 */
export function refHotCutoff(sortKey: SysLibSortKey, rowCount: number): number {
  return sortKey === 'ref_count' ? Math.max(1, Math.ceil(rowCount * REF_HOT_RATIO)) : 0;
}
