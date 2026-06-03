/**
 * i18n-legacy-bridge.test.ts — 레거시→react 언어 브릿지 회귀 가드 (lang-switch 회귀)
 *
 * 배경: main.tsx 는 type=module(deferred)이라 레거시 i18n.js 의 DOMContentLoaded init 보다 먼저 실행된다.
 *   그 시점 레거시 getLang() 은 미초기화 기본값 'ko'(i18n.js:26)를 돌려준다. 과거 부팅 코드가 그 값으로
 *   react-i18next 를 changeLanguage 해 `?lang=en` 으로 올바르게 en 으로 뜬 react 를 ko 로 고착시켰다
 *   (페이지 전체 한국어 — update-badge i18n 회귀의 상위 원인).
 *
 * 가드: 브릿지는 (1) 부팅 시 절대 changeLanguage 를 호출하지 않는다(레거시 getLang() 무관) —
 *   초기 언어는 react init(resolveInitialLang)이 SSoT. (2) 레거시 onChange(런타임 전환)만 전파한다.
 *   회귀(부팅 eager changeLanguage 재도입)가 생기면 (1) 이 깨진다.
 */
import { describe, it, expect, vi } from 'vitest';
import { bridgeLegacyI18n } from '../i18n-legacy-bridge';

describe('bridgeLegacyI18n — 초기 언어는 react init SSoT, 런타임 전환만 브릿지', () => {
  it('부팅 시 changeLanguage 를 호출하지 않는다(레거시 미초기화 기본값으로 덮어쓰기 금지)', () => {
    const changeLanguage = vi.fn();
    // 레거시가 미초기화 기본값 'ko' 를 노출해도(getLang) 무시해야 한다 — onChange 만 구독.
    const legacy = { getLang: () => 'ko', onChange: vi.fn() };
    bridgeLegacyI18n({ changeLanguage }, legacy);
    expect(changeLanguage).not.toHaveBeenCalled();
    expect(legacy.onChange).toHaveBeenCalledTimes(1);
  });

  it('레거시 onChange(런타임 전환) 발화 시 changeLanguage 로 전파한다', () => {
    const changeLanguage = vi.fn();
    let fired: ((lng: string) => void) | undefined;
    const legacy = { onChange: (fn: (lng: string) => void) => { fired = fn; } };
    bridgeLegacyI18n({ changeLanguage }, legacy);
    expect(changeLanguage).not.toHaveBeenCalled();
    fired?.('en');
    expect(changeLanguage).toHaveBeenCalledTimes(1);
    expect(changeLanguage).toHaveBeenCalledWith('en');
    fired?.('ja');
    expect(changeLanguage).toHaveBeenLastCalledWith('ja');
  });

  it('레거시 부재(SSR/스텁) 시 no-op — throw 하지 않는다', () => {
    const changeLanguage = vi.fn();
    expect(() => bridgeLegacyI18n({ changeLanguage }, undefined)).not.toThrow();
    expect(changeLanguage).not.toHaveBeenCalled();
  });
});
