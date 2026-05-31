import { describe, it, expect, beforeEach } from 'vitest';
import { useSSEStore, initialSSEState, FEED_CAP, PROXY_FEED_CAP } from '../sse-store';
import type { NewRequestEvent, NewProxyRequestEvent, SessionUpdateEvent } from '../../schema/sse-schema';

// sse-store.test.ts — main.js:359-440 SSE 3 핸들러의 "순수 상태 전이"를 스토어 액션으로 흡수(P4-05).
//
// 이식 대상(main.js startSSE):
//   onNewRequest    (main.js:359-390): 세션 total_tokens 패치 + feed prepend/upsert(+cap) + 캐시미스 refetch 신호
//   onNewProxyRequest(main.js:399-409): proxy feed prepend(+cap)
//   onSessionUpdate (main.js:412-426): started/ended 생명주기 패치 + 캐시미스 refetch 신호
//
// DOM/render/network 부수효과(prependRequest DOM, drawTimeline, fetchAllSessions, scheduleDashboardRefresh)는
// 스토어 책임이 아니다 — 스토어는 "선언적 데이터 전이"만 담고, refetch 가 필요한 캐시미스 케이스는
// needsSessionsRefetch 신호로 노출(React 계층이 fetchAllSessions/P3-03 로 충족). architecture.md §1.3 규칙3
// (stores 는 hooks/features/components 무참조) 준수 — 본 스토어는 typed event payload 만 입력받는다.
//
// 테스트 idiom: app-store.test.ts 계승 — 각 테스트 전 initialSSEState 로 강제 복원(모듈 싱글톤 격리).

beforeEach(() => {
  // 스토어 상태를 진짜 초기값으로 리셋(액션 보존, 데이터 필드만 초기화).
  useSSEStore.setState({ ...initialSSEState });
});

/** new_request 페이로드 최소 팩토리 — sse-schema NewRequestEvent 필수 필드 충족. */
function makeReq(over: Partial<NewRequestEvent> = {}): NewRequestEvent {
  return {
    id: 'r1',
    session_id: 's1',
    timestamp: 1000,
    type: 'prompt',
    tokens_input: 10,
    tokens_output: 20,
    tokens_total: 30,
    duration_ms: 5,
    sub_type: null,
    trust_level: 'trusted',
    model: 'claude',
    model_fallback_applied: false,
    session_total_tokens: 100,
    event_phase: 'created',
    ...over,
  } as NewRequestEvent;
}

/** session_update 페이로드 팩토리 — session_id 만 필수. */
function makeSessUpdate(over: Partial<SessionUpdateEvent> = {}): SessionUpdateEvent {
  return { session_id: 's1', ...over } as SessionUpdateEvent;
}

/** new_proxy_request 페이로드 최소 팩토리. */
function makeProxy(over: Partial<NewProxyRequestEvent> = {}): NewProxyRequestEvent {
  return {
    source: 'proxy',
    id: 'p1',
    timestamp: 2000,
    method: 'POST',
    path: '/v1/messages',
    status_code: 200,
    response_time_ms: 100,
    model: 'claude',
    tokens_input: 1,
    tokens_output: 2,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    tokens_per_second: null,
    is_stream: false,
    messages_count: 1,
    max_tokens: null,
    tools_count: 0,
    request_preview: null,
    stop_reason: null,
    response_preview: null,
    error_type: null,
    error_message: null,
    first_token_ms: null,
    api_request_id: null,
    ...over,
  } as NewProxyRequestEvent;
}

describe('초기 상태', () => {
  it('feed/proxyFeed 는 빈 배열, sessions 는 빈 배열', () => {
    const s = useSSEStore.getState();
    expect(s.feed).toEqual([]);
    expect(s.proxyFeed).toEqual([]);
    expect(s.sessions).toEqual([]);
  });
  it('needsSessionsRefetch 는 false', () => {
    expect(useSSEStore.getState().needsSessionsRefetch).toBe(false);
  });
});

describe('applyNewRequest — feed prepend/upsert (main.js prependRequest 1:1 데이터)', () => {
  it('신규 요청을 feed 최상단에 prepend', () => {
    useSSEStore.getState().applyNewRequest(makeReq({ id: 'r1' }));
    const feed = useSSEStore.getState().feed;
    expect(feed.length).toBe(1);
    expect(feed[0].id).toBe('r1');
  });

  it('연속 요청은 최신이 앞(prepend 순서)', () => {
    const s = useSSEStore.getState();
    s.applyNewRequest(makeReq({ id: 'r1' }));
    s.applyNewRequest(makeReq({ id: 'r2' }));
    const feed = useSSEStore.getState().feed;
    expect(feed.map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('같은 id 재도착(updated)은 위치 보존 in-place 교체(prepend 아님) — feed-live.js ADR-007', () => {
    const s = useSSEStore.getState();
    s.applyNewRequest(makeReq({ id: 'r1', tokens_total: 30 }));
    s.applyNewRequest(makeReq({ id: 'r2' }));
    // r1 재도착(updated) → 길이 불변, r1 은 기존 위치(끝)에 유지, 내용만 갱신.
    s.applyNewRequest(makeReq({ id: 'r1', tokens_total: 99, event_phase: 'updated' }));
    const feed = useSSEStore.getState().feed;
    expect(feed.length).toBe(2);
    expect(feed.map((r) => r.id)).toEqual(['r2', 'r1']);
    const r1 = feed.find((r) => r.id === 'r1');
    expect(r1?.tokens_total).toBe(99);
  });

  it(`feed 는 ${FEED_CAP}행 cap — 초과 시 가장 오래된 행부터 제거(feed-live.js:73)`, () => {
    const s = useSSEStore.getState();
    for (let i = 0; i < FEED_CAP + 5; i++) {
      s.applyNewRequest(makeReq({ id: `r${i}` }));
    }
    const feed = useSSEStore.getState().feed;
    expect(feed.length).toBe(FEED_CAP);
    // 최신(마지막 삽입)이 최상단, 가장 오래된 r0..r4 는 제거됨.
    expect(feed[0].id).toBe(`r${FEED_CAP + 4}`);
    expect(feed.some((r) => r.id === 'r0')).toBe(false);
  });
});

describe('applyNewRequest — 세션 total_tokens 패치 (main.js:365-374)', () => {
  it('일치 세션이 있으면 total_tokens 를 session_total_tokens 로 갱신', () => {
    // 캐시에 세션 존재(s.id === req.session_id 매칭 — main.js:365).
    useSSEStore.setState({ sessions: [{ id: 's1', total_tokens: 50 } as never] });
    useSSEStore.getState().applyNewRequest(makeReq({ session_id: 's1', session_total_tokens: 777 }));
    const sess = useSSEStore.getState().sessions.find((x) => (x as { id: string }).id === 's1');
    expect((sess as { total_tokens: number }).total_tokens).toBe(777);
  });

  it('일치 세션이 없으면 needsSessionsRefetch 신호를 올린다(main.js:373 fetchAllSessions 대체)', () => {
    expect(useSSEStore.getState().needsSessionsRefetch).toBe(false);
    useSSEStore.getState().applyNewRequest(makeReq({ session_id: 'unknown' }));
    expect(useSSEStore.getState().needsSessionsRefetch).toBe(true);
  });

  it('clearSessionsRefetch 로 신호를 내린다(React 계층 fetch 완료 후 호출)', () => {
    useSSEStore.getState().applyNewRequest(makeReq({ session_id: 'unknown' }));
    useSSEStore.getState().clearSessionsRefetch();
    expect(useSSEStore.getState().needsSessionsRefetch).toBe(false);
  });

  it('일치 세션 패치는 다른 세션을 변형하지 않는다', () => {
    useSSEStore.setState({
      sessions: [
        { id: 's1', total_tokens: 1 } as never,
        { id: 's2', total_tokens: 2 } as never,
      ],
    });
    useSSEStore.getState().applyNewRequest(makeReq({ session_id: 's1', session_total_tokens: 100 }));
    const all = useSSEStore.getState().sessions as Array<{ id: string; total_tokens: number }>;
    expect(all.find((x) => x.id === 's2')?.total_tokens).toBe(2);
  });
});

describe('applySessionUpdate — 생명주기 패치 (main.js:412-426)', () => {
  it("action='ended' + ended_at 제공 시 해당 세션 ended_at 설정", () => {
    useSSEStore.setState({ sessions: [{ id: 's1', ended_at: null } as never] });
    useSSEStore.getState().applySessionUpdate(makeSessUpdate({ session_id: 's1', action: 'ended', ended_at: 9999 }));
    const sess = useSSEStore.getState().sessions.find((x) => (x as { id: string }).id === 's1');
    expect((sess as { ended_at: number | null }).ended_at).toBe(9999);
  });

  it("action='started' 시 ended_at 을 null 로(재활성)", () => {
    useSSEStore.setState({ sessions: [{ id: 's1', ended_at: 5000 } as never] });
    useSSEStore.getState().applySessionUpdate(makeSessUpdate({ session_id: 's1', action: 'started' }));
    const sess = useSSEStore.getState().sessions.find((x) => (x as { id: string }).id === 's1');
    expect((sess as { ended_at: number | null }).ended_at).toBeNull();
  });

  it("action='ended' 인데 ended_at 미제공이면 ended_at 변형 안 함(main.js:418 가드)", () => {
    useSSEStore.setState({ sessions: [{ id: 's1', ended_at: 123 } as never] });
    useSSEStore.getState().applySessionUpdate(makeSessUpdate({ session_id: 's1', action: 'ended' }));
    const sess = useSSEStore.getState().sessions.find((x) => (x as { id: string }).id === 's1');
    expect((sess as { ended_at: number | null }).ended_at).toBe(123);
  });

  it('캐시에 없는 세션이면 needsSessionsRefetch 신호(main.js:422-423 fetchAllSessions)', () => {
    useSSEStore.getState().applySessionUpdate(makeSessUpdate({ session_id: 'ghost', action: 'started' }));
    expect(useSSEStore.getState().needsSessionsRefetch).toBe(true);
  });

  it("token_update 등 비-생명주기 action 은 ended_at 무변형", () => {
    useSSEStore.setState({ sessions: [{ id: 's1', ended_at: 7 } as never] });
    useSSEStore.getState().applySessionUpdate(makeSessUpdate({ session_id: 's1', action: 'token_update' }));
    const sess = useSSEStore.getState().sessions.find((x) => (x as { id: string }).id === 's1');
    expect((sess as { ended_at: number | null }).ended_at).toBe(7);
  });
});

describe('applyNewProxyRequest — proxy feed prepend(+cap) (main.js:399-409)', () => {
  it('proxy 요청을 proxyFeed 최상단에 prepend', () => {
    useSSEStore.getState().applyNewProxyRequest(makeProxy({ id: 'p1' }));
    const pf = useSSEStore.getState().proxyFeed;
    expect(pf.length).toBe(1);
    expect(pf[0].id).toBe('p1');
  });

  it('연속 proxy 요청은 최신이 앞', () => {
    const s = useSSEStore.getState();
    s.applyNewProxyRequest(makeProxy({ id: 'p1' }));
    s.applyNewProxyRequest(makeProxy({ id: 'p2' }));
    expect(useSSEStore.getState().proxyFeed.map((p) => p.id)).toEqual(['p2', 'p1']);
  });

  it(`proxyFeed 는 ${PROXY_FEED_CAP}행 cap`, () => {
    const s = useSSEStore.getState();
    for (let i = 0; i < PROXY_FEED_CAP + 3; i++) {
      s.applyNewProxyRequest(makeProxy({ id: `p${i}` }));
    }
    expect(useSSEStore.getState().proxyFeed.length).toBe(PROXY_FEED_CAP);
  });
});

describe('setSessions — 캐시 시드(React fetch 결과 주입)', () => {
  it('setSessions 로 세션 목록을 교체하고 refetch 신호를 내린다', () => {
    useSSEStore.setState({ needsSessionsRefetch: true });
    useSSEStore.getState().setSessions([{ id: 's1' } as never, { id: 's2' } as never]);
    expect(useSSEStore.getState().sessions.length).toBe(2);
    expect(useSSEStore.getState().needsSessionsRefetch).toBe(false);
  });
});
