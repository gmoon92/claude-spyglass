/**
 * get-date-range.test.ts — 활성 range 계산 단위 테스트
 *
 * date-range-filter ADR-001/002/003 검증:
 *   - discriminated union 모델 (preset / custom)
 *   - 출력 계약: {} | {from:number, to:number}
 *   - normalize 어댑터 (문자열 입력 호환)
 *   - now 주입으로 TZ 의존 제거 (computeRange 순수 함수)
 */

import { describe, it, expect } from 'vitest';
import {
  computeRange,
  setActiveRange, getActiveRange, getDateRange,
} from '../api.js';

const HOUR = 60 * 60 * 1000;
const DAY  = 24 * HOUR;

describe('computeRange — preset 7종 (now 주입)', () => {
  const now = new Date('2026-05-18T10:30:00').getTime(); // 로컬 시간 가정

  it('preset all → {}', () => {
    expect(computeRange({ type: 'preset', value: 'all' }, now)).toEqual({});
  });

  it('preset 1h → now - 1h ~ now', () => {
    const r = computeRange({ type: 'preset', value: '1h' }, now);
    expect(r).toEqual({ from: now - HOUR, to: now });
  });

  it('preset today → 로컬 자정 ~ now', () => {
    const r = computeRange({ type: 'preset', value: 'today' }, now) as { from: number; to: number };
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    expect(r.from).toBe(start.getTime());
    expect(r.to).toBe(now);
    expect(r.to).toBeGreaterThanOrEqual(r.from);
  });

  it('preset yesterday → 어제 자정 ~ 오늘 자정-1ms', () => {
    const r = computeRange({ type: 'preset', value: 'yesterday' }, now) as { from: number; to: number };
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const yStart     = new Date(now); yStart.setDate(yStart.getDate() - 1); yStart.setHours(0, 0, 0, 0);
    expect(r.from).toBe(yStart.getTime());
    expect(r.to).toBe(todayStart.getTime() - 1);
    expect(r.to).toBeLessThan(todayStart.getTime()); // 오늘 데이터 미포함
  });

  it('preset 7d → now - 7d ~ now (rolling)', () => {
    const r = computeRange({ type: 'preset', value: '7d' }, now);
    expect(r).toEqual({ from: now - 7 * DAY, to: now });
  });

  it('preset 30d → now - 30d ~ now (rolling)', () => {
    const r = computeRange({ type: 'preset', value: '30d' }, now);
    expect(r).toEqual({ from: now - 30 * DAY, to: now });
  });

  it('preset week (legacy) → 7일 rolling 호환', () => {
    const r = computeRange({ type: 'preset', value: 'week' as any }, now) as { from: number; to: number };
    expect(r.to).toBe(now);
    expect(now - r.from).toBeGreaterThanOrEqual(7 * DAY - DAY);
  });
});

describe('computeRange — custom', () => {
  const now = Date.now();

  it('정상 from/to → 그대로 반환', () => {
    const from = now - 3 * DAY;
    const to   = now;
    expect(computeRange({ type: 'custom', from, to }, now)).toEqual({ from, to });
  });

  it('from/to 누락 시 {} 반환 (출력 계약 보장)', () => {
    const r = computeRange({ type: 'custom', from: NaN, to: NaN }, now);
    expect(r).toEqual({});
  });
});

describe('출력 계약 (ADR-002): {} | {from, to}만 반환, 다른 필드 누설 없음', () => {
  const now = Date.now();

  it('preset 결과에 type/value 같은 비계약 필드 없음', () => {
    const r = computeRange({ type: 'preset', value: 'today' }, now);
    expect(Object.keys(r).sort()).toEqual(['from', 'to']);
  });

  it('custom 결과에 type 등 누설 없음', () => {
    const r = computeRange({ type: 'custom', from: 1, to: 2 }, now);
    expect(Object.keys(r).sort()).toEqual(['from', 'to']);
  });

  it('all 결과는 빈 객체', () => {
    const r = computeRange({ type: 'preset', value: 'all' }, now);
    expect(Object.keys(r).length).toBe(0);
  });
});

describe('setActiveRange — normalize 어댑터 (ADR-003)', () => {
  it('문자열 입력 → {type:preset, value}로 정규화', () => {
    setActiveRange('today');
    const ar = getActiveRange();
    expect(ar).toEqual({ type: 'preset', value: 'today' });
  });

  it('미지원 문자열 → all로 폴백', () => {
    setActiveRange('foo-bar' as any);
    expect(getActiveRange()).toEqual({ type: 'preset', value: 'all' });
  });

  it('객체 입력 (custom) → 숫자 변환 후 보존', () => {
    const from = 1715000000000;
    const to   = 1715800000000;
    setActiveRange({ type: 'custom', from, to });
    expect(getActiveRange()).toEqual({ type: 'custom', from, to });
  });

  it('객체 입력 (preset) → 그대로 보존', () => {
    setActiveRange({ type: 'preset', value: '7d' });
    expect(getActiveRange()).toEqual({ type: 'preset', value: '7d' });
  });

  it('frozen 객체 반환 (외부 mutation 차단)', () => {
    setActiveRange('1h');
    const ar = getActiveRange();
    expect(Object.isFrozen(ar)).toBe(true);
  });
});

describe('getDateRange — 외부 호출자 인터페이스 (ADR-002)', () => {
  it('today 설정 후 getDateRange()는 {from, to} 반환', () => {
    setActiveRange('today');
    const r = getDateRange() as { from: number; to: number };
    expect(typeof r.from).toBe('number');
    expect(typeof r.to).toBe('number');
    expect(r.to).toBeGreaterThanOrEqual(r.from);
  });

  it('all 설정 후 getDateRange()는 {} 반환', () => {
    setActiveRange('all');
    expect(Object.keys(getDateRange()).length).toBe(0);
  });

  it('custom 설정 후 getDateRange()가 from/to 그대로 반환', () => {
    const from = 1715000000000;
    const to   = 1715800000000;
    setActiveRange({ type: 'custom', from, to });
    expect(getDateRange()).toEqual({ from, to });
  });
});
