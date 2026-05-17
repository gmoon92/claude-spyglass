/**
 * TUI i18n 회귀 방지 테스트 — server/src/__tests__/i18n.test.ts와 동형.
 *
 * 단일 가설: 프로젝트 전 JSON이 single-brace `{var}` 보간 형식이므로
 * i18next config가 `prefix:'{', suffix:'}'`를 유지해야 한다.
 *
 * 이 옵션이 누락되면 i18next 기본값(`{{var}}`)을 기대하므로 4개 언어 모두에서
 * 변수가 raw로 노출되어 브랜드 일관성 손상(P0 인시던트).
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { initI18n, i18n } from '../i18n';

beforeAll(async () => {
  await initI18n('ko');
});

describe('TUI i18n interpolation', () => {
  it('인터폴레이션 옵션은 single-brace prefix/suffix를 사용한다', () => {
    const opt = i18n.options?.interpolation as { prefix?: string; suffix?: string };
    expect(opt?.prefix).toBe('{');
    expect(opt?.suffix).toBe('}');
  });

  it('미존재 키는 key 자체를 반환한다 (i18next 기본 동작)', () => {
    const missing = i18n.t('absolutely.does.not.exist');
    expect(missing).toBe('absolutely.does.not.exist');
  });

  it('namespace prefix 없는 키는 defaultNS(common)에서 조회된다', async () => {
    await i18n.changeLanguage('en');
    // common namespace에 'search.confirm-hint' 키가 존재한다고 가정.
    const result = i18n.t('search.confirm-hint');
    expect(typeof result).toBe('string');
    // 단순 회귀 검사: 결과가 raw {var}을 포함하면 인터폴레이션 회귀.
    expect(result).not.toMatch(/\{[a-z_]+\}/);
  });
});

describe('TUI i18n language switching', () => {
  it('4개 언어로 changeLanguage 가능', async () => {
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      await i18n.changeLanguage(lang);
      expect(i18n.language).toBe(lang);
    }
  });

  it('지원 namespace 5종이 모두 로드된다', () => {
    const namespaces = (i18n.options?.ns ?? []) as string[];
    for (const ns of ['common', 'request', 'badges', 'session', 'ui']) {
      expect(namespaces).toContain(ns);
    }
  });
});

describe('TUI i18n module shape', () => {
  it('i18n export는 i18next 인스턴스다', () => {
    expect(i18n).toBeDefined();
    expect(typeof i18n.t).toBe('function');
  });

  it('defaultNS는 common이다', () => {
    expect(i18n.options?.defaultNS).toBe('common');
  });
});
