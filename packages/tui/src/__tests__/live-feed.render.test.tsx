/**
 * live-feed.render.test.tsx — 특성화 테스트 (소스 변경 없음, 현재 렌더 출력이 스펙).
 *
 * LiveFeed 화면을 ink-testing-library 로 마운트하고 lastFrame() 문자열을 검사한다.
 *
 * 의존성 주입:
 *   - i18n: t() 호출이 키를 그대로 노출하지 않도록 beforeAll 에서 initI18n('en').
 *   - useProxyRequests 의 EventSource: mock.module('eventsource', …) 로 Fake 주입.
 *   - 전역 fetch: FetchMock (proxy-requests 응답).
 *   - useFeed 의 feedStore: 싱글톤이므로 각 테스트에서 reset([]) 로 비우고,
 *     행 주입은 feedStore.push() + microtask flush 로 수행한다.
 *
 * 커버:
 *   - 빈 feed → EmptyState ("Waiting for Claude activity…")
 *   - 행 N개 → ToolRow N개 (tool_name 등장) + 타이틀 "· N req"
 *   - latestEndTurn 있으면 응답 바("[end_turn]") 노출
 *
 * search 필터(입력 키 기반)는 useInput 키 시뮬레이션이 ink-testing-library
 * stdin 주입을 요구하고 비결정적이라, 순수 필터 로직은 이미 feed-store/
 * follow-mode-logic 계열로 특성화됨. 여기서는 렌더 표면만 고정한다.
 */

import { describe, it, expect, afterEach, beforeAll, mock } from 'bun:test';
import React from 'react';
import { FakeEventSource, resetEsInstances } from './helpers/eventsource-mock';
import { FetchMock, flushAsync } from './helpers/fetch-mock';
import { makeRequest, makeProxyRow } from './helpers/fixtures';

// eventsource 패키지를 Fake 로 교체 (파일 전역 1회) — useProxyRequests 가 import.
mock.module('eventsource', () => ({ EventSource: FakeEventSource }));

// mock.module 적용 뒤 import 되도록 동적 import.
const { render } = await import('ink-testing-library');
const { LiveFeed } = await import('../screens/LiveFeed');
const { feedStore } = await import('../stores/feed-store');
const { initI18n } = await import('../i18n');

beforeAll(async () => {
  await initI18n('en');
});

let fm: FetchMock;
afterEach(() => {
  fm?.restore();
  resetEsInstances();
  // 다음 테스트로 행이 누수되지 않도록 store 비우기.
  feedStore.reset([]);
});

const API = 'http://test';

/** ANSI escape 제거. */
function strip(frame: string): string {
  // eslint-disable-next-line no-control-regex
  return frame.replace(/\x1B\[[0-9;]*m/g, '');
}

const baseProps = {
  width: 120,
  rows: 30,
  sseStatus: 'open',
  frozen: false,
  apiUrl: API,
};

/** microtask 기반 flush 가 끝나도록 대기. */
async function settle(): Promise<void> {
  await flushAsync(5);
}

describe('LiveFeed — 빈 feed', () => {
  it('feed 가 비면 EmptyState 를 렌더한다', async () => {
    feedStore.reset([]);
    fm = new FetchMock().route('/api/proxy-requests', { json: { data: [] } });
    const { lastFrame, unmount } = render(<LiveFeed {...baseProps} />);
    await settle();
    const out = strip(lastFrame() ?? '');
    expect(out).toContain('Waiting for Claude activity');
    // 타이틀 0 req
    expect(out).toContain('0 req');
    unmount();
  });
});

describe('LiveFeed — 행 렌더', () => {
  it('feed 에 행이 있으면 ToolRow 와 req count 가 노출된다', async () => {
    feedStore.reset([]);
    fm = new FetchMock().route('/api/proxy-requests', { json: { data: [] } });

    // store 에 행 주입 후 microtask flush.
    feedStore.push(makeRequest({ id: 'r1', tool_use_id: 'u1', tool_name: 'Read', tool_detail: 'alpha.ts' }));
    feedStore.push(makeRequest({ id: 'r2', tool_use_id: 'u2', tool_name: 'Bash', tool_detail: 'npm test' }));
    await settle();

    const { lastFrame, unmount } = render(<LiveFeed {...baseProps} />);
    await settle();
    const out = strip(lastFrame() ?? '');
    expect(out).toContain('Read');
    expect(out).toContain('Bash');
    // 타이틀 "· 2 req"
    expect(out).toContain('2 req');
    expect(out).not.toContain('Waiting for Claude activity');
    unmount();
  });
});

describe('LiveFeed — latestEndTurn 응답 바', () => {
  it('proxy end_turn 응답이 있으면 [end_turn] 바를 노출한다', async () => {
    feedStore.reset([]);
    fm = new FetchMock().route('/api/proxy-requests', {
      json: {
        data: [makeProxyRow({ stop_reason: 'end_turn', response_preview: 'hello world', model: 'claude-sonnet-x' })],
      },
    });
    const { lastFrame, unmount } = render(<LiveFeed {...baseProps} />);
    await settle();
    const out = strip(lastFrame() ?? '');
    expect(out).toContain('end_turn');
    expect(out).toContain('hello world');
    unmount();
  });
});

describe('LiveFeed — frozen 타이틀', () => {
  it('frozen=true → 타이틀에 [FROZEN] 표지', async () => {
    feedStore.reset([]);
    fm = new FetchMock().route('/api/proxy-requests', { json: { data: [] } });
    feedStore.push(makeRequest({ id: 'r1', tool_use_id: 'u1', tool_name: 'Read' }));
    await settle();
    const { lastFrame, unmount } = render(<LiveFeed {...baseProps} frozen={true} />);
    await settle();
    const out = strip(lastFrame() ?? '');
    expect(out).toContain('FROZEN');
    unmount();
  });
});
