/**
 * i18n — i18next 초기화 모듈.
 *
 * 정적 import로 20개 locale JSON(4 lang × 5 namespace)을 번들에 포함.
 * Bun의 JSON 모듈 지원을 활용하므로 별도 loader 불필요.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Lang } from '@spyglass/types';

// ── Korean ──────────────────────────────────────────────────────────────────
import koCommon  from '../locales/ko/common.json';
import koRequest from '../locales/ko/request.json';
import koBadges  from '../locales/ko/badges.json';
import koSession from '../locales/ko/session.json';
import koUi      from '../locales/ko/ui.json';

// ── English ──────────────────────────────────────────────────────────────────
import enCommon  from '../locales/en/common.json';
import enRequest from '../locales/en/request.json';
import enBadges  from '../locales/en/badges.json';
import enSession from '../locales/en/session.json';
import enUi      from '../locales/en/ui.json';

// ── Japanese ─────────────────────────────────────────────────────────────────
import jaCommon  from '../locales/ja/common.json';
import jaRequest from '../locales/ja/request.json';
import jaBadges  from '../locales/ja/badges.json';
import jaSession from '../locales/ja/session.json';
import jaUi      from '../locales/ja/ui.json';

// ── Chinese ──────────────────────────────────────────────────────────────────
import zhCommon  from '../locales/zh/common.json';
import zhRequest from '../locales/zh/request.json';
import zhBadges  from '../locales/zh/badges.json';
import zhSession from '../locales/zh/session.json';
import zhUi      from '../locales/zh/ui.json';

// ── resources map ────────────────────────────────────────────────────────────
const resources = {
  ko: { common: koCommon, request: koRequest, badges: koBadges, session: koSession, ui: koUi },
  en: { common: enCommon, request: enRequest, badges: enBadges, session: enSession, ui: enUi },
  ja: { common: jaCommon, request: jaRequest, badges: jaBadges, session: jaSession, ui: jaUi },
  zh: { common: zhCommon, request: zhRequest, badges: zhBadges, session: zhSession, ui: zhUi },
} as const;

/**
 * i18next 초기화.
 *
 * @param lang 표시 언어. 기본값 'ko'. G2-B 단계에서 실제 CLI 인자로 대체 예정.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function initI18n(lang: Lang = 'ko'): Promise<any> {
  // dev 환경 한정 runtime 안전망 — 미존재 키 호출 시 console.warn (회귀 즉시 발견).
  // test/production은 silent.
  const isDev = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

  return i18n.use(initReactI18next).init({
    resources,
    lng: lang,
    fallbackLng: 'ko',
    ns: ['common', 'request', 'badges', 'session', 'ui'],
    defaultNS: 'common',
    // single-brace 보간 ({var}) — 프로젝트 전 JSON이 이 형식을 사용.
    // i18next 기본은 double-brace ({{var}})이므로 prefix/suffix 명시 필수.
    interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
    react: { useSuspense: false }, // Ink 환경에서 Suspense 사용 안 함
    saveMissing: isDev,
    missingKeyHandler: isDev
      ? (lngs, ns, key) => {
          // eslint-disable-next-line no-console
          console.warn(`[i18n] missing key "${key}" (lng=${lngs.join(',')}, ns=${ns})`);
        }
      : undefined,
  });
}

export { i18n };
