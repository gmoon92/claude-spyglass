import { describe, it, expect, beforeAll } from 'vitest';
import { modelClassOf, modelChipLabel, modelChipHtml } from '../model-classify';

// model-classify 의 i18n 라벨(모델불명·SDK 합성·모델 정보 없음) 출력을 고정하는 특성화 테스트.
//
// 목적(window.I18n 브릿지 제거): modelChipLabel/modelChipHtml 의 i18n 라벨은 원래 전역 window.I18n.t
//   를 직접 호출했고, 이를 lib/i18n.ts 의 i18next 인스턴스로 대체한다. 두 경로의 출력이 동일함을
//   고정한다(키 문자열 불변). vitest.setup.ts 가 i18next.t 를 window.I18n.t(아래 stub)로 위임 패치하므로,
//   본 stub 의 ko 라벨이 양쪽(window.I18n.t / i18next.t) 모두에서 동일 출력으로 관측된다.
beforeAll(() => {
  (globalThis as { window: { I18n?: unknown } }).window.I18n = {
    t: (key: string) => {
      const map: Record<string, string> = {
        'badges.renderers.model.unknown': '모델불명',
        'badges.renderers.model.synthetic': 'SDK 합성',
        'badges.renderers.model.no-info': '모델 정보 없음',
      };
      return map[key] ?? key;
    },
  };
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

describe('modelChipHtml — title 라벨 고정', () => {
  it('model null → title 에 "모델 정보 없음"', () => {
    const html = modelChipHtml(null);
    expect(html).toContain('title="모델 정보 없음"');
    expect(html).toContain('모델불명');
    expect(html).toContain('data-tone="unknown"');
  });
  it('정상 model → title 에 풀네임 + 라벨', () => {
    const html = modelChipHtml({ model: 'claude-sonnet-4-5-20250929' });
    expect(html).toContain('title="claude-sonnet-4-5-20250929"');
    expect(html).toContain('Sonnet 4.5');
    expect(html).toContain('data-tone="sonnet"');
  });
});
