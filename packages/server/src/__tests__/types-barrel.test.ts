/**
 * @spyglass/types barrel 회귀 방지 — 각 module의 export가 barrel(index.ts)에서 re-export되는지 정적 검증.
 *
 * 시나리오:
 *   누군가 types/src/i18n.ts에 새 export 추가 후 index.ts 갱신 깜빡 → 의존 패키지에서 import 실패
 *   (이전 incident: Lang/DEFAULT_LANG/resolveLang re-export 누락으로 i18n 빌드 깨짐).
 *
 * 동작:
 *   types/src/*.ts (index 제외)의 모든 named export를 grep하고, 그 식별자가
 *   index.ts의 export 구문에 포함됐는지 확인. 누락 시 fail.
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../../../..');
const TYPES_SRC = join(PROJECT_ROOT, 'packages/types/src');

function extractNamedExports(src: string): string[] {
  const names: string[] = [];
  // export type X = ... / export type { X, Y }
  for (const m of src.matchAll(/^\s*export\s+(?:type\s+)?(?:const|function|interface|class|enum)\s+(\w+)/gm)) {
    names.push(m[1]);
  }
  for (const m of src.matchAll(/^\s*export\s+type\s+(\w+)\s*=/gm)) {
    names.push(m[1]);
  }
  return names;
}

describe('@spyglass/types barrel re-export', () => {
  it('각 module의 export가 index.ts에서 모두 re-export돼야 한다', () => {
    const indexSrc = readFileSync(join(TYPES_SRC, 'index.ts'), 'utf-8');

    const missing: { module: string; symbol: string }[] = [];
    for (const file of readdirSync(TYPES_SRC)) {
      if (!file.endsWith('.ts') || file === 'index.ts') continue;
      const modName = file.replace(/\.ts$/, '');
      const src = readFileSync(join(TYPES_SRC, file), 'utf-8');
      const exports = extractNamedExports(src);
      for (const sym of exports) {
        // index.ts에 해당 식별자가 명시적으로 포함됐는지 (word boundary로 정확 매칭)
        const re = new RegExp(`\\b${sym}\\b`);
        if (!re.test(indexSrc)) {
          missing.push({ module: modName, symbol: sym });
        }
      }
    }

    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `\n[types-barrel] ${missing.length}건 누락:\n` +
          missing.map(({ module, symbol }) => `  ${symbol} (defined in ${module}.ts, not re-exported in index.ts)`).join('\n') +
          `\n→ packages/types/src/index.ts에 'export { ${missing[0]?.symbol} } from "./${missing[0]?.module}"' 추가\n`,
      );
    }
    expect(missing).toEqual([]);
  });
});
