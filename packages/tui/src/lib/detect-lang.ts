import { type Lang, DEFAULT_LANG, isLang, resolveLang } from '@spyglass/types';

/**
 * Detect the display language from CLI flags, environment variables, or system locale.
 *
 * Priority:
 * 1. CLI flag: --lang ko | --lang=ko
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
      const next = argv[i + 1];
      if (isLang(next)) return next;
    }
    if (arg.startsWith('--lang=')) {
      const val = arg.slice('--lang='.length);
      if (isLang(val)) return val;
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
