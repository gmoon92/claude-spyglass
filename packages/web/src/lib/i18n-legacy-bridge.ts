// lib/i18n-legacy-bridge.ts — 레거시 window.I18n → react-i18next 단방향 언어 브릿지
//
// 배경(lang-switch 회귀): 전환기에 두 i18n 시스템이 공존한다 — 미변환 컴포넌트는 레거시 window.I18n.t,
//   변환 컴포넌트는 react-i18next(useTranslation). 둘이 같은 언어를 추종해야 한다.
//
//   과거 main.tsx 는 부팅 시 `const initial = window.I18n.getLang(); if (initial) changeLanguage(initial)`
//   로 레거시의 현재 언어를 읽어 react 를 그 값으로 맞췄다. 그러나 main.tsx 는 type=module(deferred)
//   이라 레거시 i18n.js 의 DOMContentLoaded `I18n.init()`(URL→localStorage→navigator→ko 로 언어 결정)
//   보다 **먼저** 실행된다. 그 시점 레거시 currentLang 은 아직 미초기화 기본값 'ko'(i18n.js:26)다.
//   결과: `?lang=en` 으로 react-i18next 가 init lng='en'(resolveInitialLang)으로 올바르게 떠도,
//   이 브릿지가 즉시 changeLanguage('ko') 로 덮어써 페이지 전체가 한국어로 고착됐다(레거시는 이후
//   init 에서 'en' 으로 갔지만 init 은 onChange 를 발화하지 않아 react 는 ko 에 남음).
//
// 해법: 초기 언어는 react-i18next 자신의 init(lng: resolveInitialLang())이 SSoT 다 — 레거시와 동일한
//   우선순위·동일 localStorage 키('spyglass:lang')라 항상 정합한다. 따라서 부팅 시 레거시 getLang() 을
//   읽어 덮어쓰지 않는다(타이밍 의존 제거). 런타임 전환만 브릿지한다: 레거시 lang-switcher 가
//   setLang→onChange 를 발화하면 react 가 changeLanguage 로 따라가 reload 없이 변환분이 재렌더된다.

/** react-i18next 인스턴스 중 본 브릿지가 쓰는 표면만(테스트 더블 주입용 최소 계약). */
export interface ChangeLanguageTarget {
  changeLanguage: (lng: string) => Promise<unknown> | unknown;
}

/** 레거시 window.I18n 중 본 브릿지가 쓰는 표면만. */
export interface LegacyI18nLike {
  onChange?: (fn: (lng: string) => void) => void;
}

/**
 * 레거시 → react 언어 브릿지 설치. **초기 언어를 덮어쓰지 않는다**(react init 이 SSoT).
 *   레거시 onChange(런타임 전환)만 구독해 target.changeLanguage 로 전파한다.
 * @param target react-i18next 인스턴스(changeLanguage 보유)
 * @param legacy window.I18n(없으면 no-op — SSR/스텁 안전)
 */
export function bridgeLegacyI18n(target: ChangeLanguageTarget, legacy: LegacyI18nLike | undefined): void {
  legacy?.onChange?.((lng) => {
    void target.changeLanguage(lng);
  });
}
