// lib/i18n.ts — react-i18next 정공법 i18n 인스턴스
//
// 목적: 레거시 전역 IIFE window.I18n(assets/js/i18n.js) + 어댑터 tt() 를 대체하는 React-반응형
//   i18n 기반. 언어 변경 시 window.location.reload() 없이 useTranslation 구독 컴포넌트가
//   선언적으로 재렌더된다.
//
// 순수 i18next 관용구(어댑터/호환 셸 제거 완료):
//   - 5개 namespace(common/request/badges/session/ui)를 ns 단위 lazy fetch 한다
//     (/locales/{lng}/{ns}.json). 부팅 시 loadNamespaces 로 5개를 일괄 선로드한다.
//     커스텀 backend 는 fetch 실패를 빈 리소스로 graceful 폴백한다(오프라인/테스트 환경에서 changeLanguage
//     가 hang 하지 않도록 — i18next-http-backend 는 실패를 콜백 에러로 넘겨 jsdom 상대경로 fetch 시 행).
//   - 키는 `<ns>:<path>` colon 분리(i18next 기본 nsSeparator ':') — 예: t('ui:cache-panel.hit-rate.desc').
//     defaultNS='ui'(전체 호출의 ~94%)라 ui 키는 colon 없이도 해석되지만, 호출부는 명시 colon 을 쓴다.
//   - 보간은 i18next 기본 `{{var}}` double-brace(locales JSON 도 {{var}} 포맷).
//
// 언어 결정: resolveLang 우선순위(URL ?lang= → localStorage['spyglass:lang'] → navigator → 'ko').

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { BackendModule, ReadCallback } from 'i18next';

/** 지원 언어 — 레거시 i18n.js SUPPORTED_LANGS 1:1. */
export const SUPPORTED_LANGS = ['ko', 'en', 'ja', 'zh'] as const;
/** namespace — /locales/{lng}/{ns}.json (colon 분리 키의 ns 파트). */
const NAMESPACES = ['common', 'request', 'badges', 'session', 'ui'] as const;
/** localStorage 언어 키 — 레거시 LS_KEY 1:1. */
export const LANG_STORAGE_KEY = 'spyglass:lang';

/** BCP-47 primary subtag → 지원 언어(ko-KR → ko). 미지원이면 null. 레거시 mapPrimaryTag 1:1. */
function mapPrimaryTag(tag: string): string | null {
  const primary = tag.split('-')[0]?.toLowerCase() ?? '';
  return (SUPPORTED_LANGS as readonly string[]).includes(primary) ? primary : null;
}

/** 초기 언어 결정 — 레거시 resolveLang 우선순위(URL → localStorage → navigator → 'ko') 1:1. */
export function resolveInitialLang(): string {
  if (typeof window === 'undefined') return 'ko';
  try {
    const urlLang = new URLSearchParams(window.location.search).get('lang');
    if (urlLang && (SUPPORTED_LANGS as readonly string[]).includes(urlLang)) return urlLang;
  } catch { /* SSR/스텁 안전 */ }
  try {
    const stored = window.localStorage?.getItem(LANG_STORAGE_KEY);
    if (stored && (SUPPORTED_LANGS as readonly string[]).includes(stored)) return stored;
  } catch { /* 시크릿 모드 */ }
  try {
    const navLangs = window.navigator?.languages || [window.navigator?.language];
    for (const tag of navLangs) {
      if (!tag) continue;
      const mapped = mapPrimaryTag(tag);
      if (mapped) return mapped;
    }
  } catch { /* navigator 부재 */ }
  return 'ko';
}

/**
 * ns 단위 lazy fetch backend — /locales/{lng}/{ns}.json. fetch 실패는 빈 리소스({})로 graceful 폴백
 *   (오프라인/jsdom 상대경로 fetch 실패 시 callback(null,{})로 changeLanguage 정상 resolve — i18next-http-backend
 *   가 실패를 에러로 넘겨 hang 시키던 문제 회피). 정상 환경에선 ns JSON 을 그대로 로드.
 */
const lazyNsBackend: BackendModule = {
  type: 'backend',
  init: () => { /* 옵션 없음 */ },
  read(language: string, namespace: string, callback: ReadCallback): void {
    fetch(`/locales/${language}/${namespace}.json`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => callback(null, data))
      .catch(() => callback(null, {}));
  },
};

void i18next
  .use(lazyNsBackend)
  .use(initReactI18next)
  .init({
    lng: resolveInitialLang(),
    fallbackLng: 'ko',
    supportedLngs: SUPPORTED_LANGS as unknown as string[],
    ns: NAMESPACES as unknown as string[],
    defaultNS: 'ui',
    // i18next 기본: nsSeparator ':', keySeparator '.', interpolation {{var}}.
    interpolation: { escapeValue: false },
    returnNull: false,
    // SSR/테스트(renderToStaticMarkup)에서 렌더 중 suspend 회피 — 미로드 시 key 폴백 렌더 후 loaded 자가치유.
    react: { useSuspense: false },
  })
  // 부팅 시 5개 ns 일괄 선로드 — colon 키(session:x 등)가 defaultNS(ui) 외 ns 미로드로 폴백되는 것 방지.
  //   useSuspense:false 라 미로드 중 첫 렌더는 key 폴백, loaded 이벤트로 자가치유(기존 동작 동일).
  .then(() => i18next.loadNamespaces(NAMESPACES as unknown as string[]))
  .catch(() => { /* 백엔드 fetch 실패 — key 폴백 렌더로 안전 진행 */ });

// 언어 영속 — 런타임 전환(changeLanguage) 시 localStorage 에 저장한다. resolveInitialLang 이 다음 부팅에서
//   이 키('spyglass:lang')를 읽어 복원한다. SSR/시크릿모드(storage 차단)는 가드로 안전 폴백.
i18next.on('languageChanged', (lng) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(LANG_STORAGE_KEY, lng);
  } catch { /* 시크릿 모드 등 storage 차단 — 영속 생략 */ }
});

export { i18next };
export default i18next;
