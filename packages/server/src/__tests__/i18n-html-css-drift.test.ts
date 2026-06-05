// HTML/CSS lang 인프라 drift 회귀 방지.
//
// 시나리오 1 (lang-switcher 라벨 drift):
//   누군가 SUPPORTED_LANGS에 'fr' 추가 후 LangSwitcher 컴포넌트의 LANG_LABELS 갱신 안 함
//   → fr 사용자가 lang-switcher에서 코드('fr') 만 보고 네이티브 라벨을 못 봄
//   (#lang-switcher 는 index.html 정적 <option> → React 컴포넌트(LangSwitcher.tsx)로 전환됨.
//    옵션은 SUPPORTED_LANGS.map() 으로 생성되므로 옵션 집합 자체는 구조적으로 drift 불가하고,
//    유일한 drift 위험은 LANG_LABELS 누락이다.)
//
// 시나리오 2 (CSS drift):
//   누군가 :lang(ko) selector 추가 후 :lang(ja)/:lang(zh) 누락
//   → ja/zh 사용자에게 영어 기본 fallback만 노출 (의도와 다름)

import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../../../..');
const SUPPORTED_LANGS = ['ko', 'en', 'ja', 'zh']; // packages/types/src/i18n.ts와 SSoT
const REQUIRED_LANG_BRANCHES = ['ko', 'ja', 'zh']; // CSS :lang() — en은 기본 fallback

describe('HTML/CSS lang 인프라 drift 회귀 방지', () => {
  it('LangSwitcher LANG_LABELS 가 SUPPORTED_LANGS 를 모두 커버해야 한다', () => {
    const tsx = readFileSync(join(PROJECT_ROOT, 'packages/web/src/components/LangSwitcher.tsx'), 'utf-8');
    // LANG_LABELS 객체 리터럴의 키를 추출(예: `ko: '한국어',`).
    const block = tsx.match(/LANG_LABELS\s*:\s*Record<[^>]*>\s*=\s*\{([\s\S]*?)\}/);
    expect(block).not.toBeNull();
    const labels = new Set<string>();
    for (const m of block![1].matchAll(/(\w+)\s*:/g)) {
      labels.add(m[1]);
    }

    const supported = new Set(SUPPORTED_LANGS);
    const missingLabels = SUPPORTED_LANGS.filter((l) => !labels.has(l));
    const extraLabels = [...labels].filter((l) => !supported.has(l));

    if (missingLabels.length > 0 || extraLabels.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `\n[lang-label-drift] LangSwitcher LANG_LABELS 와 SUPPORTED_LANGS drift:\n` +
          `  LANG_LABELS에 누락: [${missingLabels.join(',') || '없음'}]\n` +
          `  SUPPORTED_LANGS에 없는 라벨: [${extraLabels.join(',') || '없음'}]\n` +
          `→ packages/web/src/components/LangSwitcher.tsx 의 LANG_LABELS 를 동기화하세요.\n`,
      );
    }
    expect(missingLabels).toEqual([]);
    expect(extraLabels).toEqual([]);
  });

  it('CSS :lang() selector 블록은 ko/ja/zh 3언어 모두 정의돼야 한다 (en은 기본 fallback)', () => {
    const cssDir = join(PROJECT_ROOT, 'packages/web/assets/css');
    const langSelectorsByBlock = new Map<string, Set<string>>();

    for (const file of readdirSync(cssDir)) {
      if (!file.endsWith('.css')) continue;
      const css = readFileSync(join(cssDir, file), 'utf-8');
      for (const m of css.matchAll(/:lang\((\w+)\)\s+([^{]+)\{/g)) {
        const lang = m[1];
        const selector = m[2].trim();
        if (!langSelectorsByBlock.has(selector)) langSelectorsByBlock.set(selector, new Set());
        langSelectorsByBlock.get(selector)!.add(lang);
      }
    }

    const incomplete: { selector: string; missing: string[] }[] = [];
    for (const [selector, langs] of langSelectorsByBlock) {
      const missing = REQUIRED_LANG_BRANCHES.filter((l) => !langs.has(l));
      if (missing.length > 0) {
        incomplete.push({ selector, missing });
      }
    }

    if (incomplete.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `\n[css-lang-drift] ${incomplete.length}건 CSS :lang() 분기 불완전:\n` +
          incomplete.map((i) => `  ${i.selector} → missing [${i.missing.join(',')}]`).join('\n') +
          `\n→ 누락 언어 :lang() 규칙을 동일 selector로 추가하세요.\n`,
      );
    }
    expect(incomplete).toEqual([]);
  });
});
