/**
 * i18n — 서버/CLI용 i18next 초기화 모듈.
 *
 * TUI의 detect-lang.ts와 동일한 우선순위로 언어를 감지하며,
 * 서버 CLI 출력 메시지의 다국어 처리를 담당.
 */

import i18next, { type i18n as I18nInstance } from 'i18next';
import { type Lang, DEFAULT_LANG, resolveLang } from '@spyglass/types';

// ── Locale JSON imports ─────────────────────────────────────────────────────
import ko from '../locales/ko.json';
import en from '../locales/en.json';
import ja from '../locales/ja.json';
import zh from '../locales/zh.json';

const resources = {
  ko: { translation: ko },
  en: { translation: en },
  ja: { translation: ja },
  zh: { translation: zh },
} as const;

// 별도 i18next 인스턴스 — TUI(react-i18next)와 namespace 충돌 회피.
// 같은 default singleton을 공유하면 한쪽 init이 다른 쪽 resources/ns를 덮어쓰는
// 회귀를 일으킴 (테스트에서 발견).
const i18n: I18nInstance = i18next.createInstance();

let initialized = false;

/**
 * CLI 플래그/환경 변수/시스템 로케일에서 언어를 감지.
 *
 * TUI의 detectLang과 동일한 4단계 우선순위 (일관성 유지).
 *
 * Priority:
 * 1. CLI flag: --lang ko | --lang=ko (argv 인자로 전달, 미전달 시 process.argv 폴백)
 * 2. SPYGLASS_LANG environment variable
 * 3. LANG / LC_ALL environment variable (e.g. ko_KR.UTF-8 → 'ko')
 * 4. DEFAULT_LANG ('ko')
 */
export function detectLang(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Lang {
  // 1. CLI flag
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--lang' && i + 1 < argv.length) {
      const resolved = resolveLang(argv[i + 1]);
      if (resolved) return resolved;
    }
    if (arg.startsWith('--lang=')) {
      const resolved = resolveLang(arg.slice('--lang='.length));
      if (resolved) return resolved;
    }
  }

  // 2. SPYGLASS_LANG
  const sl = env.SPYGLASS_LANG;
  if (sl) {
    const resolved = resolveLang(sl);
    if (resolved) return resolved;
  }

  // 3. LANG / LC_ALL
  const sys = env.LC_ALL || env.LANG;
  if (sys) {
    const resolved = resolveLang(sys);
    if (resolved) return resolved;
  }

  // 4. default
  return DEFAULT_LANG;
}

/**
 * i18next 초기화. 중복 호출은 무시.
 *
 * @param lang 강제 언어 지정 (미지정 시 detectLang)
 */
export function initI18n(lang?: Lang): void {
  if (initialized) return;
  const lng = lang || detectLang();
  // dev 환경 한정 runtime 안전망 — 미존재 키 호출 시 즉시 console.warn으로 노출.
  // test/production은 noisy를 피하기 위해 silent (사용자에게 한글 raw 노출 위험은 없음 —
  // 키 자체를 반환하므로 영문 식별자가 표시됨).
  const isDev = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

  i18n.init({
    resources,
    lng,
    fallbackLng: DEFAULT_LANG,
    // single-brace 보간 ({var}) — 프로젝트 전 JSON이 이 형식을 사용.
    // i18next 기본값은 double-brace ({{var}})이므로 명시적으로 prefix/suffix 지정 필수.
    interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
    saveMissing: isDev,
    missingKeyHandler: isDev
      ? (lngs, ns, key) => {
          // eslint-disable-next-line no-console
          console.warn(`[i18n] missing key "${key}" (lng=${lngs.join(',')}, ns=${ns})`);
        }
      : undefined,
  });
  initialized = true;
}

/**
 * 번역 조회. i18next가 초기화되지 않았으면 자동 초기화.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  if (!initialized) initI18n();
  return i18n.t(key, vars) as string;
}

export { i18n };
