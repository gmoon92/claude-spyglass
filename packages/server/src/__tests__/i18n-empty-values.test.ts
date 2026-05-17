// JSON 값 정합성 — 빈 문자열·공백만·placeholder(TODO/FIXME/TBD/XXX) 잔존 회귀 차단.
//
// 시나리오:
//   - 누군가 새 키를 추가하면서 빈 값 ""을 placeholder로 두고 깜빡 → 사용자에게 공란 노출
//   - "TODO: translate" 같은 dev note가 prod 빌드에 잔존
//   - 공백만("  ") 값 → 사용자에게 시각적 미노출
//
// 처리 영역: server/locales (flat) + web/tui locales 5 namespace × 4 lang

import { describe, it, expect } from 'bun:test';
import { readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../../../..');
const LANGS = ['ko', 'en', 'ja', 'zh'] as const;
const NSS = ['common', 'request', 'badges', 'session', 'ui'] as const;

interface Issue { file: string; key: string; value: string; reason: string }

function flatten(obj: unknown, prefix: string, out: Map<string, string>) {
  if (obj === null || typeof obj !== 'object') return;
  for (const k of Object.keys(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v === 'string') out.set(p, v);
    else if (typeof v === 'object') flatten(v, p, out);
  }
}

function loadFlat(file: string): Map<string, string> {
  const out = new Map<string, string>();
  try { flatten(JSON.parse(readFileSync(file, 'utf-8')), '', out); } catch {}
  return out;
}

function check(file: string, relName: string, issues: Issue[]): void {
  if (!statSync(file, { throwIfNoEntry: false } as never)) return;
  for (const [key, value] of loadFlat(file)) {
    if (value === '') {
      issues.push({ file: relName, key, value, reason: 'empty string' });
    } else if (value.trim() === '') {
      issues.push({ file: relName, key, value, reason: 'whitespace only' });
    } else if (/^(TODO|FIXME|TBD|XXX)\b/i.test(value.trim())) {
      issues.push({ file: relName, key, value: value.slice(0, 60), reason: 'placeholder (TODO/FIXME/TBD/XXX)' });
    }
  }
}

describe('JSON 값 정합성 (empty / whitespace / placeholder)', () => {
  it('모든 locale JSON의 값이 의미 있는 문자열이어야 한다', () => {
    const issues: Issue[] = [];

    // server
    for (const lang of LANGS) {
      const f = join(PROJECT_ROOT, 'packages/server/locales', `${lang}.json`);
      check(f, `server/${lang}.json`, issues);
    }
    // web / tui
    for (const pkg of ['web', 'tui']) {
      for (const lang of LANGS) {
        const langDir = join(PROJECT_ROOT, `packages/${pkg}/locales`, lang);
        for (const ns of NSS) {
          const f = join(langDir, `${ns}.json`);
          check(f, `${pkg}/${lang}/${ns}.json`, issues);
        }
      }
    }

    if (issues.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `\n[i18n-empty-values] ${issues.length}건:\n` +
          issues.slice(0, 15).map((i) => `  ${i.file} → ${i.key} = "${i.value}" (${i.reason})`).join('\n') +
          `\n→ 실제 번역값을 넣거나 키 자체를 삭제하세요.\n`,
      );
    }
    expect(issues).toEqual([]);
  });
});
