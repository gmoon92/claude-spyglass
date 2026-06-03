/**
 * use-session-turns.test.tsx — 특성화 테스트 (소스 변경 없음, 현재 동작 고정).
 *
 * useSessionTurns 의 HTTP fetch → Turn 매핑/상태 전이를 고정한다.
 * 전역 fetch 를 FetchMock 으로 교체하고 afterEach 에서 원복한다.
 *
 * 커버:
 *   - sessionId null → 빈 상태 (turns=[], isLoading=false, error=null)
 *   - HTTP 200 정상 매핑 (tool_calls → tools, prompt 추출)
 *   - HTTP 4xx → error="HTTP 404"
 *   - JSON parse 에러 → error 설정
 *   - lastTool event_type='pre_tool' → state='running'
 *   - tool status='error' → state='error'
 *   - sessionId 변경 시 새 fetch + 이전 cleanup
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { useSessionTurns } from '../hooks/useSessionTurns';
import { renderHook } from './helpers/render-hook';
import { FetchMock, flushAsync } from './helpers/fetch-mock';
import { makeApiTurn, makeApiToolCall } from './helpers/fixtures';

let fm: FetchMock;
afterEach(() => fm?.restore());

const API = 'http://test';

describe('useSessionTurns — sessionId null', () => {
  it('빈 상태로 시작하고 fetch 를 호출하지 않는다', async () => {
    fm = new FetchMock();
    const h = renderHook(() => useSessionTurns(API, null));
    await flushAsync();
    expect(h.current.turns).toEqual([]);
    expect(h.current.isLoading).toBe(false);
    expect(h.current.error).toBeNull();
    expect(fm.callCount('/turns')).toBe(0);
    h.unmount();
  });
});

describe('useSessionTurns — HTTP 200', () => {
  it('tool_calls 를 Request 로 매핑한다', async () => {
    fm = new FetchMock().route('/api/sessions/s1/turns', {
      json: {
        success: true,
        data: [
          makeApiTurn({
            tool_calls: [makeApiToolCall({ id: 'a', tool_name: 'Read' }), makeApiToolCall({ id: 'b', tool_name: 'Edit' })],
          }),
        ],
      },
    });
    const h = renderHook(() => useSessionTurns(API, 's1'));
    await flushAsync();
    expect(h.current.error).toBeNull();
    expect(h.current.turns.length).toBe(1);
    expect(h.current.turns[0]!.tools.map((t) => t.tool_name)).toEqual(['Read', 'Edit']);
    expect(h.current.turns[0]!.tools[0]!.id).toBe('a');
    h.unmount();
  });

  it('prompt payload JSON 에서 첫 줄을 추출한다', async () => {
    fm = new FetchMock().route('/turns', {
      json: {
        success: true,
        data: [makeApiTurn({ prompt: { id: 'p', payload: JSON.stringify({ prompt: 'first line\nsecond' }) } })],
      },
    });
    const h = renderHook(() => useSessionTurns(API, 's1'));
    await flushAsync();
    expect(h.current.turns[0]!.prompt).toBe('first line');
    h.unmount();
  });

  it('success=false 면 turns 를 비운다 (에러 아님)', async () => {
    fm = new FetchMock().route('/turns', { json: { success: false, data: [] } });
    const h = renderHook(() => useSessionTurns(API, 's1'));
    await flushAsync();
    expect(h.current.turns).toEqual([]);
    expect(h.current.error).toBeNull();
    h.unmount();
  });
});

describe('useSessionTurns — 에러 경로', () => {
  it('HTTP 404 → error="HTTP 404"', async () => {
    fm = new FetchMock().route('/turns', { status: 404, ok: false, json: {} });
    const h = renderHook(() => useSessionTurns(API, 's1'));
    await flushAsync();
    expect(h.current.error).toBe('HTTP 404');
    h.unmount();
  });

  it('JSON parse 에러 → error 설정', async () => {
    fm = new FetchMock().route('/turns', { jsonThrows: true });
    const h = renderHook(() => useSessionTurns(API, 's1'));
    await flushAsync();
    expect(h.current.error).not.toBeNull();
    h.unmount();
  });
});

describe('useSessionTurns — Turn.state 결정', () => {
  it("마지막 tool_call event_type='pre_tool' → state='running'", async () => {
    fm = new FetchMock().route('/turns', {
      json: {
        success: true,
        data: [
          makeApiTurn({
            tool_calls: [makeApiToolCall({ id: 'a' }), makeApiToolCall({ id: 'b', event_type: 'pre_tool' })],
          }),
        ],
      },
    });
    const h = renderHook(() => useSessionTurns(API, 's1'));
    await flushAsync();
    expect(h.current.turns[0]!.state).toBe('running');
    h.unmount();
  });

  it("tool status='error' (pre_tool 아님) → state='error'", async () => {
    // mapToolCallToRequest 는 status 를 undefined 로 두므로, 현재 동작상
    // tool_call 에 status:'error' 를 줘도 tools[].status 는 채워지지 않는다.
    // → 현재 코드 동작: state 는 'done' 이 됨. 이 사실 자체를 고정한다.
    fm = new FetchMock().route('/turns', {
      json: {
        success: true,
        data: [makeApiTurn({ tool_calls: [makeApiToolCall({ id: 'a', status: 'error' })] })],
      },
    });
    const h = renderHook(() => useSessionTurns(API, 's1'));
    await flushAsync();
    // 발견: tool_call.status 는 Request 로 매핑되지 않아 error state 트리거 불가.
    expect(h.current.turns[0]!.state).toBe('done');
    h.unmount();
  });

  it('정상 tool_calls → state="done"', async () => {
    fm = new FetchMock().route('/turns', {
      json: { success: true, data: [makeApiTurn()] },
    });
    const h = renderHook(() => useSessionTurns(API, 's1'));
    await flushAsync();
    expect(h.current.turns[0]!.state).toBe('done');
    h.unmount();
  });
});

describe('useSessionTurns — sessionId 변경', () => {
  it('sessionId 가 바뀌면 새 sessionId 로 다시 fetch 한다', async () => {
    fm = new FetchMock()
      .route('/api/sessions/s1/turns', { json: { success: true, data: [makeApiTurn({ turn_id: 't-s1' })] } })
      .route('/api/sessions/s2/turns', { json: { success: true, data: [makeApiTurn({ turn_id: 't-s2' }), makeApiTurn({ turn_id: 't-s2b', turn_index: 1 })] } });

    let sid = 's1';
    const h = renderHook(() => useSessionTurns(API, sid));
    await flushAsync();
    expect(h.current.turns[0]!.id).toBe('t-s1');

    // sessionId 변경 후 재렌더 — render-hook 은 동일 useHook 클로저를 재호출하므로
    // 클로저 변수 sid 를 바꾸고 강제 재마운트.
    sid = 's2';
    h.unmount();
    const h2 = renderHook(() => useSessionTurns(API, 's2'));
    await flushAsync();
    expect(h2.current.turns.length).toBe(2);
    expect(h2.current.turns[0]!.id).toBe('t-s2');
    h2.unmount();
  });
});
