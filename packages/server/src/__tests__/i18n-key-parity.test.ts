/**
 * i18n 키 정합성 정적 검증 — t() 호출의 모든 literal 키가 4언어 JSON에 실제로 존재하는지 확인.
 *
 * 기존 안전망:
 *  - missingKeyHandler (dev only): runtime에 발견. test/prod silent.
 *  - i18n-extract gate: 한글 raw 회귀 차단. 키 누락은 못 잡음.
 *
 * 이 테스트의 보호 범위:
 *  - 누군가 코드에 t('새.없는.키')를 추가하면 → 정적으로 즉시 fail
 *  - 누군가 ko.json에서 키를 지웠는데 코드에서 여전히 호출하면 → fail
 *  - 키가 ko에만 있고 en/ja/zh 누락이면 → fail (4언어 parity)
 *
 * web i18n.js의 t() 해상도 로직을 동형으로 시뮬레이션:
 *  1. 첫 segment가 namespace면 그 ns에서 path 탐색
 *  2. 미해상도면 모든 ns에서 전체 path 탐색
 */

import { describe, it, expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../../../..');
const WEB_JS_DIR = join(PROJECT_ROOT, 'packages/web/assets/js');
// React 마이그레이션으로 web 의 t() 호출 SSoT 가 src/ 로 이동 — assets/js 만 스캔하면
// 키가 2개만 잡혀 게이트가 무력화된다. 두 위치를 모두 스캔해야 본래 보호 범위가 유지된다.
const WEB_SRC_DIR = join(PROJECT_ROOT, 'packages/web/src');
const WEB_LOCALES = join(PROJECT_ROOT, 'packages/web/locales');
const SERVER_SRC_DIR = join(PROJECT_ROOT, 'packages/server/src');
const SERVER_LOCALES = join(PROJECT_ROOT, 'packages/server/locales');
const TUI_SRC_DIR = join(PROJECT_ROOT, 'packages/tui/src');
const TUI_LOCALES = join(PROJECT_ROOT, 'packages/tui/locales');
const NAMESPACES = ['common', 'request', 'badges', 'session', 'ui'] as const;
const LANGS = ['ko', 'en', 'ja', 'zh'] as const;

function collectFiles(dir: string, exts: string[], out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '__tests__' || name === '__snapshots__' || name === 'dist') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collectFiles(p, exts, out);
    else if (exts.some((ext) => name.endsWith(ext))) out.push(p);
  }
  return out;
}

// stripComments — JS 소스에서 라인 주석과 블록 주석을 모두 제거.
// 주석 안의 t('foo') 같은 예시 패턴이 false positive로 잡히는 것을 방지.
// (i18n.js의 JSDoc에 t('badges.hint.lines', {count: 5}) 같은 예시가 있음.)
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * 다음 호출 패턴에서 literal 키를 추출 (주석은 stripComments로 제외):
 *   - window.I18n.t('key') / window.I18n?.t?.('key')
 *   - i18n.t('key')
 *   - t('key')
 *   - tSafe('key', ...) / tFallback('key', ...) — wrapper 함수
 * 키는 대소문자 모두 허용 ([a-zA-Z]로 시작) — JSON에 'cat-Agent' 같은 capital 키 있음.
 * 동적 backtick(t(`prefix.${var}`))은 prefix만 추출되어 false positive로 잡힐 수 있으므로
 * 제외 (caller가 prefix-only인지 별도 판단).
 */
function extractLiteralKeys(content: string): string[] {
  const stripped = stripComments(content);
  const keys: string[] = [];

  // Pattern A — t(), tSafe() 등의 첫 인자가 직접 literal인 일반 케이스.
  const reFirst = /(?:window\.I18n\??\.?t\??\.?|\bi18n\.t|\btSafe|\btFallback|\bt)\(\s*['"`]([a-zA-Z][\w.-]*)['"`]/g;
  for (const m of stripped.matchAll(reFirst)) keys.push(m[1]);

  // Pattern B — ternary/conditional 내부 literal까지 모두 잡기:
  //   t(cond ? 'a.b' : 'c.d')  같은 케이스에서 'a.b'와 'c.d' 모두 매칭되어야 함.
  // t() 호출 시작 후 같은 라인(또는 한 줄 안의) 닫는 `)` 까지의 string literal 전부 추출.
  const reCall = /(?:window\.I18n\??\.?t\??\.?|\bi18n\.t|\btSafe|\btFallback|\bt)\(([^)]*)\)/g;
  for (const call of stripped.matchAll(reCall)) {
    const args = call[1];
    for (const lit of args.matchAll(/['"`]([a-zA-Z][\w.-]*\.[\w.-]+)['"`]/g)) {
      keys.push(lit[1]);
    }
  }

  return keys;
}

function getByPath(obj: unknown, parts: string[]): unknown {
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * web i18n.js의 t() 해상도 로직을 동형 구현.
 * 매칭 성공 시 string 값을 반환, 실패 시 null.
 */
function resolveKey(key: string, langData: Record<string, unknown>): string | null {
  const segments = key.split('.');
  if (segments.length < 1) return null;

  // 시도 1: 첫 segment가 namespace
  if (segments.length >= 2 && (NAMESPACES as readonly string[]).includes(segments[0])) {
    const v = getByPath(langData[segments[0]], segments.slice(1));
    if (typeof v === 'string') return v;
  }
  // 시도 2: 모든 namespace에서 전체 path
  for (const ns of NAMESPACES) {
    const v = getByPath(langData[ns], segments);
    if (typeof v === 'string') return v;
  }
  return null;
}

describe('i18n 키 정합성 (정적 검증)', () => {
  it('모든 web t() 호출의 literal 키가 4언어 JSON에 존재해야 한다', () => {
    // 1) 모든 web SSoT 파일에서 literal 키 수집.
    //    P5-01: assets/js SSoT 가 .ts 로 전환됨 — .ts/.tsx 도 스캔 대상에 포함(잔여 classic i18n .js + 전환된 .ts).
    //    React 마이그레이션 후 t() 호출 대부분이 src/ 에 있으므로 src/ 도 스캔.
    const files = [
      ...collectFiles(WEB_JS_DIR, ['.js', '.ts', '.tsx']),
      ...collectFiles(WEB_SRC_DIR, ['.ts', '.tsx']),
    ];
    const allKeys = new Set<string>();
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      for (const k of extractLiteralKeys(content)) allKeys.add(k);
    }

    // sanity: 합리적인 키 수 확보 — 회귀 시뮬레이션을 위한 최소선.
    expect(allKeys.size).toBeGreaterThan(50);

    // 2) 각 언어의 namespace JSON을 로드해 통합 인덱스 구축.
    const indexes: Record<string, Record<string, unknown>> = {};
    for (const lang of LANGS) {
      const langData: Record<string, unknown> = {};
      for (const ns of NAMESPACES) {
        const p = join(WEB_LOCALES, lang, `${ns}.json`);
        try {
          langData[ns] = JSON.parse(readFileSync(p, 'utf-8'));
        } catch {
          langData[ns] = {};
        }
      }
      indexes[lang] = langData;
    }

    // 3) 각 키 × 4언어 lookup. 누락 분류.
    const missing: Record<string, string[]> = {};
    for (const key of allKeys) {
      const missingLangs: string[] = [];
      for (const lang of LANGS) {
        if (resolveKey(key, indexes[lang]) == null) missingLangs.push(lang);
      }
      if (missingLangs.length > 0) missing[key] = missingLangs;
    }

    if (Object.keys(missing).length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `\n[i18n-parity] ${Object.keys(missing).length}건 키가 일부 언어에서 누락:\n` +
          Object.entries(missing)
            .slice(0, 20)
            .map(([k, langs]) => `  ${k} → missing in [${langs.join(',')}]`)
            .join('\n') +
          (Object.keys(missing).length > 20 ? `\n  ... (${Object.keys(missing).length - 20} more)` : '') +
          `\n→ 해당 키를 packages/web/locales/{lang}/{namespace}.json에 추가하세요.\n`,
      );
    }
    expect(missing).toEqual({});
  }, 15_000);

  it('web 모든 호출이 명시적 namespace prefix를 사용해야 한다 (fallback 우연 의존 차단)', () => {
    // ns-less 호출은 i18n.js의 fallback 로직(모든 ns 순회)에 의존 → fragile.
    // 미래에 같은 path가 다른 ns에 추가되면 어느 ns가 hit될지 예측 불가.
    // 모든 호출에 명시적 ns prefix를 강제해 단일 SSoT 보장.
    // P5-01: assets/js SSoT 가 .ts 로 전환됨 — .ts/.tsx 도 스캔 대상에 포함.
    // React 마이그레이션 후 t() 호출 대부분이 src/ 에 있으므로 src/ 도 스캔.
    const files = [
      ...collectFiles(WEB_JS_DIR, ['.js', '.ts', '.tsx']),
      ...collectFiles(WEB_SRC_DIR, ['.ts', '.tsx']),
    ];
    const offenders: { file: string; key: string }[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      for (const k of extractLiteralKeys(content)) {
        const first = k.split('.')[0];
        if (!(NAMESPACES as readonly string[]).includes(first)) {
          offenders.push({ file: file.replace(PROJECT_ROOT + '/', ''), key: k });
        }
      }
    }

    if (offenders.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `\n[i18n-ns-prefix] ns prefix 누락 호출 ${offenders.length}건:\n` +
          offenders
            .slice(0, 15)
            .map(({ file, key }) => `  ${file} → t('${key}') (ns 누락)`)
            .join('\n') +
          (offenders.length > 15 ? `\n  ... (${offenders.length - 15} more)` : '') +
          `\n→ t('${NAMESPACES.join('|')}.X.Y') 형태로 명시적 ns prefix 사용. fallback 우연 의존 차단.\n`,
      );
    }
    expect(offenders).toEqual([]);
  }, 15_000);

  it('모든 server t() 호출의 literal 키가 server/locales 4언어에 존재해야 한다', () => {
    const files = collectFiles(SERVER_SRC_DIR, ['.ts']);
    const allKeys = new Set<string>();
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      for (const k of extractLiteralKeys(content)) allKeys.add(k);
    }

    // 단일 namespace (i18next default 'translation') — server는 flat key 구조.
    // 각 언어 파일은 단일 객체. resolveKey 대신 단순 dot-path lookup.
    const langData: Record<string, Record<string, unknown>> = {};
    for (const lang of LANGS) {
      const p = join(SERVER_LOCALES, `${lang}.json`);
      langData[lang] = JSON.parse(readFileSync(p, 'utf-8'));
    }

    const missing: Record<string, string[]> = {};
    for (const key of allKeys) {
      const parts = key.split('.');
      const missingLangs: string[] = [];
      for (const lang of LANGS) {
        if (typeof getByPath(langData[lang], parts) !== 'string') missingLangs.push(lang);
      }
      if (missingLangs.length > 0) missing[key] = missingLangs;
    }

    if (Object.keys(missing).length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `\n[i18n-parity-server] ${Object.keys(missing).length}건 키 누락:\n` +
          Object.entries(missing)
            .map(([k, langs]) => `  ${k} → missing in [${langs.join(',')}]`)
            .join('\n') +
          `\n→ packages/server/locales/{lang}.json에 추가하세요.\n`,
      );
    }
    expect(missing).toEqual({});
  }, 15_000);

  it('모든 tui t() 호출의 literal 키가 tui/locales 4언어에 존재해야 한다', () => {
    const files = collectFiles(TUI_SRC_DIR, ['.ts', '.tsx']);
    const allKeys = new Set<string>();
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      for (const k of extractLiteralKeys(content)) allKeys.add(k);
    }

    // TUI는 web과 동형 namespace 구조 (common/request/badges/session/ui).
    const indexes: Record<string, Record<string, unknown>> = {};
    for (const lang of LANGS) {
      const langData: Record<string, unknown> = {};
      for (const ns of NAMESPACES) {
        const p = join(TUI_LOCALES, lang, `${ns}.json`);
        try {
          langData[ns] = JSON.parse(readFileSync(p, 'utf-8'));
        } catch {
          langData[ns] = {};
        }
      }
      indexes[lang] = langData;
    }

    const missing: Record<string, string[]> = {};
    for (const key of allKeys) {
      const missingLangs: string[] = [];
      for (const lang of LANGS) {
        if (resolveKey(key, indexes[lang]) == null) missingLangs.push(lang);
      }
      if (missingLangs.length > 0) missing[key] = missingLangs;
    }

    if (Object.keys(missing).length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `\n[i18n-parity-tui] ${Object.keys(missing).length}건 키 누락:\n` +
          Object.entries(missing)
            .map(([k, langs]) => `  ${k} → missing in [${langs.join(',')}]`)
            .join('\n') +
          `\n→ packages/tui/locales/{lang}/{namespace}.json에 추가하세요.\n`,
      );
    }
    expect(missing).toEqual({});
  }, 15_000);
});
