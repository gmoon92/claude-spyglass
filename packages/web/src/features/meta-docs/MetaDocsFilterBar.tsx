/**
 * features/meta-docs/MetaDocsFilterBar.tsx — 타입/표시/includeDeleted 필터 바 (P4-02)
 *
 * 원본: assets/js/meta-docs-view.js renderFilters (view.js:836-908).
 *  - type 그룹(all/agent/skill/command) + display 그룹(all/unused/orphan) + includeDeleted 체크박스(직교).
 *  - 컨트롤드 leaf: type/display/includeDeleted props. 클릭 → onFilterChange(group,value) /
 *    토글 → onIncludeDeletedChange(bool). store 무참조 — 호출처(셸)가 상태 갱신.
 *  - 원본의 renderFilterBtn(...).replace() 문자열 후처리는 이식 금지(arch §2.1) → className/data-* 직접 부여.
 *    셀렉터 계약 보존: meta-doc-filter-btn / active / data-meta-filter / data-value / data-meta-include-deleted.
 *  - P2-08 FilterBar 는 feed/detail(request/tool) 토폴로지 전용이라 meta-docs type/display 와 불일치 →
 *    동일 controlled 패턴을 따르되 meta-docs 전용 그룹 구조로 구성.
 *  - includeDeleted 휴지통 SVG: 원본 svgTrash({size:12}) 마크업 1:1(stroke-only, currentColor 상속).
 *
 * @module features/meta-docs/MetaDocsFilterBar
 */
import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { DisplayFilter } from './meta-docs-sort';

export type TypeFilter = 'all' | 'agent' | 'skill' | 'command';
export type MetaFilterGroup = 'type' | 'display';

export interface MetaDocsFilterBarProps {
  /** 활성 타입 필터(컨트롤드). */
  type: TypeFilter;
  /** 활성 표시 필터(컨트롤드). */
  display: DisplayFilter;
  /** soft-deleted 포함 토글(컨트롤드). */
  includeDeleted: boolean;
  /**
   * orphan(미등록 호출) 필터 버튼 노출 여부. 기본 true(기존 동작 보존).
   * 호출처가 "orphan 0건이면 숨김(단 현재 orphan 필터 활성 시엔 유지)"을 계산해 전달 —
   * 평상시 UI 노이즈를 줄이되, 미등록 호출(정합성 신호)이 생기면 자동 노출되는 센서 동작.
   */
  showOrphan?: boolean;
  /** 필터 버튼 클릭 통지(type/display). */
  onFilterChange?: (group: MetaFilterGroup, value: string) => void;
  /** includeDeleted 토글 통지. */
  onIncludeDeletedChange?: (checked: boolean) => void;
}

/** 원본 svgTrash({size:12}) 1:1 — stroke-only 휴지통. */
function TrashIcon(): ReactElement {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4.5h10" />
      <path d="M6.5 4.5V3h3v1.5" />
      <path d="M4.5 4.5l.6 8.5a1 1 0 0 0 1 .95h3.8a1 1 0 0 0 1-.95l.6-8.5" />
      <path d="M7 7v4M9 7v4" />
    </svg>
  );
}

interface FilterBtnDef {
  v: string;
  label: string;
}

/** 필터 버튼 1개 — 원본 btn() 합성(view.js:858) 동치(.replace 미사용, 직접 부여). */
function FilterBtn({
  group,
  def,
  active,
  onClick,
}: {
  group: MetaFilterGroup;
  def: FilterBtnDef;
  active: boolean;
  onClick?: () => void;
}): ReactElement {
  const cls = `ds-filter-btn meta-doc-filter-btn${active ? ' active' : ''}`;
  return (
    <button
      className={cls}
      type="button"
      aria-pressed={active ? 'true' : 'false'}
      data-strength="strong"
      data-meta-filter={group}
      data-value={def.v}
      onClick={onClick}
    >
      {def.label}
    </button>
  );
}

// memo: type/display/콜백 불변(검색 입력 등) 시 필터 버튼 재렌더를 건너뛴다.
export const MetaDocsFilterBar = memo(function MetaDocsFilterBar({
  type,
  display,
  includeDeleted,
  showOrphan = true,
  onFilterChange,
  onIncludeDeletedChange,
}: MetaDocsFilterBarProps): ReactElement {
  const { t } = useTranslation();
  const types: FilterBtnDef[] = [
    { v: 'all', label: t('ui:meta-docs-view.filter-all') },
    { v: 'agent', label: 'Agent' },
    { v: 'skill', label: 'Skill' },
    { v: 'command', label: 'Command' },
  ];
  // orphan(미등록 호출)은 showOrphan 일 때만 노출 — 0건이면 호출처가 숨긴다.
  const displays: FilterBtnDef[] = [
    { v: 'all', label: t('ui:meta-docs-view.filter-all') },
    { v: 'unused', label: t('ui:meta-docs-view.filter-unused') },
    ...(showOrphan ? [{ v: 'orphan', label: t('ui:meta-docs-view.filter-orphan') }] : []),
  ];

  return (
    <div className="meta-docs-filters">
      <div className="meta-docs-filter-group">
        <span className="meta-docs-filter-label">{t('ui:meta-docs-view.filter-type-label')}</span>
        {types.map((d) => (
          <FilterBtn
            key={d.v}
            group="type"
            def={d}
            active={d.v === type}
            onClick={onFilterChange ? () => onFilterChange('type', d.v) : undefined}
          />
        ))}
      </div>
      <div className="meta-docs-filter-group">
        <span className="meta-docs-filter-label">{t('ui:meta-docs-view.filter-display-label')}</span>
        {displays.map((d) => (
          <FilterBtn
            key={d.v}
            group="display"
            def={d}
            active={d.v === display}
            onClick={onFilterChange ? () => onFilterChange('display', d.v) : undefined}
          />
        ))}
      </div>
      <label className="meta-docs-include-deleted" data-tip={t('ui:meta-docs-view.include-deleted-title')}>
        <input
          type="checkbox"
          data-meta-include-deleted
          checked={includeDeleted}
          onChange={(e) => onIncludeDeletedChange?.(e.currentTarget.checked)}
        />
        <span className="meta-docs-include-deleted-icon" aria-hidden="true">
          <TrashIcon />
        </span>
        <span className="meta-docs-include-deleted-label">{t('ui:meta-docs-view.include-deleted-label')}</span>
      </label>
    </div>
  );
});
