// i18n 유틸 — 활성 언어 기반 locale tag / Intl.Collator의 SSoT.
// 캡슐화 원칙: locale 판단 로직은 이 모듈에만 존재하며,
// 호출 측은 결과값(locale 문자열, Collator 인스턴스)만 받는다.
// ─────────────────────────────────────────────────────────────────────────────
// window.I18n 미초기화/SSR 등 빈 컨텍스트는 'ko'로 안전 폴백.
// ko 하드코딩 시 영/일/중 사용자에게도 한국어 정렬/숫자/날짜 형식이 노출되어
// 브랜드 일관성 손상 및 사용자 혼선을 유발하므로 반드시 활성 언어를 우선한다.

/**
 * 활성 i18n 언어 → Intl API에 넘길 BCP-47 locale tag.
 * @returns {string} 활성 언어 코드 (기본값 'ko')
 */
export function getLocale() {
  return (typeof window !== 'undefined' && window.I18n?.getLang?.()) || 'ko';
}

/**
 * 활성 언어 기반 Intl.Collator 인스턴스.
 * sensitivity: 'base'  → 대소문자/악센트 차이 무시
 * numeric: true        → "item2" < "item10" 자연 정렬
 * Intl.Collator 미지원 환경에서는 null 반환 — 호출 측은 String#localeCompare로 폴백한다.
 * @returns {Intl.Collator | null}
 */
export function getCollator() {
  if (typeof Intl === 'undefined' || !Intl.Collator) return null;
  return new Intl.Collator(getLocale(), { sensitivity: 'base', numeric: true });
}

/**
 * Custom Range 라벨 포맷 — Intl.DateTimeFormat(locale)로 from/to 단축 표기 후
 * i18n 키 `ui.main.date-filter.custom.label-with-range`에 {from}/{to} 치환.
 *
 * date-range-filter ADR-007: 라벨 자체는 키에 있고, locale별 날짜 표기만 Intl이 책임.
 * ko: 5/1, en: 5/1, ja: 5/1, zh: 5/1 (numeric)
 *
 * @param {number|Date} from
 * @param {number|Date} to
 * @returns {string}
 */
export function formatDateRangeLabel(from: any, to: any) {
  const fromMs = from instanceof Date ? from.getTime() : Number(from);
  const toMs   = to   instanceof Date ? to.getTime()   : Number(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    // 폴백 — i18n 키 없으면 'Custom'
    return (typeof window !== 'undefined' && window.I18n?.t?.('ui.main.date-filter.custom.label')) || 'Custom';
  }
  const fmt = (typeof Intl !== 'undefined' && Intl.DateTimeFormat)
    ? new Intl.DateTimeFormat(getLocale(), { month: 'numeric', day: 'numeric' })
    : null;
  const fromText = fmt ? fmt.format(new Date(fromMs)) : new Date(fromMs).toLocaleDateString();
  const toText   = fmt ? fmt.format(new Date(toMs))   : new Date(toMs).toLocaleDateString();
  const tmpl = (typeof window !== 'undefined' && window.I18n?.t?.('ui.main.date-filter.custom.label-with-range'))
    || 'Custom ({from} – {to})';
  return tmpl.replace('{from}', fromText).replace('{to}', toText);
}
