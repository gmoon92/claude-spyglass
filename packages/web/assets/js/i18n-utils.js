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
