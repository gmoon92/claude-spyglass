/**
 * LangSwitcher.test.tsx — 언어 스위처 컴포넌트 계약 검증
 *
 * 대체 대상: classic island(#lang-switcher in index.html) + lang-switcher.js(select 바인딩).
 *
 * 검증:
 *  - 마크업 계약: .lang-switcher-wrap > select#lang-switcher[role=combobox][aria-label], <option> 4종이
 *    SUPPORTED_LANGS 와 정확히 일치(과거 i18n-html-css-drift 가드의 HTML SoT 를 컴포넌트로 이전).
 *  - value: select 의 현재 값이 i18n.language 를 추종.
 *  - change 동기: select change 시 react-i18next changeLanguage(lang) + window.I18n.setLang(lang) 둘 다 호출
 *    (date-locale 폴백 동기 — i18n-utils getLocale 이 window.I18n.getLang 을 읽으므로 필수).
 */
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { LangSwitcher } from '../LangSwitcher';
import { SUPPORTED_LANGS, i18next } from '../../lib/i18n';
import { ensureDom } from '../../test-support/ensure-dom';

ensureDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('LangSwitcher — DOM 계약(마크업/셀렉터 보존)', () => {
  it('.lang-switcher-wrap > select#lang-switcher[role=combobox] 구조를 렌더', () => {
    const html = renderToStaticMarkup(<LangSwitcher />);
    expect(html).toContain('class="lang-switcher-wrap"');
    expect(html).toContain('id="lang-switcher"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-label=');
  });

  it('<option> value 집합이 SUPPORTED_LANGS 와 정확히 일치(drift 가드)', () => {
    const html = renderToStaticMarkup(<LangSwitcher />);
    const values = new Set<string>();
    for (const m of html.matchAll(/<option value="(\w+)"/g)) values.add(m[1]);
    expect([...values].sort()).toEqual([...SUPPORTED_LANGS].sort());
  });

  it('각 언어 네이티브 라벨을 option 텍스트로 노출(기존 index.html 1:1)', () => {
    const html = renderToStaticMarkup(<LangSwitcher />);
    expect(html).toContain('한국어');
    expect(html).toContain('English');
    expect(html).toContain('日本語');
    expect(html).toContain('中文');
  });
});

describe('LangSwitcher — value 추종 + change 동기', () => {
  let container: HTMLDivElement;
  let root: Root;
  let setLang: ReturnType<typeof vi.fn>;
  let changeSpy: MockInstance;

  beforeEach(async () => {
    // 레거시 전역 stub — getLang/getSupportedLangs 는 vitest.setup 의 i18next.t 위임과 무관하게 본 테스트 전용.
    setLang = vi.fn(() => Promise.resolve());
    (globalThis as { window: Window & { I18n?: unknown } }).window.I18n = {
      t: (k: string) => k,
      getLang: () => 'ko',
      getSupportedLangs: () => [...SUPPORTED_LANGS],
      setLang,
      onChange: () => () => {},
      init: () => Promise.resolve(),
    } as unknown as Window['I18n'];
    // react-i18next 인스턴스를 알려진 언어로 고정.
    await act(async () => {
      await i18next.changeLanguage('ko');
    });
    changeSpy = vi.spyOn(i18next, 'changeLanguage') as unknown as MockInstance;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    changeSpy.mockRestore();
  });

  it('select.value 가 현재 i18n.language(ko) 를 추종', () => {
    act(() => root.render(<LangSwitcher />));
    const select = container.querySelector<HTMLSelectElement>('#lang-switcher')!;
    expect(select.value).toBe('ko');
  });

  it('change 시 i18next.changeLanguage(lang) + window.I18n.setLang(lang) 둘 다 호출', () => {
    act(() => root.render(<LangSwitcher />));
    const select = container.querySelector<HTMLSelectElement>('#lang-switcher')!;
    act(() => {
      select.value = 'en';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(changeSpy).toHaveBeenCalledWith('en');
    expect(setLang).toHaveBeenCalledWith('en');
  });

  it('미지원 값은 무시(changeLanguage/setLang 미호출)', () => {
    act(() => root.render(<LangSwitcher />));
    const select = container.querySelector<HTMLSelectElement>('#lang-switcher')!;
    // 미지원 옵션을 강제로 주입(브라우저상 발생 가능성은 낮지만 가드 검증).
    const opt = document.createElement('option');
    opt.value = 'fr';
    select.appendChild(opt);
    changeSpy.mockClear();
    setLang.mockClear();
    act(() => {
      select.value = 'fr';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(changeSpy).not.toHaveBeenCalled();
    expect(setLang).not.toHaveBeenCalled();
  });
});
