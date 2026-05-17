/**
 * Locale 값 cross-lang 정합성 회귀 방지.
 *
 * 시나리오:
 *   - 누군가 `ja.json`에 한국어 값 복사-붙여넣기 실수로 한글 raw 노출
 *   - `en.json`에 CJK 문자 raw 노출
 *   - `ko.json`에 일본어 가나 raw 노출
 *
 * 이 단순 실수는 i18n-extract가 못 잡음 (코드의 한글만 검사). 값의 cross-lang
 * 정합성을 별도 검증.
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../../../..');

interface Issue {
  file: string;
  key: string;
  value: string;
  reason: string;
}

function flatten(obj: unknown, prefix: string, out: Map<string, string>) {
  if (obj === null || typeof obj !== 'object') return;
  for (const k of Object.keys(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v === 'string') out.set(p, v);
    else if (typeof v === 'object') flatten(v, p, out);
  }
}

const RULES: Record<string, { pattern: RegExp; reason: string }> = {
  en: { pattern: /[぀-ゟ゠-ヿ一-鿿가-힯]/, reason: 'en.json should not contain CJK characters' },
  ja: { pattern: /[가-힯]/, reason: 'ja.json should not contain Hangul raw' },
  zh: { pattern: /[가-힯]|[぀-ゟ]/, reason: 'zh.json should not contain Hangul or Hiragana raw' },
  ko: { pattern: /[぀-ゟ]|[゠-ヿ]/, reason: 'ko.json should not contain Hiragana/Katakana raw' },
};

function loadFlat(file: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    flatten(JSON.parse(readFileSync(file, 'utf-8')), '', out);
  } catch {}
  return out;
}

describe('Locale 값 cross-lang 정합성', () => {
  it('각 lang JSON의 값이 그 언어 expected 문자 set 안에 있어야 한다', () => {
    const issues: Issue[] = [];

    // server (flat 단일 namespace)
    for (const [lang, rule] of Object.entries(RULES)) {
      const file = join(PROJECT_ROOT, 'packages/server/locales', `${lang}.json`);
      for (const [key, value] of loadFlat(file)) {
        if (rule.pattern.test(value)) {
          issues.push({ file: `server/${lang}.json`, key, value: value.slice(0, 80), reason: rule.reason });
        }
      }
    }

    // web/tui (5 namespace × 4 lang)
    for (const pkg of ['web', 'tui']) {
      const baseDir = join(PROJECT_ROOT, `packages/${pkg}/locales`);
      for (const [lang, rule] of Object.entries(RULES)) {
        const langDir = join(baseDir, lang);
        let nsFiles: string[];
        try { nsFiles = readdirSync(langDir); } catch { continue; }
        for (const ns of nsFiles) {
          if (!ns.endsWith('.json')) continue;
          for (const [key, value] of loadFlat(join(langDir, ns))) {
            if (rule.pattern.test(value)) {
              issues.push({
                file: `${pkg}/${lang}/${ns}`,
                key,
                value: value.slice(0, 80),
                reason: rule.reason,
              });
            }
          }
        }
      }
    }

    if (issues.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `\n[i18n-locale-content] ${issues.length}건 cross-lang mismatch:\n` +
          issues.slice(0, 15).map((i) => `  ${i.file} → ${i.key} = "${i.value}" (${i.reason})`).join('\n') +
          `\n→ 정확한 언어로 번역 후 다시 저장하세요.\n`,
      );
    }
    expect(issues).toEqual([]);
  });
});
