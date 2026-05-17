/**
 * detect-lang.test.ts — detectLang() 우선순위 검증.
 *
 * 우선순위:
 *   1. CLI 플래그 (--lang ko | --lang=ko)
 *   2. SPYGLASS_LANG 환경변수
 *   3. LANG / LC_ALL 환경변수
 *   4. DEFAULT_LANG ('ko')
 */

import { describe, expect, test } from 'bun:test';
import { detectLang } from '../lib/detect-lang';

describe('detectLang — CLI flag (priority 1)', () => {
  test('--lang ko (space form)', () => {
    expect(detectLang(['--lang', 'ko'], {})).toBe('ko');
  });

  test('--lang en (space form)', () => {
    expect(detectLang(['--lang', 'en'], {})).toBe('en');
  });

  test('--lang=ja (equals form)', () => {
    expect(detectLang(['--lang=ja'], {})).toBe('ja');
  });

  test('--lang=zh (equals form)', () => {
    expect(detectLang(['--lang=zh'], {})).toBe('zh');
  });

  test('CLI flag takes priority over SPYGLASS_LANG', () => {
    expect(detectLang(['--lang', 'en'], { SPYGLASS_LANG: 'ja' })).toBe('en');
  });

  test('CLI flag takes priority over LANG env', () => {
    expect(detectLang(['--lang=zh'], { LANG: 'ko_KR.UTF-8' })).toBe('zh');
  });

  test('unknown CLI lang value is ignored — falls through', () => {
    // 'fr' is not a supported lang; should fall through to SPYGLASS_LANG
    expect(detectLang(['--lang', 'fr'], { SPYGLASS_LANG: 'en' })).toBe('en');
  });

  test('--lang without next arg is ignored', () => {
    expect(detectLang(['--lang'], { SPYGLASS_LANG: 'ja' })).toBe('ja');
  });
});

describe('detectLang — SPYGLASS_LANG (priority 2)', () => {
  test('exact lang code', () => {
    expect(detectLang([], { SPYGLASS_LANG: 'en' })).toBe('en');
  });

  test('locale format ko-KR → ko', () => {
    expect(detectLang([], { SPYGLASS_LANG: 'ko-KR' })).toBe('ko');
  });

  test('locale format ja_JP → ja', () => {
    expect(detectLang([], { SPYGLASS_LANG: 'ja_JP' })).toBe('ja');
  });

  test('SPYGLASS_LANG takes priority over LANG', () => {
    expect(detectLang([], { SPYGLASS_LANG: 'zh', LANG: 'en_US.UTF-8' })).toBe('zh');
  });

  test('unknown SPYGLASS_LANG falls through to LANG', () => {
    expect(detectLang([], { SPYGLASS_LANG: 'fr', LANG: 'ja_JP.UTF-8' })).toBe('ja');
  });
});

describe('detectLang — LANG / LC_ALL env (priority 3)', () => {
  test('LANG ko_KR.UTF-8 → ko', () => {
    expect(detectLang([], { LANG: 'ko_KR.UTF-8' })).toBe('ko');
  });

  test('LANG en_US.UTF-8 → en', () => {
    expect(detectLang([], { LANG: 'en_US.UTF-8' })).toBe('en');
  });

  test('LANG ja_JP.UTF-8 → ja', () => {
    expect(detectLang([], { LANG: 'ja_JP.UTF-8' })).toBe('ja');
  });

  test('LANG zh_CN.UTF-8 → zh', () => {
    expect(detectLang([], { LANG: 'zh_CN.UTF-8' })).toBe('zh');
  });

  test('LC_ALL takes priority over LANG', () => {
    expect(detectLang([], { LC_ALL: 'en_US.UTF-8', LANG: 'ko_KR.UTF-8' })).toBe('en');
  });

  test('unknown LANG falls through to DEFAULT_LANG', () => {
    expect(detectLang([], { LANG: 'fr_FR.UTF-8' })).toBe('ko');
  });
});

describe('detectLang — DEFAULT_LANG fallback (priority 4)', () => {
  test('no args, empty env → ko', () => {
    expect(detectLang([], {})).toBe('ko');
  });

  test('all unknown inputs → ko', () => {
    expect(detectLang(['--verbose'], { SPYGLASS_LANG: 'xx', LANG: 'zz' })).toBe('ko');
  });
});
