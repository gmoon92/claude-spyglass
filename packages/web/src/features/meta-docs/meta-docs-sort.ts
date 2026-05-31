/**
 * features/meta-docs/meta-docs-sort.ts — 카탈로그 정렬/표시필터/검색/카운트 순수 로직 (P4-02)
 *
 * 원본: assets/js/meta-docs-view.js (applySort/COMPARATORS/DEFAULT_DIR/SORTABLE_KEYS:1247-1337,
 *   applyDisplayFilter:1223, computeRowCounts:437, applySearchFilter:1014, shortenPath:1339, formatTokens:1354).
 *  - 전역 모듈 state(sort/sortDir/display/searchTerm) → 순수 전이(인자 주입). 컴포넌트가 컨트롤드로 소비.
 *  - collator 는 i18n-utils getCollator(window-safe) 재사용 — syslib/tool-stats 정렬과 통일.
 *  - null/orphan 끝자리 정책(source null / last_used_at null) + 동률 보조키(type→inv desc,
 *    invocations→last_used_at)를 dir-aware 부호로 1:1 보존(회귀 게이트, done_criteria "검색 필터 회귀 0").
 *  - applySearchFilter 의 DOM row.hidden 토글은 React 에서 파생 가시성으로 — visibleBySearch(name,term) 동치.
 *
 * @module features/meta-docs/meta-docs-sort
 */
import { getCollator } from '../../../assets/js/i18n-utils.js';

/**
 * 카탈로그 행(/api/meta-docs). id==null → orphan(호출만 존재), invocations==0 && id!=null → unused.
 * 서버 응답 passthrough — 정렬/필터에 쓰는 최소 필드만 선언, 나머지(deleted_at 등)는 index signature 로 보존.
 */
export interface MetaDocRow {
  id?: number | string | null;
  type?: string | null;
  name?: string | null;
  source?: string | null;
  source_root?: string | null;
  source_root_exists?: boolean | null;
  file_path?: string | null;
  invocations?: number | null;
  last_used_at?: number | null;
  total_tokens?: number | null;
  deleted_at?: number | string | null;
  description?: string | null;
  [k: string]: unknown;
}

export type MetaDocSortKey = 'type' | 'name' | 'source' | 'invocations' | 'last_used_at' | 'total_tokens';
export type SortDir = 'asc' | 'desc';
export type DisplayFilter = 'all' | 'unused' | 'orphan';

/** 정렬 가능 컬럼 SSoT (view.js:1247). */
export const SORTABLE_KEYS: ReadonlySet<MetaDocSortKey> = new Set<MetaDocSortKey>([
  'type', 'name', 'source', 'invocations', 'last_used_at', 'total_tokens',
]);

/** 컬럼별 기본 정렬 방향 — 텍스트 asc, 숫자/시간 desc (view.js:1252). */
export const DEFAULT_DIR: Record<MetaDocSortKey, SortDir> = {
  type: 'asc',
  name: 'asc',
  source: 'asc',
  invocations: 'desc',
  last_used_at: 'desc',
  total_tokens: 'desc',
};

/** 초기 정렬 — invocations desc (view.js:56-57). */
export const DEFAULT_SORT: { key: MetaDocSortKey; dir: SortDir } = { key: 'invocations', dir: 'desc' };

/** 문자열 비교 — 활성 i18n collator(i18n-utils SSoT 재사용). (view.js:1262) */
function cmpString(a: unknown, b: unknown): number {
  const sa = a == null ? '' : String(a);
  const sb = b == null ? '' : String(b);
  const collator = getCollator();
  return collator ? collator.compare(sa, sb) : sa.localeCompare(sb);
}
/** 숫자 비교(asc 기준). null/undefined → 0 (view.js:1269). */
function cmpNumber(a: number | null | undefined, b: number | null | undefined): number {
  return (a ?? 0) - (b ?? 0);
}

/**
 * 컬럼별 비교 함수 맵 — (a,b,dir) → asc 기준 부호. (view.js:1280)
 * "데이터 없는 행 항상 끝" 정책 컬럼(source/last_used_at)은 내부에서 dir-aware 부호(±1)를 반환해
 * dispatcher 의 factor 반전을 흡수한다(asc/desc 어느 쪽이든 끝 유지).
 */
const COMPARATORS: Record<MetaDocSortKey, (a: MetaDocRow, b: MetaDocRow, dir: SortDir) => number> = {
  type: (a, b) => {
    const primary = cmpString(a.type, b.type);
    if (primary !== 0) return primary;
    // 동률 시 invocations desc 보조 (view.js:1285).
    return -cmpNumber(a.invocations, b.invocations);
  },
  name: (a, b) => cmpString(a.name, b.name),
  source: (a, b, dir) => {
    const orphanA = a.source == null;
    const orphanB = b.source == null;
    if (orphanA && orphanB) return 0;
    if (orphanA || orphanB) {
      const sign = dir === 'desc' ? -1 : 1;
      return orphanA ? sign : -sign;
    }
    const primary = cmpString(a.source, b.source);
    if (primary !== 0) return primary;
    return cmpString(a.source_root ?? '', b.source_root ?? '');
  },
  invocations: (a, b) => {
    const primary = cmpNumber(a.invocations, b.invocations);
    if (primary !== 0) return primary;
    // 동률 시 last_used_at 보조 (view.js:1307).
    return cmpNumber(a.last_used_at, b.last_used_at);
  },
  last_used_at: (a, b, dir) => {
    const va = a.last_used_at;
    const vb = b.last_used_at;
    const nullA = va == null;
    const nullB = vb == null;
    if (nullA && nullB) return 0;
    if (nullA || nullB) {
      const sign = dir === 'desc' ? -1 : 1;
      return nullA ? sign : -sign;
    }
    return cmpNumber(va, vb);
  },
  total_tokens: (a, b) => cmpNumber(a.total_tokens, b.total_tokens),
};

/**
 * 정렬 dispatcher — sort 키/dir 만 받아 새 배열 반환(원본 불변, slice). (view.js:1330)
 * COMPARATORS 미존재 키는 invocations 폴백.
 */
export function applySort(
  rows: ReadonlyArray<MetaDocRow>,
  sort: MetaDocSortKey | string,
  dir: SortDir = 'desc',
): MetaDocRow[] {
  const cmp = COMPARATORS[sort as MetaDocSortKey] ?? COMPARATORS.invocations;
  const factor = dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => factor * cmp(a, b, dir));
}

/** 정렬 토글 전이 — applyFilterChange('sort') 동치(순수). (view.js:1049-1058) */
export function nextSort(
  current: { key: MetaDocSortKey; dir: SortDir },
  key: MetaDocSortKey | string,
): { key: MetaDocSortKey; dir: SortDir } {
  if (!SORTABLE_KEYS.has(key as MetaDocSortKey)) return current;
  const k = key as MetaDocSortKey;
  if (current.key === k) return { key: k, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key: k, dir: DEFAULT_DIR[k] ?? 'desc' };
}

/**
 * 표시 필터 — 행 부분집합 선택(단일 책임). (view.js:1223)
 *  - all    : 전체
 *  - unused : id!=null && invocations===0
 *  - orphan : id==null
 */
export function applyDisplayFilter(rows: ReadonlyArray<MetaDocRow>, display: DisplayFilter): MetaDocRow[] {
  if (display === 'unused') return rows.filter((r) => r.id != null && (r.invocations ?? 0) === 0);
  if (display === 'orphan') return rows.filter((r) => r.id == null);
  return rows.slice();
}

/** rows → {used,unused,orphan} 카운트(summary 카드 SSoT). (view.js:437) */
export function computeRowCounts(rows: ReadonlyArray<MetaDocRow>): { used: number; unused: number; orphan: number } {
  return {
    used: rows.filter((r) => (r.invocations ?? 0) > 0).length,
    unused: rows.filter((r) => r.id != null && (r.invocations ?? 0) === 0).length,
    orphan: rows.filter((r) => r.id == null).length,
  };
}

/**
 * 검색 가시성 — 이름 부분일치, 대소문자/공백 무시(원본 DOM row.hidden 토글 동치). (view.js:1014-1019)
 * 빈 term 이면 항상 true(전체 표시). React 에서 derived visibility 로 사용.
 */
export function visibleBySearch(name: string | null | undefined, term: string): boolean {
  const t = (term ?? '').trim().toLowerCase();
  if (t.length === 0) return true;
  return String(name ?? '').toLowerCase().includes(t);
}

/** 경로 단축 — ~/ 치환 + 60자 초과 가운데 …. (view.js:1339) */
export function shortenPath(p: string | null | undefined): string {
  if (!p) return '';
  const home = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac') ? '/Users/' : '/home/';
  const idx = p.indexOf(home);
  if (idx >= 0) {
    const rest = p.slice(idx + home.length);
    const slash = rest.indexOf('/');
    if (slash > 0) return '~' + rest.slice(slash);
  }
  return p.length > 60 ? p.slice(0, 28) + '…' + p.slice(-30) : p;
}

/** 누적 토큰 포맷 — 0 / N.Nk / N.NM. (view.js:1354) */
export function formatTokens(n: number | null | undefined): string {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}
