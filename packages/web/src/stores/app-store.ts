// app-store.ts — 라우팅/뷰 상태 SSoT (Zustand). assets/js/state.js(82줄) 1:1 이식 (P1-04).
//
// 원본 state.js 는 모듈 수준 `let` 변수 + getter/setter 쌍이 SSoT 였다(state.js:14-26 변수, :39-82 accessor).
// 이를 Zustand 단일 스토어의 state 필드(셀렉터) + 액션으로 1:1 매핑한다.
//   getX()  → useAppStore.getState().x        (필드 직접 노출 = 셀렉터)
//   setX(v) → useAppStore.getState().setX(v)   (액션)
//
// 어댑터 공존(P1-04 done_criteria): 기존 state.js / state.test.ts 는 유지된다. 소비처 13곳의 실제 전환은 후속 페이즈.
// 영속화 분리(P1-05): 원본 setAppMode/setMetaSubTab 의 sessionStorage 쓰기(state.js:44,57) 및 모듈 로드 시
//   복원(state.js:30-35)은 Zustand persist 미들웨어(P1-05)로 흡수한다. 본 스토어는 in-memory 계약만 담는다.
//   단, setter 의 "유효값 검증 가드"(state.js:42,55)는 동작 계약이므로 1:1 보존한다.
//
// 타입 주의: AppMode/MetaSubTab/PrevState 는 web 로컬 UI·라우팅 상태로, @spyglass/types(server/TUI 공통
//   데이터 contract)에 존재하지 않는 신규 UI 타입이다. 도메인 타입 재선언이 아니므로 여기서 선언한다.

import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';

/**
 * 앱 모드 (state.js:6-9, ADR-003 left-rail-meta-docs + settings-page).
 *   - 'browse'   : 기본. 좌측 패널 + 우측 default/detail-view.
 *   - 'metadocs' : 메인 영역 전체가 Behavior Definitions 카탈로그.
 *   - 'settings' : 메인 영역 전체가 진단/Hook/Graph DB/Proxy 설정 패널.
 */
export type AppMode = 'browse' | 'metadocs' | 'settings';

/**
 * 메타 문서 서브 탭 (state.js:17, ADR-004 meta-docs-tool-stats).
 *   - 'docs'  : 메타 문서 카탈로그 + 상단 ego-flow 영역 (기본)
 *   - 'tools' : 프로젝트 단위 도구별 성능 매트릭스
 * meta-docs-flow ego-graph(2026-05-21 rev): 과거 'flow' 값 폐기 → 'docs'/'tools' 2-way만 유효.
 */
export type MetaSubTab = 'docs' | 'tools';

/**
 * 'metadocs'/'settings' 진입 직전의 browse 스냅샷 (state.js:18, ESC 복귀용).
 * 원본은 `{ rightView, detailTab, sessionId }` 형태(state.js:9)나, 소비처가 자유 형태로 주입하므로
 * 구조는 느슨하게 둔다(원본 setter 가 형태 검증을 하지 않음 — state.js:62).
 */
export type PrevState = { rightView?: string; detailTab?: string; sessionId?: string | null } | null;

/**
 * 날짜 범위 프리셋 값 (api.js:86 PresetValue 1:1). 'week' 는 legacy 호환(T-06 제거 예정).
 * @spyglass/types 가 아닌 web 로컬 api.js 의 런타임 contract 이므로 여기서 재선언한다.
 */
export type PresetValue = '1h' | 'today' | 'yesterday' | '7d' | '30d' | 'all' | 'week';

/**
 * 활성 날짜 범위 (api.js:87-89 ActiveRange 1:1).
 *   - preset : 영속 대상 (ADR-004). 새로고침 시 복원.
 *   - custom : 휘발. 절대시각 stale 위험으로 영속하지 않는다(ADR-004).
 *   - null   : 미설정. 호출자가 default('all')로 폴백.
 */
export type ActiveRange =
  | { type: 'preset'; value: PresetValue }
  | { type: 'custom'; from: number; to: number }
  | null;

export interface AppStoreState {
  // ── 라우팅 슬라이스 (appMode/metaSubTab/prevState) ──
  appMode: AppMode;
  metaSubTab: MetaSubTab;
  prevState: PrevState;
  // ── 기존 라우팅 상태 (state.js:19-27) ──
  rightView: string;
  detailTab: string;
  selectedProject: string | null;
  selectedSession: string | null;
  feedFilterBar: unknown;
  detailFilterBar: unknown;
  // ── 영속 슬라이스 (ADR-004, P1-05): preset만 영속 / custom·null 휘발 ──
  activeRange: ActiveRange;
  // ── filter/search 슬라이스 (P2-08): filter-bar/search-box 선택 상태 SSoT. in-memory(휘발). ──
  //   feedFilter/detailFilter: filter-bar.js 의 활성 필터 키(기본 'all'). 두 인스턴스 독립.
  //   searchQuery: search-box.js 의 정규화(trim+lowercase) 질의(기본 ''). partialize 비대상.
  feedFilter: string;
  detailFilter: string;
  searchQuery: string;

  // ── 액션 (state.js accessor 1:1) ──
  setAppMode: (m: AppMode) => void;
  setMetaSubTab: (t: MetaSubTab) => void;
  setPrevState: (s: PrevState) => void;
  clearPrevState: () => void;
  setRightView: (v: string) => void;
  setDetailTab: (t: string) => void;
  setSelectedProject: (p: string | null) => void;
  setSelectedSession: (s: string | null) => void;
  setFeedFilterBar: (b: unknown) => void;
  setDetailFilterBar: (b: unknown) => void;
  setActiveRange: (r: ActiveRange) => void;
  setFeedFilter: (f: string) => void;
  setDetailFilter: (f: string) => void;
  setSearchQuery: (q: string) => void;
}

/**
 * 스토어 진짜 초기값 — state.js:14-26 SSoT.
 * detailTab 기본값은 'log'(state.js:23, ADR-turn-view-revamp-004)이며 'requests' 가 아니다.
 *   (state.test.ts 는 beforeEach 에서 'requests' 로 강제 세팅 후 검증 — panel tdd.md §2-1.)
 */
export const initialState = {
  appMode: 'browse' as AppMode,
  metaSubTab: 'docs' as MetaSubTab,
  prevState: null as PrevState,
  rightView: 'default',
  detailTab: 'log',
  selectedProject: null as string | null,
  selectedSession: null as string | null,
  feedFilterBar: null as unknown,
  detailFilterBar: null as unknown,
  // activeRange 초기값 null — loadDateRange()가 null 반환 시 호출자 default('all') 폴백하는 의미 1:1.
  activeRange: null as ActiveRange,
  // filter/search 초기값 (P2-08): filter-bar 'all' 기본 활성(filter-bar.js:12 defaultActive) / search 빈 질의.
  feedFilter: 'all',
  detailFilter: 'all',
  searchQuery: '',
};

/**
 * 영속 슬라이스 형태 — partialize 가 추출하는 부분(activeRange만).
 */
type PersistedSlice = { activeRange: ActiveRange };

/**
 * persist storage 어댑터 — Zustand StorageValue 봉투 ↔ 레거시 평면 형식 변환.
 *
 * done_criteria(병존 데이터 공유): localStorage 키 'cs.dateRange' 와 값 형식
 *   `{ v:1, type:'preset', value }` 을 date-range-storage.js 와 byte-호환 유지한다.
 *   따라서 zustand 기본 `{ state, version }` 봉투를 쓰지 않고 레거시 평면 형식으로 직렬화한다.
 *
 * ADR-004 휘발 규칙은 어댑터 양방향에 내장:
 *   - setItem: activeRange.type==='preset' 만 기록, 그 외(custom/null)는 removeItem(휘발).
 *     → date-range-storage.js saveDateRange 의 "preset만 저장 / custom no-op" 1:1.
 *   - getItem: v===SCHEMA_VERSION && type==='preset' && typeof value==='string' 만 복원.
 *     → loadDateRange 의 "버전/파싱실패/custom/타입누락/비문자열 → null" 1:1.
 *
 * localStorage 는 () => globalThis.localStorage 로 지연 평가 — 모듈 로드 순서/테스트 목 교체에 견고.
 */
const STORAGE_KEY = 'cs.dateRange';
const SCHEMA_VERSION = 1;

const dateRangeStorage: PersistStorage<PersistedSlice> = {
  getItem: (_name): StorageValue<PersistedSlice> | null => {
    const ls = typeof globalThis !== 'undefined' ? (globalThis as { localStorage?: Storage }).localStorage : undefined;
    if (!ls) return null;
    let raw: string | null;
    try { raw = ls.getItem(STORAGE_KEY); } catch { return null; }
    if (!raw) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return null; } // parse 실패 → null
    if (!parsed || typeof parsed !== 'object') return null;
    const p = parsed as { v?: unknown; type?: unknown; value?: unknown };
    if (p.v !== SCHEMA_VERSION) return null;                  // 미지원 버전 → null
    if (p.type !== 'preset') return null;                     // custom/타입누락 → null (custom 휘발)
    if (typeof p.value !== 'string') return null;             // value 비문자열 → null
    return {
      // 런타임 string 을 PresetValue 로 좁힘 — 소비처(api.js normalizeRange)가 재검증.
      state: { activeRange: { type: 'preset', value: p.value as PresetValue } },
      version: SCHEMA_VERSION,
    };
  },
  setItem: (_name, value): void => {
    const ls = typeof globalThis !== 'undefined' ? (globalThis as { localStorage?: Storage }).localStorage : undefined;
    if (!ls) return;
    const r = value.state.activeRange;
    try {
      if (r && r.type === 'preset') {
        ls.setItem(STORAGE_KEY, JSON.stringify({ v: SCHEMA_VERSION, type: 'preset', value: r.value }));
      } else {
        ls.removeItem(STORAGE_KEY); // custom/null 휘발
      }
    } catch { /* quota/serialize 실패 silent */ }
  },
  removeItem: (_name): void => {
    const ls = typeof globalThis !== 'undefined' ? (globalThis as { localStorage?: Storage }).localStorage : undefined;
    if (!ls) return;
    try { ls.removeItem(STORAGE_KEY); } catch { /* silent */ }
  },
};

export const useAppStore = create<AppStoreState>()(persist((set) => ({
  ...initialState,

  // ── appMode (state.js:39-45) — 유효값 검증 가드 1:1 보존, 무효값은 무시 ──
  setAppMode: (m) => {
    if (m !== 'browse' && m !== 'metadocs' && m !== 'settings') return;
    set({ appMode: m });
  },

  // ── metaSubTab (state.js:53-58) — 'docs'|'tools' 만 허용, 무효값은 무시 ──
  setMetaSubTab: (t) => {
    if (t !== 'docs' && t !== 'tools') return;
    set({ metaSubTab: t });
  },

  // ── prevState (state.js:61-63, ESC 복귀용) ──
  setPrevState: (s) => set({ prevState: s }),
  clearPrevState: () => set({ prevState: null }),

  // ── 기존 라우팅 상태 (state.js:66-82) ──
  setRightView: (v) => set({ rightView: v }),
  setDetailTab: (t) => set({ detailTab: t }),
  setSelectedProject: (p) => set({ selectedProject: p }),
  setSelectedSession: (s) => set({ selectedSession: s }),
  setFeedFilterBar: (b) => set({ feedFilterBar: b }),
  setDetailFilterBar: (b) => set({ detailFilterBar: b }),

  // ── activeRange (ADR-004, P1-05) — set 즉시 persist 어댑터가 preset만 기록/custom·null 휘발 ──
  setActiveRange: (r) => set({ activeRange: r }),

  // ── filter/search (P2-08) — in-memory only. partialize 비대상이라 localStorage 미기록(휘발). ──
  setFeedFilter: (f) => set({ feedFilter: f }),
  setDetailFilter: (f) => set({ detailFilter: f }),
  setSearchQuery: (q) => set({ searchQuery: q }),
}), {
  name: STORAGE_KEY,
  version: SCHEMA_VERSION,
  storage: dateRangeStorage,
  // 영속 대상은 activeRange 뿐 — appMode/metaSubTab/view 등은 cs.dateRange 형식에 섞지 않는다.
  partialize: (s): PersistedSlice => ({ activeRange: s.activeRange }),
  // 어댑터 getItem 이 이미 버전/형식을 검증하므로 migrate 는 통과 데이터만 받는다.
  // 미지원/위반 데이터는 getItem 단계에서 null 처리되어 여기 도달하지 않는다(default 폴백).
  migrate: (persisted): PersistedSlice => persisted as PersistedSlice,
}));
