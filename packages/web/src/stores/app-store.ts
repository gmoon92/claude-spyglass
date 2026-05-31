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
};

export const useAppStore = create<AppStoreState>((set) => ({
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
}));
