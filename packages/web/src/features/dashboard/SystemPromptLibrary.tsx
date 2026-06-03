/**
 * features/dashboard/SystemPromptLibrary.tsx — System Prompt 라이브러리 표 (P3-09)
 *
 * 원본: assets/js/system-prompt-library.js renderHtml (#sysLibBody innerHTML, 8 사이트).
 *  - 6컬럼 표(Hash/Size/Seg/Ref/First/Last), 헤더 클릭 정렬, ref_count Top N% hot 강조,
 *    byte_size 임계 클래스. 행 클릭 → 본문 lazy-fetch 모달(모달은 호출처/후속 — onOpenRow 위임).
 *  - 본 컴포넌트는 표 마크업(syslib-*)을 JSX 로 렌더. 정렬/포맷/임계는 syslib-sort.ts(순수).
 *    정렬 상태는 prop(컨트롤드). col-resize/모달/lazy-fetch 는 슬롯·콜백으로 위임(병존).
 *
 * 셀렉터 계약 유지: syslib-table/syslib-row/syslib-hash/syslib-size-warn|large/syslib-ref-hot,
 *   data-syslib-sort/data-syslib-hash/aria-sort, num/sortable.
 *
 * @module features/dashboard/SystemPromptLibrary
 */
import type { ReactElement } from 'react';
import {
  applySort,
  sizeClassFor,
  formatBytes,
  formatTime,
  refHotCutoff,
  type SysLibRow,
  type SysLibSortKey,
  type SortDir,
} from './syslib-sort';

export type TFunc = (key: string, vars?: Record<string, unknown>) => string;

export interface SystemPromptLibraryProps {
  rows: SysLibRow[] | null;
  sort?: { key: SysLibSortKey; dir: SortDir };
  onSort?: (key: SysLibSortKey) => void;
  /** 행 클릭(본문 lazy-fetch 모달 — 호출처 위임). */
  onOpenRow?: (hash: string) => void;
  /** i18n t(필수 — DI). 호출처가 react-i18next t 주입, 테스트가 stub 주입. */
  t: TFunc;
}

const HEADERS: Array<{ key: SysLibSortKey; label: string; cls: string }> = [
  { key: 'hash', label: 'Hash', cls: '' },
  { key: 'byte_size', label: 'Size', cls: 'num' },
  { key: 'segment_count', label: 'Seg', cls: 'num' },
  { key: 'ref_count', label: 'Ref', cls: 'num' },
  { key: 'first_seen_at', label: 'First Seen', cls: '' },
  { key: 'last_seen_at', label: 'Last Seen', cls: '' },
];

const COL_WIDTHS = ['200px', '120px', '80px', '90px', '170px', '170px'];
const DEFAULT_SORT = { key: 'last_seen_at' as SysLibSortKey, dir: 'desc' as SortDir };

function ariaSort(
  current: { key: SysLibSortKey; dir: SortDir },
  key: SysLibSortKey,
): 'none' | 'ascending' | 'descending' {
  if (current.key !== key) return 'none';
  return current.dir === 'asc' ? 'ascending' : 'descending';
}

export function SystemPromptLibrary({
  rows,
  sort = DEFAULT_SORT,
  onSort,
  onOpenRow,
  t,
}: SystemPromptLibraryProps): ReactElement {
  if (!rows || rows.length === 0) {
    return (
      <div className="state-empty">
        <span className="state-empty-title">{t('ui.syslib.no-prompts')}</span>
      </div>
    );
  }

  const sorted = applySort(rows, sort.key, sort.dir);
  const hotCutoff = refHotCutoff(sort.key, sorted.length);

  return (
    <table className="syslib-table">
      <colgroup>
        {COL_WIDTHS.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {HEADERS.map((h) => {
            const active = sort.key === h.key;
            const dirCls = !active ? '' : sort.dir === 'asc' ? 'sort-asc' : 'sort-desc';
            const cls = `${h.cls} sortable ${dirCls}`.trim();
            const label = h.key === 'hash' ? 'Hash' : h.label;
            return (
              <th
                key={h.key}
                data-syslib-sort={h.key}
                className={cls}
                tabIndex={0}
                role="columnheader"
                aria-sort={ariaSort(sort, h.key)}
                onClick={onSort ? () => onSort(h.key) : undefined}
              >
                {label}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r, idx) => {
          const refClass = sort.key === 'ref_count' && idx < hotCutoff ? ' syslib-ref-hot' : '';
          const sizeClass = sizeClassFor(r.byte_size);
          return (
            <tr
              key={r.hash}
              className="syslib-row"
              data-syslib-hash={r.hash}
              tabIndex={0}
              role="button"
              aria-label={t('ui.syslib.view-prompt-aria')}
              onClick={onOpenRow ? () => onOpenRow(r.hash) : undefined}
            >
              <td className="syslib-hash">
                <code>{r.hash.slice(0, 12)}…</code>
              </td>
              <td className={`num${sizeClass ? ' ' + sizeClass : ''}`}>{formatBytes(r.byte_size)}</td>
              <td className="num">{r.segment_count ?? '-'}</td>
              <td className={`num${refClass}`}>
                <strong>{r.ref_count ?? 0}</strong>
              </td>
              <td>{formatTime(r.first_seen_at)}</td>
              <td>{formatTime(r.last_seen_at)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
