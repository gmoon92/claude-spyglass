// sse-store.ts — SSE 라이브 데이터 SSoT (Zustand). main.js:359-440 의 SSE 3 핸들러 "순수 상태 전이" 이식 (P4-05).
//
// 원본(assets/js/main.js startSSE → connectSSE 콜백):
//   onNewRequest    (main.js:359-390): 세션 total_tokens 패치 + feed prepend/upsert(+cap) + 캐시미스 시 fetchAllSessions.
//   onNewProxyRequest(main.js:399-409): 'spyglass:proxy-request' 커스텀 이벤트 디스패치(후속 패널용) + dashboard refresh.
//   onSessionUpdate (main.js:412-426): started/ended 생명주기 ended_at 패치 + 캐시미스 시 fetchAllSessions.
//
// 책임 경계(architecture.md §1.3 규칙3 — stores 는 hooks/features/components 무참조):
//   본 스토어는 P1-07 검증·정규화된 typed event payload 만 입력받아 **선언적 데이터 전이**만 수행한다.
//   원본 핸들러가 섞어 하던 부수효과는 스토어에서 제외한다:
//     - DOM 패치(prependRequest 의 querySelector/insertBefore, sess-row-tokens textContent) → React 렌더가 feed/sessions 구독으로 대체.
//     - 차트/타임라인(recordRequest/drawTimeline), 대시보드 debounce(scheduleDashboardRefresh) → 호출처(features/effects) 책임.
//     - 네트워크 refetch(fetchAllSessions): 캐시미스(세션 미존재) 케이스는 needsSessionsRefetch 신호로 노출 →
//       React 계층이 fetchers(P3-03 fetchAllSessions) 로 충족 후 setSessions/clearSessionsRefetch 로 닫는다.
//     - proxy 커스텀 이벤트 디스패치: 선언적 proxyFeed 누적으로 대체(구독자는 스토어를 읽음, document 이벤트 불요).
//
// app-store(라우팅 SSoT)와 분리: 라이브 피드/세션 캐시는 라우팅과 책임이 다르고 영속 대상도 아니므로 별도 in-memory 스토어로 둔다
//   (app-store.ts 헤더의 "in-memory 계약만 담는다" 원칙 유지, persist 미사용).
//
// 매칭 키 주의(main.js:365,416 1:1): 세션 일치는 `session.id === event.session_id` 로 판정한다
//   (이벤트 페이로드는 session_id, 캐시 세션 객체는 id — left-panel.js getAllSessions().find(s=>s.id===…)).
//
// @see packages/web/assets/js/main.js (startSSE onNewRequest/onNewProxyRequest/onSessionUpdate)
// @see packages/web/assets/js/views/default/feed-live.js (prependRequest — FEED_ROW_CAP/in-place upsert)
// @see packages/web/src/hooks/use-sse.ts (P4-04 useSSE — 본 액션을 호출하는 결선부, features/sse-wiring)
// @see packages/web/src/schema/sse-schema.ts (P1-07 NewRequestEvent/NewProxyRequestEvent/SessionUpdateEvent)

import { create } from 'zustand';
import type { Session } from '@spyglass/types';
import type {
  NewRequestEvent,
  NewProxyRequestEvent,
  SessionUpdateEvent,
} from '../schema/sse-schema';

/**
 * 피드 행 cap — feed-live.js:16 FEED_ROW_CAP 1:1. 초과 시 가장 오래된(배열 끝) 행부터 제거.
 * prepend 정책이므로 배열 head=최신, tail=가장 오래됨.
 */
export const FEED_CAP = 200;

/**
 * 프록시 피드 cap — 원본 main.js 는 커스텀 이벤트만 디스패치하고 누적하지 않았으나(패널 부재),
 * 선언적 스토어로 흡수하면서 무한 증가 방지 cap 을 둔다. fetchProxyRequests 기본 limit(50, fetchers.ts:278)과 정합.
 */
export const PROXY_FEED_CAP = 50;

/**
 * 세션 캐시 행 — left-panel.js _allSessions 와 동일하게 `id` 로 매칭한다.
 * 도메인 형태는 @spyglass/types Session(SSoT). 피드 fetch 결과(SessionRow passthrough)가 흘러들어오므로
 * Session 으로 받되, SSE 메타 패치(total_tokens/ended_at)는 Session 필드와 정합한다.
 */
export type SessionCacheRow = Session;

export interface SSEStoreState {
  /** 라이브 피드(head=최신). main.js prependRequest 의 DOM 행을 선언적 데이터로 대체. */
  feed: NewRequestEvent[];
  /** 프록시 라이브 피드(head=최신). */
  proxyFeed: NewProxyRequestEvent[];
  /** 세션 캐시(좌측 패널 SSoT 역할). React fetch 결과를 setSessions 로 시드. */
  sessions: SessionCacheRow[];
  /**
   * 캐시미스(이벤트 세션이 캐시에 없음) 발생 신호 — main.js 가 즉시 fetchAllSessions 하던 자리.
   * React 계층이 true 를 관찰하면 fetchers.fetchAllSessions 호출 후 setSessions/clearSessionsRefetch 로 닫는다.
   */
  needsSessionsRefetch: boolean;

  // ── 액션 (SSE 3 핸들러 순수 전이) ──
  /** new_request: 세션 total_tokens 패치(+캐시미스 신호) + feed prepend/upsert(+cap). */
  applyNewRequest: (req: NewRequestEvent) => void;
  /** new_proxy_request: proxyFeed prepend(+cap). */
  applyNewProxyRequest: (proxy: NewProxyRequestEvent) => void;
  /** session_update: started→ended_at=null / ended(+ended_at)→설정. 캐시미스 시 신호. */
  applySessionUpdate: (upd: SessionUpdateEvent) => void;

  // ── 시드/신호 제어 (React 계층 결선용) ──
  /** 세션 캐시 교체 + refetch 신호 내림(fetch 완료 반영). */
  setSessions: (sessions: SessionCacheRow[]) => void;
  /** refetch 신호 내림(fetch 완료 후). */
  clearSessionsRefetch: () => void;
}

/** 진짜 초기값 — 테스트 beforeEach 복원 SSoT(app-store initialState 패턴). */
export const initialSSEState = {
  feed: [] as NewRequestEvent[],
  proxyFeed: [] as NewProxyRequestEvent[],
  sessions: [] as SessionCacheRow[],
  needsSessionsRefetch: false,
};

/**
 * head=최신 배열에 prepend 후 cap 초과분(배열 끝=가장 오래됨)을 잘라낸다.
 * feed-live.js:73 `while(rows.length>=CAP) deleteRow(last)` 의 불변(immutable) 등가.
 */
function prependCapped<T>(list: T[], item: T, cap: number): T[] {
  const next = [item, ...list];
  return next.length > cap ? next.slice(0, cap) : next;
}

export const useSSEStore = create<SSEStoreState>()((set) => ({
  ...initialSSEState,

  // ── applyNewRequest (main.js:359-390 의 데이터 부분만) ──
  applyNewRequest: (req) =>
    set((state) => {
      // (1) 세션 total_tokens 패치 — main.js:365-374. id===session_id 매칭.
      const idx = state.sessions.findIndex(
        (s) => (s as { id?: string }).id === req.session_id,
      );
      let sessions = state.sessions;
      let needsSessionsRefetch = state.needsSessionsRefetch;
      if (idx >= 0) {
        // 불변 갱신 — 해당 세션만 total_tokens 교체(main.js:367 sess.total_tokens=…).
        sessions = state.sessions.slice();
        sessions[idx] = { ...sessions[idx], total_tokens: req.session_total_tokens } as SessionCacheRow;
      } else {
        // 캐시미스 → 전체 갱신 신호(main.js:373 fetchAllSessions 대체).
        needsSessionsRefetch = true;
      }

      // (2) feed upsert — 같은 id 존재 시 위치 보존 in-place 교체(feed-live.js ADR-007),
      //     아니면 prepend(+cap)(feed-live.js:73). prepend 가 신규, 교체가 updated/backfill.
      const existing = state.feed.findIndex((r) => r.id === req.id);
      let feed: NewRequestEvent[];
      if (existing >= 0) {
        feed = state.feed.slice();
        feed[existing] = req;
      } else {
        feed = prependCapped(state.feed, req, FEED_CAP);
      }

      return { sessions, needsSessionsRefetch, feed };
    }),

  // ── applyNewProxyRequest (main.js:399-409 의 데이터 부분만) ──
  applyNewProxyRequest: (proxy) =>
    set((state) => ({ proxyFeed: prependCapped(state.proxyFeed, proxy, PROXY_FEED_CAP) })),

  // ── applySessionUpdate (main.js:412-426) ──
  applySessionUpdate: (upd) =>
    set((state) => {
      const idx = state.sessions.findIndex(
        (s) => (s as { id?: string }).id === upd.session_id,
      );
      if (idx < 0) {
        // 캐시에 없는 새 세션 → 전체 갱신 신호(main.js:422-423 fetchAllSessions 대체).
        return { needsSessionsRefetch: true };
      }
      // ended_at 패치 — main.js:418-419. ended(+ended_at)→설정 / started→null / 그 외 무변형.
      const cur = state.sessions[idx] as { ended_at?: number | null };
      let endedAt: number | null | undefined;
      if (upd.action === 'ended' && upd.ended_at != null) endedAt = upd.ended_at;
      else if (upd.action === 'started') endedAt = null;
      else return {}; // token_update 등 → ended_at 무변형(상태 변경 없음).

      const sessions = state.sessions.slice();
      sessions[idx] = { ...cur, ended_at: endedAt } as SessionCacheRow;
      return { sessions };
    }),

  // ── 시드/신호 제어 ──
  setSessions: (sessions) => set({ sessions, needsSessionsRefetch: false }),
  clearSessionsRefetch: () => set({ needsSessionsRefetch: false }),
}));
