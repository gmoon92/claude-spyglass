/**
 * features/dashboard/ToolStatsMatrix.tsx — 프로젝트 도구별 성능 매트릭스 (P3-09)
 *
 * 원본: assets/js/tool-stats.js renderMatrix (#metaToolStatsBody innerHTML, 6 사이트).
 *  - 1행 1도구, 6컬럼(Tool/Avg/Calls/Tokens/%/Err). 헤더 클릭 정렬(컨트롤드).
 *  - 본 컴포넌트는 동일 마크업(ts-mx-*)을 JSX 로 렌더. 산술/정렬은 tool-stats-view.ts /
 *    tool-stats-sort.ts(순수). 정렬 상태는 prop(컨트롤드 — 원본 모듈 전역 폐기, 데이터 역전).
 *  - 도구 아이콘(renderers.toolIconHtml)·정렬 헤더(renderSortHead) 는 아직 .js(P5-01/P2-03 소유)라
 *    renderIcon/renderHead 슬롯으로 주입(병존). 미주입이면 텍스트 폴백.
 *
 * 셀렉터 계약 유지: ts-mx/ts-mx-head/ts-mx-row/ts-mx-cell/ts-mx-num/ts-err-cell,
 *   ds-bar-fill/data-tone, data-ts-sort, aria-sort, mini-badge/ds-badge.
 *
 * @module features/dashboard/ToolStatsMatrix
 */
import type { ReactElement, ReactNode } from 'react';
import { fmtToken } from '../../../assets/js/formatters.js';
import { SkeletonRows } from '../../components/Skeleton';
import { computeMatrixView } from './tool-stats-view';
import {
  applySort,
  fmtDur,
  sortState,
  ariaSortValue,
  type ToolStatRow,
  type ToolStatsSortKey,
  type SortDir,
} from './tool-stats-sort';

export type TFunc = (key: string, vars?: Record<string, unknown>) => string;
declare const window: { I18n?: { t?: TFunc } };
const defaultT: TFunc = (k, vars) => window.I18n?.t?.(k, vars) ?? k;

export interface ToolStatsMatrixProps {
  stats: ToolStatRow[] | null;
  sort?: { key: ToolStatsSortKey; dir: SortDir };
  /** 헤더 클릭 → 정렬 전이(호출처가 nextSort 적용). */
  onSort?: (key: ToolStatsSortKey) => void;
  t?: TFunc;
  /** 도구 아이콘 슬롯(원본 toolIconHtml). 미주입 시 폴백 없음(텍스트만). */
  renderIcon?: (toolName: string) => ReactNode;
  /** fetch 대기 중 여부 — true 면 빈 상태("데이터 없음") 대신 스켈레톤(로딩 오해 방지). */
  loading?: boolean;
}

const HEADERS: Array<{ key: ToolStatsSortKey; label: string; cls: string }> = [
  { key: 'tool', label: 'Tool', cls: 'ts-mx-tool' },
  { key: 'avg', label: 'ui.tool-stats.col-avg', cls: 'ts-mx-num' },
  { key: 'calls', label: 'ui.tool-stats.col-calls', cls: 'ts-mx-num' },
  { key: 'tokens', label: 'ui.tool-stats.col-tokens', cls: 'ts-mx-num' },
  { key: 'pct', label: 'ui.tool-stats.col-pct', cls: 'ts-mx-num' },
  { key: 'errors', label: 'ui.tool-stats.col-errors', cls: 'ts-mx-err' },
];

const DEFAULT_SORT = { key: 'tokens' as ToolStatsSortKey, dir: 'desc' as SortDir };

export function ToolStatsMatrix({
  stats,
  sort = DEFAULT_SORT,
  onSort,
  t = defaultT,
  renderIcon,
  loading = false,
}: ToolStatsMatrixProps): ReactElement {
  // 로딩 중(아직 데이터 없음) → 스켈레톤. "데이터 없음" 빈 상태가 fetch 대기 중 뜨는 오해를 막는다.
  if (loading && (!stats || stats.length === 0)) {
    return <SkeletonRows rows={6} className="ts-mx-skeleton" />;
  }
  if (!stats || stats.length === 0) {
    return (
      <div className="state-empty">
        <span className="state-empty-title">{t('ui.tool-stats.no-data')}</span>
      </div>
    );
  }

  const sorted = applySort(stats, sort.key, sort.dir);
  const view = computeMatrixView(sorted);

  return (
    <div className="ts-mx">
      <div className="ts-mx-head">
        {HEADERS.map((h) => {
          const state = sortState(sort, h.key);
          const dirCls = state === 'idle' ? '' : state === 'asc' ? 'sort-asc' : 'sort-desc';
          const cls = `ts-mx-cell ${h.cls} sortable ${dirCls}`.trim();
          const label = h.key === 'tool' ? 'Tool' : t(h.label);
          return (
            <div
              key={h.key}
              data-ts-sort={h.key}
              className={cls}
              tabIndex={0}
              role="columnheader"
              aria-sort={ariaSortValue(sort, h.key)}
              onClick={onSort ? () => onSort(h.key) : undefined}
            >
              {label}
            </div>
          );
        })}
      </div>
      <div className="ts-mx-body">
        {view.rows.map((r, i) => (
          <div className="ts-mx-row" key={i}>
            <div className="ts-mx-cell ts-mx-tool">
              {renderIcon?.(r.toolName)}
              <span className="ts-mx-tool-name" title={r.toolName}>
                {r.toolName}
                {r.hasLowConf ? (
                  <sup className="confidence-low-mark" title={t(r.confTipKey)}>
                    *
                  </sup>
                ) : null}
              </span>
            </div>
            <div
              className="ts-mx-cell ts-mx-num"
              {...(r.durUnavailable
                ? { 'data-duration-unavailable': 'true', title: 'duration unavailable for older data' }
                : {})}
            >
              <span className="ts-mx-val">{fmtDur(r.durMs)}</span>
              <span className="ts-mx-bar ds-bar-track">
                <span
                  className="ts-mx-bar-fill ts-mx-bar-fill--avg ds-bar-fill"
                  data-tone="warn"
                  style={{ width: `${r.durBarPct}%` }}
                />
              </span>
            </div>
            <div className="ts-mx-cell ts-mx-num">
              <span className="ts-mx-val">{r.callCount}</span>
              <span className="ts-mx-bar ds-bar-track">
                <span
                  className="ts-mx-bar-fill ts-mx-bar-fill--calls ds-bar-fill"
                  data-tone="success"
                  style={{ width: `${r.callPct}%` }}
                />
              </span>
            </div>
            <div className="ts-mx-cell ts-mx-num">
              <span className="ts-mx-val">{fmtToken((stats && sorted[i]?.total_tokens) ?? 0)}</span>
              <span className="ts-mx-sub">{r.tokPct.toFixed(1)}%</span>
            </div>
            <div className="ts-mx-cell ts-mx-num">
              <span className="ts-mx-bar ds-bar-track">
                <span
                  className="ts-mx-bar-fill ts-mx-bar-fill--tokens ds-bar-fill"
                  data-tone="brand"
                  style={{ width: `${r.tokBarPct}%` }}
                />
              </span>
            </div>
            <div className="ts-mx-cell ts-mx-err">
              {r.errorCount > 0 ? (
                <span className="ts-err-cell">
                  <span className="mini-badge badge-error ds-badge" data-tone="error">
                    {r.errorCount}
                  </span>
                </span>
              ) : (
                <span className="ts-err-cell ts-err-cell--none">—</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
