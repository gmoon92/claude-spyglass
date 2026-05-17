export type Lang = 'ko' | 'en' | 'ja' | 'zh';

export const SUPPORTED_LANGS: readonly Lang[] = ['ko', 'en', 'ja', 'zh'] as const;

export const DEFAULT_LANG: Lang = 'ko';

export interface LangMeta {
  code: Lang;
  nativeName: string;   // 한국어, English, 日本語, 中文
  englishName: string;  // Korean, English, Japanese, Chinese
}

export const LANG_META: Readonly<Record<Lang, LangMeta>> = {
  ko: { code: 'ko', nativeName: '한국어', englishName: 'Korean' },
  en: { code: 'en', nativeName: 'English', englishName: 'English' },
  ja: { code: 'ja', nativeName: '日本語', englishName: 'Japanese' },
  zh: { code: 'zh', nativeName: '中文', englishName: 'Chinese' },
};

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (SUPPORTED_LANGS as readonly string[]).includes(value);
}

/**
 * Resolve a navigator.language / LANG env / arbitrary string to one of our supported Lang codes.
 * Returns null when none match (caller decides default).
 */
export function resolveLang(input: string | undefined | null): Lang | null {
  if (!input) return null;
  const lower = input.toLowerCase();
  // direct match
  if (isLang(lower)) return lower;
  // primary subtag (e.g. "ko-KR" -> "ko", "zh-Hans-CN" -> "zh")
  const primary = lower.split(/[-_.]/)[0];
  if (isLang(primary)) return primary;
  return null;
}
