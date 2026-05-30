// JSON 키 네이밍 정책 강제 — kebab-case.
//
// 프로젝트 정책 (CLAUDE.md): 모든 식별자는 kebab-case.
// 위반 시 i18n 키 호출 일관성 / IDE 검색성 / 컨벤션 통일 손실.
//
// Exception: 정의 이름이 PascalCase인 카테고리(cat-Agent/Skill/MCP/Native).
// 의도된 design choice — 카테고리 식별자 자체가 capitalized라 그대로 사용.

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../../../..');
const LANGS = ['ko', 'en', 'ja', 'zh'] as const;
const NSS = ['common', 'request', 'badges', 'session', 'ui'] as const;
const KEBAB_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const EXCEPTIONS = new Set([
  'cat-Agent', 'cat-Skill', 'cat-MCP', 'cat-Native',
  // 시간범위 preset 식별자 — api.js VALID_PRESETS('1h'|'7d'|'30d')와 1:1 대응하는
  //   도메인 키라 숫자 접두를 허용(cat-* 와 동일 취지의 의도된 design choice 예외).
  '1h', '7d', '30d',
]);

function collectKeys(obj: unknown, out: { key: string; path: string }[], path: string[] = []) {
  if (obj === null || typeof obj !== 'object') return;
  for (const k of Object.keys(obj as Record<string, unknown>)) {
    const newPath = [...path, k];
    out.push({ key: k, path: newPath.join('.') });
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v === 'object') collectKeys(v, out, newPath);
  }
}

interface Violation { file: string; key: string; path: string }

function audit(file: string, name: string, violations: Violation[]) {
  let data;
  try { data = JSON.parse(readFileSync(file, 'utf-8')); } catch { return; }
  const collected: { key: string; path: string }[] = [];
  collectKeys(data, collected);
  for (const { key, path } of collected) {
    if (EXCEPTIONS.has(key)) continue;
    if (!KEBAB_RE.test(key)) {
      violations.push({ file: name, key, path });
    }
  }
}

describe('JSON 키 네이밍 정책 (kebab-case)', () => {
  it('모든 i18n JSON 키가 kebab-case여야 한다 (cat-{Agent,Skill,MCP,Native} 예외)', () => {
    const violations: Violation[] = [];

    // server flat
    for (const lang of LANGS) {
      audit(
        join(PROJECT_ROOT, 'packages/server/locales', `${lang}.json`),
        `server/${lang}.json`,
        violations,
      );
    }
    // web / tui 5 namespace × 4 lang
    for (const pkg of ['web', 'tui']) {
      for (const lang of LANGS) {
        for (const ns of NSS) {
          audit(
            join(PROJECT_ROOT, `packages/${pkg}/locales`, lang, `${ns}.json`),
            `${pkg}/${lang}/${ns}.json`,
            violations,
          );
        }
      }
    }

    if (violations.length > 0) {
      // 중복 제거 (같은 키가 4언어에 동일하게 잘못 들어감 — 한 번만 보고)
      const unique = new Map<string, string[]>();
      for (const v of violations) {
        if (!unique.has(v.key)) unique.set(v.key, []);
        unique.get(v.key)!.push(v.file);
      }
      // eslint-disable-next-line no-console
      console.error(
        `\n[i18n-key-naming] ${unique.size}개 unique 키가 kebab-case 위반:\n` +
          [...unique].slice(0, 15).map(([key, files]) => `  "${key}" (${files.length} files)`).join('\n') +
          `\n→ kebab-case로 변경 (예: camelCase → kebab-case). cat-{Agent|Skill|MCP|Native} 예외.\n`,
      );
    }
    expect(violations).toEqual([]);
  });
});
