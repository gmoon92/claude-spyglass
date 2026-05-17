// Namespace 간 키 path 중복 회귀 방지.
//
// 시나리오 (이전 발견 사례 — iteration #20):
//   `stat-tooltip.*` 17개 키가 ui와 badges 양쪽에 완전히 동일 값으로 중복 정의.
//   i18n.js의 fallback 로직(모든 ns 순회)이 우연히 동작해 사용자에게 정상 보였음.
//   그러나 ui에서만 값 수정 시 badges가 먼저 hit돼 옛 번역 노출 — silent SSoT 위반.
//
// 검증:
//   같은 path(예: stat-tooltip.X.title)가 두 개 이상의 namespace에 정의되면 fail.
//   path는 ns prefix 제외한 형태로 비교.

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../../../..');
const NSS = ['common', 'request', 'badges', 'session', 'ui'] as const;

function flatten(obj: unknown, prefix: string[], out: Map<string, string>) {
  if (obj === null || typeof obj !== 'object') return;
  for (const k of Object.keys(obj as Record<string, unknown>)) {
    const p = [...prefix, k];
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v === 'string') out.set(p.join('.'), v);
    else if (typeof v === 'object') flatten(v, p, out);
  }
}

describe('Namespace 간 키 path 중복 회귀 방지', () => {
  for (const pkg of ['web', 'tui'] as const) {
    it(`${pkg}/locales: 동일 path가 두 namespace 이상에 정의되면 안 된다`, () => {
      const byPath = new Map<string, string[]>();
      for (const ns of NSS) {
        const file = join(PROJECT_ROOT, `packages/${pkg}/locales/ko/${ns}.json`);
        let data;
        try { data = JSON.parse(readFileSync(file, 'utf-8')); } catch { continue; }
        const flat = new Map<string, string>();
        flatten(data, [], flat);
        for (const p of flat.keys()) {
          if (!byPath.has(p)) byPath.set(p, []);
          byPath.get(p)!.push(ns);
        }
      }

      const dups: { path: string; namespaces: string[] }[] = [];
      for (const [path, namespaces] of byPath) {
        if (namespaces.length > 1) dups.push({ path, namespaces });
      }

      if (dups.length > 0) {
        // eslint-disable-next-line no-console
        console.error(
          `\n[i18n-ns-dup] ${pkg}: ${dups.length}건 path가 2개 이상 namespace에 중복 정의:\n` +
            dups.slice(0, 15).map((d) => `  "${d.path}" → [${d.namespaces.join(', ')}]`).join('\n') +
            `\n→ SSoT 위반. 의미상 가장 맞는 ns에만 두고 다른 ns에서 제거하세요.\n`,
        );
      }
      expect(dups).toEqual([]);
    });
  }
});
