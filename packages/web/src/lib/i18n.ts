// lib/i18n.ts — react-i18next 정공법 i18n 인스턴스 (태스크 #12 / Phase A)
//
// 목적: 레거시 전역 IIFE window.I18n(assets/js/i18n.js) + 어댑터 tt() 를 대체하는 React-반응형
//   i18n 기반. 언어 변경 시 window.location.reload() 없이 useTranslation 구독 컴포넌트가
//   선언적으로 재렌더된다(버그: lang-switcher.js:50 reload 제거의 토대).
//
// 호환 설계(키 문자열 무변경 — 68개 호출부 점진 이식 안전):
//   레거시 키는 `<ns>.<path>` 형태다(예: 'ui.cache-panel.hit-rate.desc' → ns=ui, path=cache-panel...).
//   i18next 네이티브는 ns 를 ':' 로 분리하지만, 본 인스턴스는 5개 레거시 ns 를 **단일 'translation' ns**
//   아래 ns명 키로 병합 로드하고 `keySeparator: '.'` + `nsSeparator: false` 로 설정한다. 그러면
//   `t('ui.cache-panel.hit-rate.desc')` 가 translation.ui['cache-panel']['hit-rate'].desc 로 그대로 해석돼,
//   기존 키 문자열을 한 글자도 바꾸지 않고 tt() → useTranslation().t 로만 치환할 수 있다.
//
// 보간: 레거시 i18n.js#interpolate 는 `{var}`(단일 중괄호)다 — locales JSON 도 `{var}` 포맷.
//   i18next 기본 `{{var}}` 와 다르므로 prefix/suffix 를 '{'/'}' 로 맞춘다(JSON 재작성 불요).
//
// 로딩: 레거시와 동일하게 /locales/{lng}/{ns}.json 을 fetch(언어 단위 lazy). 커스텀 백엔드가 5개 ns 를
//   병렬 fetch 후 ns명으로 병합해 단일 'translation' 리소스로 반환한다(실패 ns 는 {} 폴백 — 레거시 동치).
//
// 언어 결정: 레거시 resolveLang 과 동일 우선순위(URL ?lang= → localStorage['spyglass:lang'] → navigator → 'ko').

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { BackendModule, ReadCallback } from 'i18next';

/** 지원 언어 — 레거시 i18n.js SUPPORTED_LANGS 1:1. */
export const SUPPORTED_LANGS = ['ko', 'en', 'ja', 'zh'] as const;
/** 레거시 namespace — /locales/{lng}/{ns}.json. 단일 'translation' 리소스로 병합된다. */
const LEGACY_NAMESPACES = ['common', 'request', 'badges', 'session', 'ui'] as const;
/** localStorage 언어 키 — 레거시 LS_KEY 1:1(전환기 동안 classic 과 값 공유). */
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
 * 커스텀 백엔드 — 단일 'translation' ns 요청 시 5개 레거시 ns JSON 을 병렬 fetch 해 ns명으로 병합 반환.
 *   결과: { common:{…}, request:{…}, badges:{…}, session:{…}, ui:{…} } — 레거시 키 'ui.x' 가 그대로 해석됨.
 *   ns 단위 실패는 {} 폴백(레거시 fetchNs catch 동치) — 부분 실패가 전체 로드를 깨지 않음.
 */
const mergedLegacyBackend: BackendModule = {
  type: 'backend',
  init: () => { /* 옵션 없음 */ },
  read(language: string, _namespace: string, callback: ReadCallback): void {
    Promise.all(
      LEGACY_NAMESPACES.map(async (ns) => {
        try {
          const res = await fetch(`/locales/${language}/${ns}.json`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return [ns, await res.json()] as const;
        } catch {
          return [ns, {}] as const;
        }
      }),
    )
      .then((pairs) => callback(null, Object.fromEntries(pairs)))
      .catch((err) => callback(err as Error, false));
  },
};

void i18next
  .use(mergedLegacyBackend)
  .use(initReactI18next)
  .init({
    lng: resolveInitialLang(),
    fallbackLng: 'ko',
    supportedLngs: SUPPORTED_LANGS as unknown as string[],
    ns: ['translation'],
    defaultNS: 'translation',
    // 단일 ns 병합 트리 — ns 분리 없이 'ui.x.y' 전체를 keySeparator '.' 로 dot-path 해석.
    nsSeparator: false,
    keySeparator: '.',
    // 레거시 {var} 단일 중괄호 보간(locales JSON 포맷) — i18next 기본 {{var}} 와 다름.
    interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
    returnNull: false,
    // 전환기 폴백(태스크 #12): i18next 리소스에 없는 키는 레거시 전역 window.I18n.t 로 위임한다.
    //   - 프로덕션: i18next 리소스 로드 전(또는 누락) 키-플래시 없이 이미 로드된 window.I18n 값 사용.
    //   - 테스트: 바닐라(window.I18n stub)와 TSX(useTranslation) 의 i18n 출처를 일치시켜 골든 동치 보존
    //     (renderers/turn-rows equivalence 가 동일 번역을 비교). window.I18n 부재 시 key 그대로.
    parseMissingKeyHandler: (key) => {
      const legacy = (globalThis as { I18n?: { t?: (k: string) => string } }).I18n;
      return legacy?.t ? legacy.t(key) : key;
    },
    // SSR/테스트(renderToStaticMarkup)에서 렌더 중 suspend 회피 — 미로드 시 key 폴백 렌더.
    react: { useSuspense: false },
  });

export { i18next };
export default i18next;
