/**
 * date-range-storage.test.ts — localStorage hydrator 단위 테스트
 *
 * date-range-filter ADR-004 검증:
 *   - 스키마 키 'cs.dateRange' + v:1
 *   - preset만 저장, custom 휘발
 *   - parse 실패 / 미지원 버전 / type=custom 저장값 → null 반환 (default 폴백)
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { saveDateRange, loadDateRange } from '../util/date-range-storage.js';

// in-memory localStorage mock
class MemStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
  get length() { return this.store.size; }
}

beforeEach(() => {
  (globalThis as any).localStorage = new MemStorage();
});

describe('saveDateRange', () => {
  it('preset 저장 → JSON {v:1, type:"preset", value}', () => {
    saveDateRange({ type: 'preset', value: 'today' });
    const raw = localStorage.getItem('cs.dateRange');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ v: 1, type: 'preset', value: 'today' });
  });

  it('custom 입력 → 저장 안 함 (no-op, ADR-004 휘발 정책)', () => {
    saveDateRange({ type: 'custom', from: 1, to: 2 });
    expect(localStorage.getItem('cs.dateRange')).toBeNull();
  });

  it('null/undefined 입력 → 저장 안 함', () => {
    saveDateRange(null as any);
    saveDateRange(undefined as any);
    expect(localStorage.getItem('cs.dateRange')).toBeNull();
  });
});

describe('loadDateRange', () => {
  it('빈 storage → null (호출자 default 폴백 책임)', () => {
    expect(loadDateRange()).toBeNull();
  });

  it('v:1 preset 저장값 → 그대로 복원', () => {
    localStorage.setItem('cs.dateRange', JSON.stringify({ v: 1, type: 'preset', value: '7d' }));
    expect(loadDateRange()).toEqual({ type: 'preset', value: '7d' });
  });

  it('v:2 (미지원 버전) → null', () => {
    localStorage.setItem('cs.dateRange', JSON.stringify({ v: 2, type: 'preset', value: 'today' }));
    expect(loadDateRange()).toBeNull();
  });

  it('JSON parse 실패 → null (throw 없음)', () => {
    localStorage.setItem('cs.dateRange', '{not json');
    expect(loadDateRange()).toBeNull();
  });

  it('type=custom 저장값 → null (custom은 휘발 — 정책 위반 데이터 무시)', () => {
    localStorage.setItem('cs.dateRange', JSON.stringify({ v: 1, type: 'custom', from: 1, to: 2 }));
    expect(loadDateRange()).toBeNull();
  });

  it('type 필드 누락 → null', () => {
    localStorage.setItem('cs.dateRange', JSON.stringify({ v: 1, value: 'today' }));
    expect(loadDateRange()).toBeNull();
  });

  it('value 필드 문자열 아님 → null', () => {
    localStorage.setItem('cs.dateRange', JSON.stringify({ v: 1, type: 'preset', value: 123 }));
    expect(loadDateRange()).toBeNull();
  });
});

describe('save → load round-trip', () => {
  it('preset 값이 동일하게 복원됨', () => {
    saveDateRange({ type: 'preset', value: 'yesterday' });
    expect(loadDateRange()).toEqual({ type: 'preset', value: 'yesterday' });
  });

  it('custom 저장 시도 후에도 load는 null (휘발)', () => {
    saveDateRange({ type: 'custom', from: 1, to: 2 });
    expect(loadDateRange()).toBeNull();
  });
});
