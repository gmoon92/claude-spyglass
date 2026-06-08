import { describe, it, expect, beforeEach } from 'vitest';
import { modelClassOf, modelChipLabel, modelChipHtml } from '../model-classify';

// model-classify 의 i18n 라벨(모델불명·SDK 합성·모델 정보 없음) 출력을 고정하는 특성화 테스트.
//
// 목적(react-i18next 단일화): modelChipLabel/modelChipHtml 의 i18n 라벨은 lib/i18n.ts 의 i18next
//   인스턴스(i18next.t)로 해석된다. vitest.setup.ts 가 i18next.t 를 테스트 t 로 위임하므로, 아래 ko
//   라벨이 i18next.t 출력으로 관측된다(키 문자열 불변). afterEach 자동 복원 대응으로 beforeEach 재주입.
beforeEach(() => {
  globalThis.__setTestT?.((key) => {
    const map: Record<string, string> = {
      'badges:renderers.model.unknown': '모델불명',
      'badges:renderers.model.synthetic': 'SDK 합성',
      'badges:renderers.model.no-info': '모델 정보 없음',
    };
    return map[key] ?? key;
  });
});

describe('modelClassOf', () => {
  it('claude family 매핑', () => {
    expect(modelClassOf('claude-3-5-haiku-20241022')).toBe('haiku');
    expect(modelClassOf('claude-sonnet-4-5-20250929')).toBe('sonnet');
    expect(modelClassOf('claude-opus-4-7-20260101')).toBe('opus');
  });
  it('synthetic / external / unknown', () => {
    expect(modelClassOf('<synthetic>')).toBe('synthetic');
    expect(modelClassOf('synthetic')).toBe('synthetic');
    expect(modelClassOf('kimi-k2-0905-preview')).toBe('external');
    expect(modelClassOf(null)).toBe('unknown');
    expect(modelClassOf('gpt-4')).toBe('unknown');
  });
});

describe('modelChipLabel — i18n 라벨 고정', () => {
  it('unknown → "모델불명"', () => {
    expect(modelChipLabel(null, 'unknown')).toBe('모델불명');
  });
  it('synthetic → "SDK 합성"', () => {
    expect(modelChipLabel('<synthetic>', 'synthetic')).toBe('SDK 합성');
  });
  it('claude 신형 → "Family Major.Minor"', () => {
    expect(modelChipLabel('claude-sonnet-4-5-20250929', 'sonnet')).toBe('Sonnet 4.5');
    expect(modelChipLabel('claude-opus-4-7-20260101', 'opus')).toBe('Opus 4.7');
  });
  it('external(kimi) → 앞 2토큰 capitalized', () => {
    expect(modelChipLabel('kimi-k2-0905-preview', 'external')).toBe('Kimi k2');
  });
});

describe('modelChipHtml — data-tip 라벨 고정', () => {
  it('model null → data-tip 에 "모델 정보 없음"', () => {
    const html = modelChipHtml(null);
    expect(html).toContain('data-tip="모델 정보 없음"');
    expect(html).toContain('모델불명');
    expect(html).toContain('data-tone="unknown"');
  });
  it('정상 model → data-tip 에 풀네임 + 라벨', () => {
    const html = modelChipHtml({ model: 'claude-sonnet-4-5-20250929' });
    expect(html).toContain('data-tip="claude-sonnet-4-5-20250929"');
    expect(html).toContain('Sonnet 4.5');
    expect(html).toContain('data-tone="sonnet"');
  });
});
