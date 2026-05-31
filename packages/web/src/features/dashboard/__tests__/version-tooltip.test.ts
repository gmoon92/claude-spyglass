/**
 * version-tooltip.test.ts — version-check 순수 로직 + tooltip 위치/콘텐츠 키 (P3-09)
 *
 * 원본 version-check.js normalizeTag/isSameVersion + tooltip position 산술 골든마스터.
 */
import { describe, it, expect } from 'vitest';
import { normalizeTag, isSameVersion, tSafe, resolveBadgeState } from '../version-check-logic';
import {
  positionNearCursor,
  positionAbovePoint,
  parseCacheTokens,
  tooltipContentKeys,
  OBS_TOOLTIP_KEYS,
  CACHE_PANEL_TOOLTIP_KEYS,
  STAT_TOOLTIP_KEYS,
} from '../tooltip';

describe('version-check-logic — normalizeTag/isSameVersion', () => {
  it('normalizeTag: v/V 접두사 + trim 제거', () => {
    expect(normalizeTag(' v1.2.3 ')).toBe('1.2.3');
    expect(normalizeTag('V1.2.3')).toBe('1.2.3');
    expect(normalizeTag('1.2.3')).toBe('1.2.3');
    expect(normalizeTag(null)).toBe('');
    expect(normalizeTag(42)).toBe('');
  });
  it('isSameVersion: 정규화 후 비교 + 빈 문자열 매칭 제외', () => {
    expect(isSameVersion('v1.2.3', '1.2.3')).toBe(true);
    expect(isSameVersion('1.2.3', '1.2.4')).toBe(false);
    expect(isSameVersion('', '')).toBe(false); // 빈 매칭 제외
    expect(isSameVersion(null, undefined)).toBe(false);
  });
  it('tSafe: 키 그대로 반환 시 fallback', () => {
    const t = (k: string) => (k === 'known' ? '번역됨' : k);
    expect(tSafe(t, 'known', undefined, 'fb')).toBe('번역됨');
    expect(tSafe(t, 'unknown', undefined, 'fb')).toBe('fb'); // t 가 key 그대로 → fallback
    expect(tSafe(null, 'x', undefined, 'fb')).toBe('fb');
  });
  it('resolveBadgeState: available/latest/loading', () => {
    expect(resolveBadgeState({ updateAvailable: true, currentVersion: '1.0.0', latestTag: '1.1.0' })).toBe('available');
    // updateAvailable 이지만 동일 버전 → available 아님(ADR-001 억제)
    expect(resolveBadgeState({ updateAvailable: true, currentVersion: '1.0.0', latestTag: 'v1.0.0' })).toBe('latest');
    expect(resolveBadgeState({ currentVersion: '1.0.0' })).toBe('latest');
    expect(resolveBadgeState({})).toBe('loading');
  });
});

describe('tooltip — 위치 산술', () => {
  const vp = { width: 1000, height: 800 };
  const size = { width: 240, height: 60 };

  it('positionNearCursor: 기본 (x+8, y+12)', () => {
    expect(positionNearCursor({ x: 100, y: 100 }, size, vp)).toEqual({ x: 108, y: 112 });
  });
  it('우측 넘침 → 왼쪽으로 뒤집기', () => {
    const p = positionNearCursor({ x: 900, y: 100 }, size, vp);
    expect(p.x).toBe(900 - 240 - 8);
  });
  it('하단 넘침 → 위로 뒤집기', () => {
    const p = positionNearCursor({ x: 100, y: 790 }, size, vp);
    expect(p.y).toBe(790 - 60 - 8);
  });
  it('positionAbovePoint: 기본 점 위 배치', () => {
    expect(positionAbovePoint({ x: 100, y: 200 }, size, vp)).toEqual({ x: 112, y: 200 - 60 - 10 });
  });
  it('positionAbovePoint: 상단 넘침(y<4) → 아래로', () => {
    const p = positionAbovePoint({ x: 100, y: 20 }, size, vp);
    expect(p.y).toBe(20 + 12);
  });
});

describe('tooltip — 콘텐츠 키 레지스트리', () => {
  it('obs 키 집합(카드4+카테고리4+anomaly)', () => {
    expect(OBS_TOOLTIP_KEYS).toContain('burn-rate');
    expect(OBS_TOOLTIP_KEYS).toContain('cat-Agent');
    expect(OBS_TOOLTIP_KEYS).toContain('anomaly');
    expect(OBS_TOOLTIP_KEYS).toHaveLength(9);
  });
  it('cache-panel 키 / stat 키', () => {
    expect([...CACHE_PANEL_TOOLTIP_KEYS]).toEqual(['hit-rate', 'ratio']);
    expect(STAT_TOOLTIP_KEYS).toContain('p95');
  });
  it('tooltipContentKeys: ui.<ns>.<key>.title|desc', () => {
    expect(tooltipContentKeys('obs-tooltip', 'burn-rate')).toEqual({
      titleKey: 'ui.obs-tooltip.burn-rate.title',
      descKey: 'ui.obs-tooltip.burn-rate.desc',
    });
  });
  it('parseCacheTokens: read/write parseInt || 0', () => {
    expect(parseCacheTokens('1500', '300')).toEqual({ read: 1500, write: 300 });
    expect(parseCacheTokens(undefined, 'x')).toEqual({ read: 0, write: 0 });
  });
});
