/**
 * components/FilterBar.tsx — 타입 필터 버튼 바 컴포넌트 (P2-08)
 *
 * 원본: assets/js/components/filter-bar.js createFilterBar.
 *  - 그룹 3개: all / request(prompt,system) / tool(tool_call,agent,skill,mcp) (filter-bar.js:9-32).
 *  - 버튼 마크업(:48-54): class="ds-filter-btn type-filter-btn type-filter-{key}[ active]",
 *    aria-pressed, data-strength="soft", data-{dataAttr}="{key}", title?(있을 때만).
 *  - 그룹 wrapper(:43-56): div.filter-group.filter-group--{group}, aria-label?(request/tool 만).
 *
 * 원본 대비 변경(신규 계약):
 *  - 명령형 createFilterBar(controller 반환, 내부 active 상태) → controlled React 컴포넌트.
 *    active(현재 필터 키)는 호출처가 app-store(feedFilter/detailFilter)에서 주입.
 *    클릭 시 onChange(key) 통지 → 호출처가 setFeedFilter/setDetailFilter 로 스토어 갱신.
 *  - 전역 window.I18n 의존 제거 → labeler(라벨/타이틀/그룹aria) 명시 prop 주입(무전역).
 *  - data-strength 는 원본 renderFilterBtn 기본 'soft'(filter-bar.js:48) 보존.
 *
 * 셀렉터 계약 유지(arch §2.2): filter-group(--{group}) / type-filter-btn / type-filter-{key}
 *   / active / aria-pressed / data-{dataAttr}. 향후 CSS·E2E 호환.
 *
 * @module components/FilterBar
 */

/** 필터 항목 — 키 + title 보유 여부(원본 filter-bar.js item 형태). */
export interface FilterItem {
  key: string;
  hasTitle: boolean;
}

/** 필터 그룹 — group 식별자 + aria 보유 여부 + 항목들(원본 getFilterGroups 구조 보존). */
export interface FilterGroup {
  group: 'all' | 'request' | 'tool';
  hasAria: boolean;
  items: FilterItem[];
}

/**
 * 그룹/항목 구조 SSoT — 원본 filter-bar.js getFilterGroups() 의 키/그룹 토폴로지 1:1.
 * 라벨/타이틀/aria 텍스트는 i18n 이라 여기 두지 않고 labeler 로 지연 평가(locale 전환 즉시 반영).
 */
export const FILTER_GROUPS: FilterGroup[] = [
  { group: 'all', hasAria: false, items: [{ key: 'all', hasTitle: false }] },
  {
    group: 'request',
    hasAria: true,
    items: [
      { key: 'prompt', hasTitle: true },
      { key: 'system', hasTitle: true },
    ],
  },
  {
    group: 'tool',
    hasAria: true,
    items: [
      { key: 'tool_call', hasTitle: true },
      { key: 'agent', hasTitle: true },
      { key: 'skill', hasTitle: true },
      { key: 'mcp', hasTitle: true },
    ],
  },
];

/** i18n 라벨러 — 컴포넌트 무전역. 호출처(features/app)가 react-i18next t 를 감싸 주입. */
export interface FilterBarLabeler {
  /** 그룹 aria-label(request/tool 만 호출됨). */
  groupAria: (group: string) => string;
  /** 항목 표시 라벨. */
  itemLabel: (key: string) => string;
  /** 항목 title(hasTitle=true 인 항목만 호출). */
  itemTitle: (key: string) => string;
}

export interface FilterBarProps {
  /** data-* 속성 접미사(예: 'feed-filter' / 'detail-filter'). 셀렉터 계약. */
  dataAttr: string;
  /** 현재 활성 필터 키(controlled). 호출처가 app-store 슬라이스에서 주입. */
  active: string;
  /** i18n 라벨러. */
  labeler: FilterBarLabeler;
  /** 필터 변경 통지. 호출처가 setFeedFilter/setDetailFilter 로 스토어 갱신. */
  onChange?: (filter: string) => void;
}

export function FilterBar({ dataAttr, active, labeler, onChange }: FilterBarProps) {
  return (
    <>
      {FILTER_GROUPS.map((g) => (
        <div
          key={g.group}
          className={`filter-group filter-group--${g.group}`}
          {...(g.hasAria ? { 'aria-label': labeler.groupAria(g.group) } : {})}
        >
          {g.items.map((item) => {
            const isActive = item.key === active;
            // 원본 클래스 합성(:53): ds-filter-btn type-filter-btn type-filter-{key}[ active].
            const cls = `ds-filter-btn type-filter-btn type-filter-${item.key}${isActive ? ' active' : ''}`;
            return (
              <button
                key={item.key}
                className={cls}
                type="button"
                aria-pressed={isActive ? 'true' : 'false'}
                data-strength="soft"
                {...{ [`data-${dataAttr}`]: item.key }}
                {...(item.hasTitle ? { title: labeler.itemTitle(item.key) } : {})}
                onClick={() => onChange?.(item.key)}
              >
                {labeler.itemLabel(item.key)}
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}
