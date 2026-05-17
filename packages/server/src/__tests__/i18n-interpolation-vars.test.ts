/**
 * 변수 보간 placeholder 일치 회귀 방지.
 *
 * 시나리오:
 *   - ko: "{n}분 전" / en: "{count} mins ago"  → 호출에서 {n} 전달 시 en은 보간 실패
 *   - ko: "{fail}건 실패, {warn}건 경고" / ja: "{fail}件失敗"  (warn 누락)
 *     → ja 사용자에게 경고 개수 raw 미노출, 정보 손실
 *
 * 검증:
 *   같은 키의 4언어 값에서 추출된 `{var}` 집합이 동일해야 함.
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../../../..');
const LANGS = ['ko', 'en', 'ja', 'zh'] as const;

function flatten(obj: unknown, prefix: string, out: Map<string, string>) {
  if (obj === null || typeof obj !== 'object') return;
  for (const k of Object.keys(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v === 'string') out.set(p, v);
    else if (typeof v === 'object') flatten(v, p, out);
  }
}

function extractVars(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(/\{(\w+)\}/g)) out.add(m[1]);
  return out;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function loadFlat(file: string): Map<string, string> {
  const out = new Map<string, string>();
  try { flatten(JSON.parse(readFileSync(file, 'utf-8')), '', out); } catch {}
  return out;
}

interface MismatchEntry {
  context: string;
  key: string;
  perLang: Record<string, string[]>;
}

function auditByLang(getFile: (lang: string) => string, context: string): MismatchEntry[] {
  const byLang: Record<string, Map<string, string>> = {} as Record<string, Map<string, string>>;
  for (const lang of LANGS) byLang[lang] = loadFlat(getFile(lang));

  const allKeys = new Set<string>();
  for (const m of Object.values(byLang)) for (const k of m.keys()) allKeys.add(k);

  const out: MismatchEntry[] = [];
  for (const key of allKeys) {
    const vars: Record<string, Set<string>> = {} as Record<string, Set<string>>;
    for (const lang of LANGS) vars[lang] = extractVars(byLang[lang].get(key) ?? '');
    const ref = vars['ko'];
    let mismatch = false;
    for (const lang of LANGS) {
      if (!setsEqual(vars[lang], ref)) { mismatch = true; break; }
    }
    if (mismatch) {
      out.push({
        context,
        key,
        perLang: {
          ko: [...vars.ko],
          en: [...vars.en],
          ja: [...vars.ja],
          zh: [...vars.zh],
        },
      });
    }
  }
  return out;
}

describe('i18n 변수 보간 placeholder 일치', () => {
  it('server/locales: 4언어 {var} 집합이 동일해야 한다', () => {
    const mm = auditByLang((lang) => join(PROJECT_ROOT, 'packages/server/locales', `${lang}.json`), 'server');
    if (mm.length > 0) {
      // eslint-disable-next-line no-console
      console.error(formatReport(mm));
    }
    expect(mm).toEqual([]);
  });

  it('web/locales: 4언어 {var} 집합이 모든 namespace에서 동일해야 한다', () => {
    const all: MismatchEntry[] = [];
    for (const ns of ['common', 'request', 'badges', 'session', 'ui']) {
      const mm = auditByLang(
        (lang) => join(PROJECT_ROOT, 'packages/web/locales', lang, `${ns}.json`),
        `web/${ns}`,
      );
      all.push(...mm);
    }
    if (all.length > 0) {
      // eslint-disable-next-line no-console
      console.error(formatReport(all));
    }
    expect(all).toEqual([]);
  });

  it('tui/locales: 4언어 {var} 집합이 모든 namespace에서 동일해야 한다', () => {
    const all: MismatchEntry[] = [];
    for (const ns of ['common', 'request', 'badges', 'session', 'ui']) {
      const mm = auditByLang(
        (lang) => join(PROJECT_ROOT, 'packages/tui/locales', lang, `${ns}.json`),
        `tui/${ns}`,
      );
      all.push(...mm);
    }
    if (all.length > 0) {
      // eslint-disable-next-line no-console
      console.error(formatReport(all));
    }
    expect(all).toEqual([]);
  });
});

function formatReport(entries: MismatchEntry[]): string {
  return (
    `\n[i18n-vars] ${entries.length}건 변수 보간 mismatch:\n` +
    entries
      .slice(0, 15)
      .map((e) =>
        `  ${e.context}/${e.key}\n` +
        `    ko=[${e.perLang.ko.join(',') || '∅'}]  en=[${e.perLang.en.join(',') || '∅'}]  ` +
        `ja=[${e.perLang.ja.join(',') || '∅'}]  zh=[${e.perLang.zh.join(',') || '∅'}]`
      )
      .join('\n') +
    `\n→ 누락된 {var}를 해당 lang JSON 값에 추가. 의미가 안 맞으면 키 자체 수정.\n`
  );
}
