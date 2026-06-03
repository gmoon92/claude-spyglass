/**
 * features/meta-docs/MetaDocsCatalog.tsx — Behavior Definitions 카탈로그 테이블 (P4-02)
 *
 * 원본: assets/js/meta-docs-view.js renderHtml/thHtml/rowHtml/pathCellHtml (view.js:647-834).
 *  - 6컬럼 정렬·리사이즈 테이블(type/name/source/invocations/last_used_at/total_tokens).
 *  - 정렬/표시필터/검색가시성은 meta-docs-sort.ts(순수) 위임 — 컴포넌트 인라인 재구현 금지(arch §2.1).
 *  - 컨트롤드 leaf: sort/display/searchTerm props. 정렬 클릭 → onSort(key)(호출처가 nextSort 로 전이).
 *    행 클릭 → onRowClick(row)(P4-03 flow 재중심 계약 — activeRow 단방향). store 무참조.
 *  - thead 셀 내부는 design-system SortHead 위임(view.js:717 renderSortHead 1:1). col-resize 는
 *    P4-03 셸이 useRef 로 부착(병존) — 본 컴포넌트는 마크업 계약만.
 *  - 검색: 원본 applySearchFilter 의 DOM row.hidden 토글(view.js:1019)을 hidden 속성으로 1:1 — re-fetch 없음.
 *  - SSoT 위임: 타입 배지 MetaDocTypeBadge(toolIconHtml 경유), 경로 단축 shortenPath, 토큰 formatTokens.
 *
 * 셀렉터 계약 유지: meta-docs-table / meta-doc-row / meta-doc-{orphan,unused,deleted} /
 *   data-meta-sort / data-type / data-name / aria-sort / sort-asc|desc / num / meta-doc-source-orphan.
 *
 * @module features/meta-docs/MetaDocsCatalog
 */
import type { ReactElement, RefObject } from 'react';
import { SortHead, type SortState } from '../../components/design-system/markers/SortHead';
import { SkeletonRows } from '../../components/Skeleton';
import { MetaDocTypeBadge } from './MetaDocTypeBadge';
import {
  applyDisplayFilter,
  applySort,
  visibleBySearch,
  shortenPath,
  formatTokens,
  DEFAULT_SORT,
  type MetaDocRow,
  type MetaDocSortKey,
  type SortDir,
  type DisplayFilter,
} from './meta-docs-sort';

export type TFunc = (key: string, vars?: Record<string, unknown>) => string;

/** fmtTime 동치 — 원본 formatters.fmtTime(로컬 'YYYY-MM-DD HH:MM'). 누락 → null(호출처 '—'). */
function fmtTime(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !isFinite(ms)) return null;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface MetaDocsCatalogProps {
  /** 카탈로그 행(서버 fetch 결과 — scope 필터/orphan 숨김 적용 후). */
  rows: MetaDocRow[];
  /** 정렬 상태(컨트롤드). 미지정 → invocations desc(원본 기본). */
  sort?: { key: MetaDocSortKey; dir: SortDir };
  /** 표시 필터(컨트롤드). 미지정 → all. */
  display?: DisplayFilter;
  /** 검색어(컨트롤드). 비매칭 행은 hidden(원본 applySearchFilter 동치). */
  searchTerm?: string;
  /** 빈 상태 분기 — project 선택값(매칭 실패 안내). */
  project?: string | null;
  /** 빈 상태 분기 — source_root 매칭 여부. */
  matched?: boolean;
  /** 정렬 헤더 클릭 통지(호출처가 nextSort 로 전이 후 sort prop 갱신). */
  onSort?: (key: MetaDocSortKey) => void;
  /** 행 클릭 통지(P4-03 flow 재중심 — orphan 은 호출처가 무시). */
  onRowClick?: (row: MetaDocRow) => void;
  /** 활성 flow 행 식별(data-flow-active 표시 — P4-03 단방향 계약). name 매칭. */
  activeRowName?: string | null;
  /** 카탈로그 <table> ref — 호출처(MetaDocsLayout)가 useColResize 로 컬럼 리사이즈 부착(병존). */
  tableRef?: RefObject<HTMLTableElement>;
  /** fetch 대기 중 여부 — 미로드 시 스켈레톤(빈 상태 오해 방지). */
  loading?: boolean;
  /** i18n t(필수 — DI). 호출처가 react-i18next t 주입, 테스트가 stub 주입. */
  t: TFunc;
}

const HEADERS: Array<{ key: MetaDocSortKey; label: string; cls: string }> = [
  { key: 'type', label: 'ui.meta-docs-view.col-type', cls: '' },
  { key: 'name', label: 'ui.meta-docs-view.col-name', cls: '' },
  { key: 'source', label: 'ui.meta-docs-view.col-source', cls: '' },
  { key: 'invocations', label: 'ui.meta-docs-view.col-invocations', cls: 'num' },
  { key: 'last_used_at', label: 'ui.meta-docs-view.col-last-used', cls: '' },
  { key: 'total_tokens', label: 'ui.meta-docs-view.col-total-tokens', cls: 'num' },
];

const COL_WIDTHS = ['96px', '180px', '280px', '70px', '150px', '100px'];

/** 컬럼 정렬 상태 → SortHead SortState(idle/asc/desc). (view.js:733) */
function sortStateFor(sort: { key: MetaDocSortKey; dir: SortDir }, key: MetaDocSortKey): SortState {
  if (sort.key !== key) return 'idle';
  return sort.dir === 'asc' ? 'asc' : 'desc';
}
/** th active 클래스(view.js:739). */
function sortHeaderCls(sort: { key: MetaDocSortKey; dir: SortDir }, key: MetaDocSortKey): string {
  if (sort.key !== key) return '';
  return sort.dir === 'asc' ? 'sort-asc' : 'sort-desc';
}
/** aria-sort 값(view.js:744). */
function ariaSortValue(
  sort: { key: MetaDocSortKey; dir: SortDir },
  key: MetaDocSortKey,
): 'none' | 'ascending' | 'descending' {
  if (sort.key !== key) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
}

/** 경로 셀 — file_path 우선, 없으면 source_root, 둘 다 없으면 —. (view.js:830) */
function PathCell({ row }: { row: MetaDocRow }): ReactElement {
  const path = row.file_path || row.source_root || null;
  if (!path) return <span className="meta-doc-na">—</span>;
  return (
    <span className="meta-doc-source-root" title={String(path)}>
      {shortenPath(String(path))}
    </span>
  );
}

export function MetaDocsCatalog({
  rows,
  sort = DEFAULT_SORT,
  display = 'all',
  searchTerm = '',
  project = null,
  matched = false,
  onSort,
  onRowClick,
  activeRowName = null,
  tableRef,
  loading = false,
  t,
}: MetaDocsCatalogProps): ReactElement {
  // 표시필터 → 정렬(순수 lib). 원본 loadMetaDocsLibrary 순서(view.js:521-522) 동치.
  const filtered = applyDisplayFilter(rows, display);
  const sorted = applySort(filtered, sort.key, sort.dir);

  // 로딩 중(아직 데이터 없음) → 스켈레톤. "데이터 없음" 빈 상태가 fetch 대기 중 뜨는 오해를 막는다.
  if (loading && sorted.length === 0) {
    return <SkeletonRows rows={8} className="meta-docs-catalog-skeleton" />;
  }

  // 빈 상태 — 프로젝트 미매칭/미동기화 (view.js:665-673).
  if (sorted.length === 0) {
    const empty =
      project && !matched ? (
        <div className="state-empty">
          <span className="state-empty-title">
            {t('ui.meta-docs-view.empty-project-title', { project })}
          </span>
          <span className="state-empty-hint">{t('ui.meta-docs-view.empty-project-hint')}</span>
        </div>
      ) : (
        <div className="state-empty">
          <span className="state-empty-title">{t('ui.meta-docs-view.empty-global-title')}</span>
        </div>
      );
    return <>{empty}</>;
  }

  return (
    <table className="meta-docs-table" ref={tableRef}>
      <colgroup>
        {COL_WIDTHS.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {HEADERS.map((h) => {
            const cls = `${h.cls} sortable ${sortHeaderCls(sort, h.key)}`.trim();
            return (
              <th
                key={h.key}
                data-meta-sort={h.key}
                className={cls}
                tabIndex={0}
                role="columnheader"
                aria-sort={ariaSortValue(sort, h.key)}
                onClick={onSort ? () => onSort(h.key) : undefined}
              >
                <SortHead label={t(h.label)} sort={sortStateFor(sort, h.key)} sortKey={h.key} />
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r, idx) => {
          const orphan = r.id == null;
          const deleted = r.deleted_at != null;
          const unused = !orphan && (r.invocations ?? 0) === 0;
          const cls = ['meta-doc-row', orphan ? 'meta-doc-orphan' : '', deleted ? 'meta-doc-deleted' : '', unused ? 'meta-doc-unused' : '']
            .filter(Boolean)
            .join(' ');
          const inv = r.invocations ?? 0;
          const lastUsedStr = fmtTime(r.last_used_at);
          const tokens = formatTokens(r.total_tokens ?? 0);
          const hidden = !visibleBySearch(r.name, searchTerm);
          const isActive = activeRowName != null && r.name === activeRowName;
          // orphan 은 flow 재중심 불가(view.js:969) → 클릭 통지하되 호출처가 무시.
          const rowKey = r.id != null ? `id:${r.id}` : `orphan:${r.name}:${idx}`;
          return (
            <tr
              key={rowKey}
              className={cls}
              data-type={String(r.type ?? '')}
              data-name={String(r.name ?? '')}
              {...(r.description ? { title: String(r.description) } : {})}
              {...(hidden ? { hidden: true } : {})}
              {...(isActive ? { 'data-flow-active': '1' } : {})}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
            >
              <td>
                <MetaDocTypeBadge type={r.type} />
              </td>
              <td>
                <span className="meta-doc-name">{String(r.name ?? '')}</span>
              </td>
              <td>
                {orphan ? (
                  <span
                    className="meta-doc-source-orphan"
                    title={t('ui.meta-docs-view.orphan-tooltip')}
                    tabIndex={0}
                  >
                    {t('ui.meta-docs-view.orphan-path-label')}
                  </span>
                ) : (
                  <PathCell row={r} />
                )}
              </td>
              <td className="num">{inv.toLocaleString()}</td>
              <td>{lastUsedStr ?? <span className="meta-doc-na">—</span>}</td>
              <td className="num">{tokens}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
