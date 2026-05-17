// HTML/CSS lang 인프라 drift 회귀 방지.
//
// 시나리오 1 (HTML drift):
//   누군가 SUPPORTED_LANGS에 'fr' 추가 후 HTML lang-switcher 옵션 갱신 안 함
//   → fr 사용자가 lang-switcher에서 자신의 언어를 선택할 수 없음
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
  it('HTML lang-switcher 옵션이 SUPPORTED_LANGS와 정확히 일치해야 한다', () => {
    const html = readFileSync(join(PROJECT_ROOT, 'packages/web/index.html'), 'utf-8');
    const options = new Set<string>();
    for (const m of html.matchAll(/<option\s+value=["'](\w+)["']/g)) {
      options.add(m[1]);
    }

    const supported = new Set(SUPPORTED_LANGS);
    const missingInHtml = SUPPORTED_LANGS.filter((l) => !options.has(l));
    const extraInHtml = [...options].filter((l) => !supported.has(l) && l !== '').filter((v) => !['true', 'false'].includes(v));

    if (missingInHtml.length > 0 || extraInHtml.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `\n[html-lang-drift] HTML과 SUPPORTED_LANGS drift:\n` +
          `  HTML에 누락: [${missingInHtml.join(',') || '없음'}]\n` +
          `  SUPPORTED_LANGS에 없는 HTML 옵션: [${extraInHtml.join(',') || '없음'}]\n` +
          `→ packages/web/index.html의 <select id="lang-switcher"> 옵션을 동기화하세요.\n`,
      );
    }
    expect(missingInHtml).toEqual([]);
    expect(extraInHtml).toEqual([]);
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
