import { describe, it, expect, beforeEach } from 'bun:test';
import { useAppStore } from '../app-store';

// app-store-persist.test.ts — Zustand persist 미들웨어 검증 (P1-05).
//
// date-range-storage.test.ts 12 case 를 persist 미들웨어 동작으로 흡수한다(ADR-004).
//   - 영속 스키마: preset만 영속, custom 휘발.
//   - 영속 키/형식: 레거시 'cs.dateRange' + {v:1, type:'preset', value} 와 byte-호환
//     (병존 기간 동안 legacy date-range-storage.js 와 데이터 공유 — done_criteria).
//   - persist 의 storage 어댑터(createDateRangeStorage)가 zustand StorageValue 봉투를
//     레거시 평면 형식으로 직렬화/역직렬화한다. partialize 로 activeRange 만 영속.
//
// 회귀 동치 기준(원본 date-range-storage.test.ts):
//   saveDateRange preset → JSON {v:1,type:'preset',value}      → setActiveRange(preset) 후 키 검증
//   saveDateRange custom → no-op (휘발)                        → setActiveRange(custom) 후 키 부재
//   loadDateRange 빈 storage → null (default 폴백)             → rehydrate 후 activeRange null
//   loadDateRange v:1 preset → 복원                            → rehydrate 후 activeRange 복원
//   loadDateRange v:2 → null                                  → rehydrate 후 activeRange null
//   loadDateRange parse 실패 → null                           → rehydrate 후 activeRange null
//   loadDateRange type=custom → null                          → rehydrate 후 activeRange null
//   loadDateRange type 누락 → null                            → rehydrate 후 activeRange null
//   loadDateRange value 비문자열 → null                       → rehydrate 후 activeRange null
//   round-trip preset                                         → set → rehydrate 동일
//
// rehydrate 패턴: persist 는 모듈 로드 시 1회 자동 hydrate 하므로, 테스트마다
//   storage 시드 후 useAppStore.persist.rehydrate() 로 명시적 재수화한다.
//   어댑터는 () => globalThis.localStorage 를 지연 평가하므로 per-test MemStorage 교체가 반영된다.

const STORAGE_KEY = 'cs.dateRange';

// date-range-storage.test.ts 의 MemStorage 목 1:1 계승.
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
  // 스토어 in-memory 상태 초기화 (이전 테스트의 activeRange 잔존 제거).
  useAppStore.setState({ activeRange: null });
});

// rehydrate 헬퍼 — 시드된 storage 로 강제 재수화 후 동기적으로 상태 반영.
function rehydrate() {
  useAppStore.persist.rehydrate();
}

describe('persist 저장 (setActiveRange → cs.dateRange)', () => {
  it('preset 저장 → JSON {v:1, type:"preset", value} (레거시 byte-호환)', () => {
    useAppStore.getState().setActiveRange({ type: 'preset', value: 'today' });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ v: 1, type: 'preset', value: 'today' });
  });

  it('custom 입력 → cs.dateRange 미저장 (휘발, ADR-004)', () => {
    useAppStore.getState().setActiveRange({ type: 'custom', from: 1, to: 2 });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('null 입력 → cs.dateRange 미저장', () => {
    useAppStore.getState().setActiveRange(null);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('partialize: activeRange 외 다른 상태는 cs.dateRange 에 직렬화되지 않음', () => {
    useAppStore.getState().setAppMode('settings');
    useAppStore.getState().setMetaSubTab('tools');
    useAppStore.getState().setActiveRange({ type: 'preset', value: '7d' });
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed).toEqual({ v: 1, type: 'preset', value: '7d' });
    expect(parsed.appMode).toBeUndefined();
    expect(parsed.metaSubTab).toBeUndefined();
    expect(parsed.state).toBeUndefined(); // zustand 기본 봉투가 노출되지 않음
  });
});

describe('persist 복원 (rehydrate ← cs.dateRange)', () => {
  it('빈 storage → activeRange null (호출자 default 폴백 책임)', () => {
    rehydrate();
    expect(useAppStore.getState().activeRange).toBeNull();
  });

  it('v:1 preset 저장값 → activeRange 복원', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, type: 'preset', value: '7d' }));
    rehydrate();
    expect(useAppStore.getState().activeRange).toEqual({ type: 'preset', value: '7d' });
  });

  it('v:2 (미지원 버전) → activeRange null', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 2, type: 'preset', value: 'today' }));
    rehydrate();
    expect(useAppStore.getState().activeRange).toBeNull();
  });

  it('JSON parse 실패 → activeRange null (throw 없음)', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    rehydrate();
    expect(useAppStore.getState().activeRange).toBeNull();
  });

  it('type=custom 저장값 → activeRange null (custom 휘발 — 정책 위반 데이터 무시)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, type: 'custom', from: 1, to: 2 }));
    rehydrate();
    expect(useAppStore.getState().activeRange).toBeNull();
  });

  it('type 필드 누락 → activeRange null', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, value: 'today' }));
    rehydrate();
    expect(useAppStore.getState().activeRange).toBeNull();
  });

  it('value 필드 문자열 아님 → activeRange null', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, type: 'preset', value: 123 }));
    rehydrate();
    expect(useAppStore.getState().activeRange).toBeNull();
  });
});

describe('save → rehydrate round-trip', () => {
  // 새로고침 시뮬레이션: set 으로 storage 에 쓴 뒤, 별도 storage 인스턴스로 교체하지 않고
  //   기록된 raw 를 보존한 채 rehydrate. (setState(null) 로 비우면 persist 구독이 키를 지우므로
  //   raw 를 캡처/재시드하여 "디스크에 남은 값으로부터의 복원"을 정확히 재현한다.)
  it('preset 값이 동일하게 복원됨', () => {
    useAppStore.getState().setActiveRange({ type: 'preset', value: 'yesterday' });
    const raw = localStorage.getItem('cs.dateRange'); // 디스크에 남은 값 캡처
    (globalThis as any).localStorage = new MemStorage();
    localStorage.setItem('cs.dateRange', raw!);        // 새로고침 후 디스크 상태 재현
    rehydrate();
    expect(useAppStore.getState().activeRange).toEqual({ type: 'preset', value: 'yesterday' });
  });

  it('custom 은 디스크에 미기록 → 새 탭(빈 in-memory)에서 복원 시 null (휘발)', () => {
    useAppStore.getState().setActiveRange({ type: 'custom', from: 1, to: 2 });
    expect(localStorage.getItem('cs.dateRange')).toBeNull(); // custom 은 애초에 디스크에 없음
    // 새 탭 시뮬레이션: in-memory 를 초기값으로 리셋 후, 디스크(빈 상태)로부터 복원.
    useAppStore.setState({ activeRange: null });
    rehydrate();
    expect(useAppStore.getState().activeRange).toBeNull();
  });
});
