/**
 * i18n 회귀 방지 테스트 — 단일 가설: 프로젝트 전 JSON이 single-brace `{var}`
 * 보간 형식이므로 i18next config가 `prefix:'{', suffix:'}'`를 유지해야 한다.
 *
 * 이 옵션이 누락되면 i18next 기본값(`{{var}}`)을 기대하므로 4개 언어 모두에서
 * 변수가 raw로 노출되어 브랜드 일관성 손상(P0 인시던트).
 *
 * 테스트 대상:
 *  - t(): 인터폴레이션 정상 동작
 *  - 4개 언어 모두에서 동일 키가 번역되고 변수가 치환됨
 *  - 미존재 키는 key 자체를 폴백으로 반환
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { t, i18n, detectLang } from '../i18n';

beforeAll(() => {
  // 모듈 초기 import 시점에서 init되지 않았을 수 있어 첫 t() 호출로 트리거.
  t('cli.usage');
});

describe('i18n interpolation', () => {
  it('single-brace {var} 보간이 4개 언어 모두에서 동작한다', async () => {
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      await i18n.changeLanguage(lang);
      const result = t('doctor.fail-summary', { fail: 3, warn: 7 });
      // 변수가 raw로 남아있으면 회귀.
      expect(result).not.toContain('{fail}');
      expect(result).not.toContain('{warn}');
      // 값이 포함되어야 함.
      expect(result).toContain('3');
      expect(result).toContain('7');
    }
  });

  it('단일 변수 보간', async () => {
    await i18n.changeLanguage('en');
    const result = t('doctor.warn-summary', { warn: 5 });
    expect(result).not.toContain('{warn}');
    expect(result).toContain('5');
  });

  it('인터폴레이션 옵션은 single-brace prefix/suffix를 사용한다', () => {
    const opt = i18n.options?.interpolation as { prefix?: string; suffix?: string };
    expect(opt?.prefix).toBe('{');
    expect(opt?.suffix).toBe('}');
  });

  it('미존재 키는 key 자체를 반환한다 (i18next 기본 동작)', () => {
    const missing = t('absolutely.does.not.exist');
    expect(missing).toBe('absolutely.does.not.exist');
  });
});

describe('i18n language switching', () => {
  it('각 언어별로 doctor.title이 다르게 번역된다', async () => {
    const titles = new Set<string>();
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      await i18n.changeLanguage(lang);
      titles.add(t('doctor.title'));
    }
    // 4개 언어가 모두 서로 다른 번역을 가져야 함.
    expect(titles.size).toBe(4);
  });

  it('이중 보간(같은 결과를 t로 재호출)에서 변수가 깨지지 않는다', async () => {
    // 시나리오: doctor.ts가 t('doctor.fail-summary', vars)로 번역한 결과를
    // log() → output.ts의 t(message)에 한번 더 통과시킬 때, 이미 번역된 문자열은
    // 미존재 키로 처리되어 그대로 반환되어야 한다 (회귀 방지).
    await i18n.changeLanguage('en');
    const translated = t('doctor.fail-summary', { fail: 1, warn: 2 });
    const twice = t(translated);
    expect(twice).toBe(translated);
  });
});

describe('i18n module shape', () => {
  it('i18n export는 i18next 인스턴스다', () => {
    expect(i18n).toBeDefined();
    expect(typeof i18n.t).toBe('function');
  });
});

describe('detectLang priority (TUI와 일관성)', () => {
  it('1. --lang CLI flag가 SPYGLASS_LANG보다 우선', () => {
    expect(detectLang(['--lang', 'en'], { SPYGLASS_LANG: 'ja' })).toBe('en');
    expect(detectLang(['--lang=zh'], { SPYGLASS_LANG: 'ja' })).toBe('zh');
  });

  it('2. SPYGLASS_LANG이 LANG보다 우선', () => {
    expect(detectLang([], { SPYGLASS_LANG: 'en', LANG: 'ko_KR.UTF-8' })).toBe('en');
  });

  it('3. LANG이 default보다 우선 (ko_KR.UTF-8 → ko)', () => {
    expect(detectLang([], { LANG: 'ja_JP.UTF-8' })).toBe('ja');
    expect(detectLang([], { LANG: 'zh-Hans-CN' })).toBe('zh');
  });

  it('4. 미지원 lang은 폴백 흐름으로 떨어진다', () => {
    expect(detectLang(['--lang', 'fr'], { SPYGLASS_LANG: 'en' })).toBe('en');
    expect(detectLang([], { SPYGLASS_LANG: 'fr', LANG: 'ja_JP' })).toBe('ja');
  });

  it('5. 아무것도 없으면 DEFAULT_LANG (ko)', () => {
    expect(detectLang([], {})).toBe('ko');
  });
});
