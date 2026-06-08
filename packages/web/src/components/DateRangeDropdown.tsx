/**
 * components/DateRangeDropdown.tsx — 날짜 범위 드롭다운 컴포넌트 (P2-08)
 *
 * 원본: assets/js/components/date-range-dropdown.js mountDateRangeDropdown.
 *  - combobox(trigger) + listbox(menu) + option(item) 패턴, WAI-ARIA 1.2 (date-range-dropdown.js:4-9).
 *  - 프리셋 6개: 1h/today/yesterday/7d/30d/all (:24 PRESETS).
 *  - 트리거 라벨/aria-selected 동기화는 활성 range 기준(:84-97 syncFromState).
 *  - custom range footer: from/to input + apply 버튼, listbox 외부(:278-296 renderShell).
 *
 * 원본 대비 변경(신규 계약):
 *  - 명령형 mount(container.innerHTML 주입 + 전역 document 리스너) → controlled React 컴포넌트.
 *    활성 range 의 SSoT 는 호출처(app-store activeRange 슬라이스, api.js setActiveRange/getActiveRange).
 *    컴포넌트는 activeRange prop 으로 라벨/aria-selected 를 그리고, 선택 시 콜백으로 통지만 한다.
 *  - 키보드/포커스/외부클릭/floating 위치 계산 등 명령형 상호작용은 후속 페이즈(hooks)로 분리.
 *    본 컴포넌트는 "DOM 계약 + 스토어 연동" 범위(P2-08)에 한정 — open/close 상태는 hidden 토글 prop.
 *  - i18n 은 react-i18next useTranslation 으로 직접 구독(ui.main.date-filter.* 키). custom 트리거
 *    라벨(formatCustom)은 locale 무관 ISO(YYYY-MM-DD) 포맷이라 모듈 순수 헬퍼로 캡슐화.
 *  - custom from/to 는 controlled state(useState) — 과거 apply 핸들러가 closest('.ds-dropdown-footer')
 *    + querySelector('[data-role=custom-from/to]') 로 DOM 을 역참조해 input 값을 읽던 명령형을 폐기하고,
 *    React state(customFrom/customTo)를 직접 읽는다(DOM 역참조 제거 — 선언형 controlled 입력).
 *  - floating 위치는 menuStyle prop(useFloatingMenuPosition 반환 CSSProperties)을 .ds-dropdown-menu 의
 *    JSX style 로 바인딩 — 훅이 menu.style 을 직접 변형하던 결선 폐기(소비처가 style 주입).
 *
 * 셀렉터 계약 유지(arch §2.2): ds-dropdown(data-component) / ds-dropdown-trigger(role=combobox)
 *   / ds-dropdown-listbox(role=listbox) / ds-dropdown-item(role=option, data-value, aria-selected)
 *   / data-role="custom-from|custom-to|custom-apply|custom-warn".
 *
 * date-range 회귀 0: 원본 .js 무수정·병존. PresetValue/ActiveRange 형태는 app-store 와 동일.
 *
 * @module components/DateRangeDropdown
 */
import { useState, type CSSProperties, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActiveRange, PresetValue } from '../stores/app-store';

/** 프리셋 순서 SSoT — 원본 date-range-dropdown.js:24 PRESETS 1:1 (custom 은 footer 로 분리). */
export const DATE_RANGE_PRESETS: PresetValue[] = ['1h', 'today', 'yesterday', '7d', '30d', 'all'];

export interface DateRangeDropdownProps {
  /** 활성 range(controlled). 호출처가 app-store.activeRange 를 주입. null 은 'all' 로 폴백 표시. */
  activeRange: ActiveRange;
  /** 메뉴 열림 여부(명령형 상호작용은 후속 hooks; 본 컴포넌트는 표현만). 기본 닫힘(hidden). */
  open?: boolean;
  /** 트리거 id(aria-controls 연결). 기본 'cs-date-range-trigger'. */
  triggerId?: string;
  /** 메뉴 id. 기본 'cs-date-range-menu'. */
  menuId?: string;
  /** 프리셋 선택 통지. 호출처가 setActiveRange({type:'preset',value}) 로 스토어 갱신. */
  onSelectPreset?: (value: PresetValue) => void;
  /** custom range 적용 통지. 호출처가 setActiveRange({type:'custom',from,to}) 로 스토어 갱신. */
  onApplyCustom?: (from: number, to: number) => void;
  /** 트리거 ref — 호출처가 useFloatingMenuPosition 으로 메뉴 위치를 계산하기 위해 주입(선택). */
  triggerRef?: RefObject<HTMLButtonElement>;
  /** 메뉴(fixed) ref — 위치 계산 대상(크기 실측). 미주입 시 메뉴는 dropdown.css 기본 top/left(0,0). */
  menuRef?: RefObject<HTMLDivElement>;
  /** 메뉴(fixed) 인라인 style — 호출처가 useFloatingMenuPosition 반환값을 주입. 미주입 시 css 기본값. */
  menuStyle?: CSSProperties;
}

/**
 * input[type=date] 의 ISO(YYYY-MM-DD) → 로컬 자정 ms. 레거시 isoDateToLocalMs 1:1.
 *   Date.parse(ISO) 는 UTC 자정으로 해석되어 TZ 만큼 어긋나므로 쓰지 않는다(원본 동일 회피).
 *   endOfDay=true 면 23:59:59.999 로 — 종료일을 그날 전체 포함(레거시 to 계약).
 */
function isoDateToLocalMs(iso: string, endOfDay = false): number {
  if (!iso) return NaN;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return NaN;
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  if (endOfDay) dt.setHours(23, 59, 59, 999);
  return dt.getTime();
}

/** 활성 range 에서 현재 선택 프리셋 값(custom 이면 매칭 없음 → null). */
function selectedPreset(ar: ActiveRange): string | null {
  if (ar && ar.type === 'preset') return ar.value;
  if (ar == null) return 'all'; // null → 호출자 default('all') 폴백 의미 1:1 (api.js)
  return null; // custom
}

/**
 * custom range 트리거 라벨 — from/to ms → 'YYYY-MM-DD ~ YYYY-MM-DD'(ISO slice, locale 무관).
 * 원본 BrowseLayout dateLabeler.formatCustom 1:1 (i18n 비의존이라 순수 모듈 헬퍼로 캡슐화).
 */
function formatCustomRange(from: number, to: number): string {
  const fmt = (ms: number): string => {
    const d = new Date(ms);
    return Number.isFinite(ms) ? d.toISOString().slice(0, 10) : '';
  };
  return `${fmt(from)} ~ ${fmt(to)}`;
}

export function DateRangeDropdown({
  activeRange,
  open = false,
  triggerId = 'cs-date-range-trigger',
  menuId = 'cs-date-range-menu',
  onSelectPreset,
  onApplyCustom,
  triggerRef,
  menuRef,
  menuStyle,
}: DateRangeDropdownProps) {
  const { t } = useTranslation();
  const listboxId = `${menuId}-listbox`;
  const selected = selectedPreset(activeRange);
  const isCustom = !!activeRange && activeRange.type === 'custom';
  // 트리거 라벨 — preset 이면 ui.main.date-filter.<v>.label, custom 이면 ISO range 포맷.
  const triggerLabel = isCustom
    ? formatCustomRange((activeRange as { from: number }).from, (activeRange as { to: number }).to)
    : t(`ui:main.date-filter.${selected ?? 'all'}.label`);
  // custom from/to 입력값 controlled state — DOM 역참조(closest/querySelector) 제거. ISO(YYYY-MM-DD) 문자열.
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  return (
    <div className="ds-dropdown" data-component="date-range-dropdown">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="ds-dropdown-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={listboxId}
        aria-label={t('ui:main.date-filter.trigger-aria')}
        {...(isCustom ? {} : { title: t(`ui:main.date-filter.${selected ?? 'all'}.title`) })}
      >
        <span className="ds-dropdown-trigger-label">{triggerLabel}</span>
      </button>
      <div ref={menuRef} id={menuId} className="ds-dropdown-menu" hidden={!open} style={menuStyle}>
        <ul id={listboxId} role="listbox" className="ds-dropdown-listbox" aria-labelledby={triggerId}>
          {DATE_RANGE_PRESETS.map((value, i) => (
            <li
              key={value}
              id={`${triggerId}-opt-${i}`}
              role="option"
              className="ds-dropdown-item"
              data-value={value}
              aria-selected={selected === value ? 'true' : 'false'}
              data-tip={t(`ui:main.date-filter.${value}.title`)}
              onClick={() => onSelectPreset?.(value)}
            >
              {t(`ui:main.date-filter.${value}.label`)}
            </li>
          ))}
        </ul>
        <div className="ds-dropdown-footer" role="group" aria-label={t('ui:main.date-filter.custom.label')}>
          <label className="ds-dropdown-footer-field">
            <span className="ds-dropdown-footer-label-text">{t('ui:main.date-filter.custom.from')}</span>
            <input
              type="date"
              data-role="custom-from"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.currentTarget.value)}
            />
          </label>
          <label className="ds-dropdown-footer-field">
            <span className="ds-dropdown-footer-label-text">{t('ui:main.date-filter.custom.to')}</span>
            <input
              type="date"
              data-role="custom-to"
              value={customTo}
              onChange={(e) => setCustomTo(e.currentTarget.value)}
            />
          </label>
          <div className="ds-dropdown-footer-warn" data-role="custom-warn" hidden />
          <button
            type="button"
            className="ds-dropdown-footer-apply"
            data-role="custom-apply"
            onClick={() => {
              // controlled state(customFrom/customTo)를 읽어 로컬 자정(from)/종일(to) ms 로 변환 후 통지
              //   (레거시 applyCustomRange 1:1, DOM 역참조 없이 React state 직접 사용).
              //   from <= to 순서 가드(레거시 동치) — 역순/무효는 무시(no-op). 90일 경고는 후속 hooks.
              const from = isoDateToLocalMs(customFrom, false);
              const to = isoDateToLocalMs(customTo, true);
              if (Number.isFinite(from) && Number.isFinite(to) && from <= to) onApplyCustom?.(from, to);
            }}
          >
            {t('ui:main.date-filter.custom.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
