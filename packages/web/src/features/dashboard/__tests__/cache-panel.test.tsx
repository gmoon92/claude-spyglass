/**
 * cache-panel.test.tsx — Cache 패널 순수 산술 + CachePanel 골든마스터 (P3-09)
 *
 * computeSessionCacheStats 는 원본 cache-panel.js 와 동치 비교(병존 import).
 * hit-rate 경계(>99/<1)·톤·비율 라벨은 cache-stats.ts 골든마스터로 고정.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  computeSessionCacheStats,
  computeHitRateView,
  computeRatioView,
} from '../cache-stats';
import { CachePanel } from '../CachePanel';

// 구 cache-panel.js 원본 동치 oracle 비교 블록은 P5 데드 vanilla 삭제로 제거됨.
// 합산/제외 규칙은 cache-stats.ts(src) 골든마스터 리터럴로 고정한다.
describe('computeSessionCacheStats — 합산/제외 골든마스터', () => {
  const reqs = [
    { type: 'prompt', cache_read_tokens: 100, cache_creation_tokens: 50, tokens_input: 30 },
    { type: 'tool_call', cache_read_tokens: 200, cache_creation_tokens: 0, tokens_input: 10 },
    { type: 'response', cache_read_tokens: 0, cache_creation_tokens: 20, tokens_input: 5 },
    { type: 'tool_call', event_type: 'pre_tool', cache_read_tokens: 999 }, // 제외
    { type: 'other', cache_read_tokens: 999 }, // 제외
  ];

  it('pre_tool/비-LLM 행 제외 — cacheRead 999 미반영', () => {
    const s = computeSessionCacheStats(reqs);
    expect(s.cacheReadTokens).toBe(300); // 100+200 (999 두 건 제외)
  });

  it('빈/null 입력 → 0 / hitRate 0', () => {
    expect(computeSessionCacheStats(null)).toEqual({
      hitRate: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalInputTokens: 0,
    });
  });
});

describe('computeHitRateView — 경계 어휘 + 톤', () => {
  it('>99% 경계(99 < pctExact < 100)', () => {
    const v = computeHitRateView(0.995); // 99.5%
    expect(v.labelText).toBe('>99%');
    expect(v.pct).toBe(100); // round
    expect(v.legacyToneCls).toBe('is-high');
    expect(v.dsTone).toBe('success');
  });

  it('<1% 경계(0 < pctExact < 1)', () => {
    const v = computeHitRateView(0.005); // 0.5%
    expect(v.labelText).toBe('<1%');
    expect(v.dsTone).toBe('error');
  });

  it('정확히 100% / 0% 는 경계 어휘 아님', () => {
    expect(computeHitRateView(1).labelText).toBe('100%');
    expect(computeHitRateView(0).labelText).toBe('0%');
  });

  it('톤 임계: 70/30 경계', () => {
    expect(computeHitRateView(0.7).dsTone).toBe('success');
    expect(computeHitRateView(0.69).dsTone).toBe('warn'); // round(69)→69 <70
    expect(computeHitRateView(0.3).dsTone).toBe('warn');
    expect(computeHitRateView(0.29).dsTone).toBe('error');
  });
});

describe('computeRatioView — creation/read 비율', () => {
  it('total=0 → create 0 / read 100 / building', () => {
    expect(computeRatioView(0, 0)).toEqual({ createPct: 0, readPct: 100, ratioLabel: 'stable' });
  });
  it('read 우세(≥70%) → stable', () => {
    const v = computeRatioView(20, 80);
    expect(v.createPct).toBe(20);
    expect(v.readPct).toBe(80);
    expect(v.ratioLabel).toBe('stable');
  });
  it('read <70% → building', () => {
    expect(computeRatioView(50, 50).ratioLabel).toBe('building');
  });
});

describe('CachePanel — 골든마스터', () => {
  it('data=null → 미렌더(빈 마크업)', () => {
    expect(renderToStaticMarkup(<CachePanel data={null} />)).toBe('');
  });

  it('정상 → hit fill width/tone + 라벨 + 비율 바 + precision tooltip', () => {
    const html = renderToStaticMarkup(
      <CachePanel
        data={{ hitRate: 0.85, cacheReadTokens: 800, cacheCreationTokens: 200, totalInputTokens: 0 }}
      />,
    );
    expect(html).toContain('id="cacheHitFill"');
    expect(html).toContain('cache-bar-fill is-high ds-bar-fill');
    expect(html).toContain('data-tone="success"');
    expect(html).toContain('width:85%');
    expect(html).toContain('id="cacheHitPct"');
    expect(html).toContain('85%');
    expect(html).toContain('data-tone="creation"');
    expect(html).toContain('data-tone="read"');
    // read 80% → stable
    expect(html).toContain('stable');
    expect(html).toContain('ui:cache-panel.precision-tooltip');
  });

  it('경계 라벨 >99% 도 렌더', () => {
    const html = renderToStaticMarkup(
      <CachePanel
        data={{ hitRate: 0.995, cacheReadTokens: 995, cacheCreationTokens: 5, totalInputTokens: 0 }}
      />,
    );
    expect(html).toContain('&gt;99%'); // JSX escape of >
  });
});
