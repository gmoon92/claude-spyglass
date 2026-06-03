/**
 * session-detail.render.test.tsx — 특성화 테스트 (소스 변경 없음, 현재 렌더 출력이 스펙).
 *
 * SessionDetail 화면을 ink-testing-library 로 마운트하고 lastFrame() 문자열을
 * 검사한다. 데이터 소스인 useSessionTurns 는 전역 fetch 를 호출하므로
 * FetchMock 으로 응답을 주입하고 afterEach 에서 원복한다.
 *
 * 커버:
 *   - error 응답 → "Error: HTTP 404" 문구
 *   - turns 비어있음 (success=false) → "No turns yet."
 *   - N turns → TurnCard N개 (turn 헤더 문구 등장 횟수로 검증)
 *   - 타이틀에 세션 ID prefix("S-") 노출
 *
 * isLoading→Spinner: 초기 로딩 프레임은 fetch resolve 이전 1 tick 동안만
 * 존재하고 FetchMock 은 즉시 resolve 하므로, 결정적으로 잡으려고 fetch 를
 * 게이트로 지연시켜 첫 프레임을 캡처한다.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { SessionDetail } from '../screens/SessionDetail';
import { FetchMock, flushAsync } from './helpers/fetch-mock';
import { makeApiTurn } from './helpers/fixtures';

let fm: FetchMock;
afterEach(() => fm?.restore());

const API = 'http://test';

/** ANSI escape 제거. */
function strip(frame: string): string {
  // eslint-disable-next-line no-control-regex
  return frame.replace(/\x1B\[[0-9;]*m/g, '');
}

describe('SessionDetail — error 경로', () => {
  it('HTTP 404 → "Error: HTTP 404" 문구를 렌더한다', async () => {
    fm = new FetchMock().route('/turns', { status: 404, ok: false, json: {} });
    const { lastFrame, unmount } = render(<SessionDetail sessionId="abcd1234ef" apiUrl={API} />);
    await flushAsync();
    const out = strip(lastFrame() ?? '');
    expect(out).toContain('Error: HTTP 404');
    unmount();
  });
});

describe('SessionDetail — 빈 turns', () => {
  it('success=false → "No turns yet."', async () => {
    fm = new FetchMock().route('/turns', { json: { success: false, data: [] } });
    const { lastFrame, unmount } = render(<SessionDetail sessionId="abcd1234ef" apiUrl={API} />);
    await flushAsync();
    const out = strip(lastFrame() ?? '');
    expect(out).toContain('No turns yet.');
    unmount();
  });
});

describe('SessionDetail — N turns', () => {
  it('turns 3개 → TurnCard 3개가 렌더된다', async () => {
    fm = new FetchMock().route('/turns', {
      json: {
        success: true,
        data: [
          makeApiTurn({ turn_id: 't1', turn_index: 0 }),
          makeApiTurn({ turn_id: 't2', turn_index: 1 }),
          makeApiTurn({ turn_id: 't3', turn_index: 2 }),
        ],
      },
    });
    const { lastFrame, unmount } = render(<SessionDetail sessionId="abcd1234ef" apiUrl={API} />);
    await flushAsync();
    const out = strip(lastFrame() ?? '');
    // TurnCard 헤더는 "Turn" 단어를 turn 당 1회 노출한다 (현재 출력 기준).
    const turnHeaderCount = (out.match(/Turn/g) ?? []).length;
    expect(turnHeaderCount).toBeGreaterThanOrEqual(3);
    // 빈 상태 문구는 없어야 한다.
    expect(out).not.toContain('No turns yet.');
    unmount();
  });

  it('타이틀에 세션 ID prefix(S-) 가 노출된다', async () => {
    fm = new FetchMock().route('/turns', { json: { success: true, data: [makeApiTurn()] } });
    const { lastFrame, unmount } = render(<SessionDetail sessionId="abcd1234ef" apiUrl={API} />);
    await flushAsync();
    const out = strip(lastFrame() ?? '');
    expect(out).toContain('S-abcd1234');
    unmount();
  });
});

describe('SessionDetail — 로딩 상태', () => {
  it('fetch resolve 이전 첫 프레임에 "Loading turns…" Spinner 영역을 보인다', async () => {
    // fetch 를 게이트로 지연시켜 isLoading 프레임을 결정적으로 캡처한다.
    let releaseJson: (() => void) | null = null;
    const gate = new Promise<void>((r) => { releaseJson = r; });
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      await gate;
      return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) };
    }) as unknown as typeof globalThis.fetch;

    try {
      const { lastFrame, unmount } = render(<SessionDetail sessionId="abcd1234ef" apiUrl={API} />);
      await flushAsync(2);
      const out = strip(lastFrame() ?? '');
      expect(out).toContain('Loading turns');
      releaseJson!();
      await flushAsync();
      unmount();
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
