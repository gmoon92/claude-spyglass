/**
 * T6 — processHookEvent 의 SSE broadcast 스킵 정책 특성화 (현재 동작 고정).
 *
 * 검증 목적 (processor.ts L79~107 의 broadcast 게이트):
 *   - pre_tool: 미완성 레코드라 broadcast 안 함.
 *   - 멱등 흡수(duplicate=true: 중복 post / 늦은 pre): 새 행 미생성이므로 broadcast 안 함.
 *   - 정상 post(post-first INSERT 또는 pre→post 머지): broadcast 1회 발생, event_phase='created'.
 *
 * 관찰 방법:
 *   sseRouter 로 실제 SSE 연결을 1개 생성하고 ReadableStream reader 로 수신 이벤트를 모은다.
 *   초기 ping 1건은 무시하고, broadcast 가 만든 'new_request' 이벤트 수만 센다.
 *
 * 전역 오염 방지 (필수):
 *   sseRouter 가 모듈-로컬 connections Set 에 controller 를 등록하므로, 본 테스트는
 *   afterEach 에서 reader.cancel() + closeAllConnections() 로 모든 연결을 비워
 *   다른 테스트 파일(예: server.test.ts)에 leak 되지 않게 한다. 또한 connections 가
 *   비어 있을 때만 시작하도록 beforeEach 에서 closeAllConnections() 로 baseline 을 0 으로 맞춘다.
 *
 * 격리: 고유 임시 DB + afterEach 본체/-wal/-shm 삭제 + closeDatabase().
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { unlinkSync } from 'fs';
import { SpyglassDatabase, closeDatabase, createSession } from '@spyglass/storage';
import { processHookEvent } from '../processor';
import { sseRouter, closeAllConnections, getConnectionCount } from '../../sse';
import type { NormalizedHookPayload } from '../types';

const TEST_DB_PATH = `/tmp/spyglass-sse-skip-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`;

const decoder = new TextDecoder();

/** SSE 연결 1개 + 누적 청크 reader. close() 로 정리. */
function openSseListener(): {
  events: () => string;
  drain: () => Promise<void>;
  close: () => Promise<void>;
} {
  const res = sseRouter(new Request('http://localhost/sse'));
  const reader = res.body!.getReader();
  let buffer = '';
  let running = true;
  const pump = (async () => {
    try {
      while (running) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) buffer += decoder.decode(value, { stream: true });
      }
    } catch { /* cancelled */ }
  })();

  return {
    events: () => buffer,
    // 마이크로/매크로 태스크 한 박자 — enqueue 가 reader 로 흐를 시간을 준다.
    drain: async () => { await new Promise((r) => setTimeout(r, 20)); },
    close: async () => {
      running = false;
      try { await reader.cancel(); } catch { /* ignore */ }
      await pump.catch(() => {});
    },
  };
}

function countNewRequest(raw: string): number {
  return (raw.match(/event: new_request/g) ?? []).length;
}

function makeTool(opts: {
  id: string;
  session_id: string;
  event_type: 'pre_tool' | 'tool';
  tool_use_id: string;
  timestamp: number;
  tokens_total?: number;
}): NormalizedHookPayload {
  return {
    id: opts.id,
    session_id: opts.session_id,
    project_name: 'sse-skip-test',
    timestamp: opts.timestamp,
    event_type: opts.event_type,
    request_type: 'tool_call',
    tool_name: 'Bash',
    tool_detail: 'ls',
    tokens_input: 0,
    tokens_output: opts.tokens_total ?? 0,
    tokens_total: opts.tokens_total ?? 0,
    duration_ms: 0,
    payload: JSON.stringify({ tool_use_id: opts.tool_use_id }),
    source: 'test',
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    tokens_confidence: 'high',
    tokens_source: 'transcript',
  };
}

describe('T6 — SSE broadcast 스킵 정책', () => {
  let db: SpyglassDatabase;
  let sessionId: string;
  let listener: ReturnType<typeof openSseListener>;
  const now = Date.now() - 60_000;

  beforeEach(() => {
    // baseline: 이전 테스트가 남긴 연결이 있으면 비워 0 에서 시작.
    closeAllConnections();
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, {
      id: sessionId,
      project_name: 'sse-skip-test',
      started_at: now - 30_000,
    });
    listener = openSseListener();
  });

  afterEach(async () => {
    await listener.close();
    closeAllConnections(); // 전역 connections Set 비우기 (leak 방지)
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try { unlinkSync(`${TEST_DB_PATH}${ext}`); } catch { /* ignore */ }
    }
  });

  it('연결 1개만 등록 (격리 확인)', () => {
    expect(getConnectionCount()).toBe(1);
  });

  it('pre_tool → broadcast 0회 (new_request 미발생)', async () => {
    await listener.drain(); // 초기 ping 흡수
    processHookEvent(db.instance, makeTool({
      id: 'pre-x', session_id: sessionId, event_type: 'pre_tool',
      tool_use_id: 'tu-sse-pre', timestamp: now,
    }));
    await listener.drain();
    expect(countNewRequest(listener.events())).toBe(0);
  });

  it('정상 post-first → broadcast 1회 (event_phase=created)', async () => {
    await listener.drain();
    processHookEvent(db.instance, makeTool({
      id: 'post-x', session_id: sessionId, event_type: 'tool',
      tool_use_id: 'tu-sse-post', timestamp: now + 1000, tokens_total: 30,
    }));
    await listener.drain();
    const raw = listener.events();
    expect(countNewRequest(raw)).toBe(1);
    expect(raw).toContain('"event_phase":"created"');
  });

  it('중복 post(duplicate=true) → 두 번째 post 는 broadcast 안 함 (총 1회)', async () => {
    await listener.drain();
    processHookEvent(db.instance, makeTool({
      id: 'dup-a', session_id: sessionId, event_type: 'tool',
      tool_use_id: 'tu-sse-dup', timestamp: now + 1000, tokens_total: 30,
    }));
    processHookEvent(db.instance, makeTool({
      id: 'dup-b', session_id: sessionId, event_type: 'tool',
      tool_use_id: 'tu-sse-dup', timestamp: now + 2000, tokens_total: 99,
    }));
    await listener.drain();
    // 첫 post 만 broadcast, 둘째는 멱등 흡수라 스킵 → 총 1회.
    expect(countNewRequest(listener.events())).toBe(1);
  });

  it('pre→post 머지 → broadcast 1회 (pre 는 스킵, post 머지 시 1회)', async () => {
    await listener.drain();
    processHookEvent(db.instance, makeTool({
      id: 'merge-pre', session_id: sessionId, event_type: 'pre_tool',
      tool_use_id: 'tu-sse-merge', timestamp: now,
    }));
    processHookEvent(db.instance, makeTool({
      id: 'merge-post', session_id: sessionId, event_type: 'tool',
      tool_use_id: 'tu-sse-merge', timestamp: now + 1000, tokens_total: 40,
    }));
    await listener.drain();
    expect(countNewRequest(listener.events())).toBe(1);
  });

  it('늦은 pre(post-first 이후 도착, duplicate=true) → pre 흡수라 추가 broadcast 없음 (총 1회)', async () => {
    await listener.drain();
    processHookEvent(db.instance, makeTool({
      id: 'ooo-post', session_id: sessionId, event_type: 'tool',
      tool_use_id: 'tu-sse-ooo', timestamp: now + 1000, tokens_total: 50,
    }));
    processHookEvent(db.instance, makeTool({
      id: 'ooo-pre', session_id: sessionId, event_type: 'pre_tool',
      tool_use_id: 'tu-sse-ooo', timestamp: now,
    }));
    await listener.drain();
    // post-first 1회 broadcast, 늦은 pre 는 흡수+pre라 broadcast 안 함.
    expect(countNewRequest(listener.events())).toBe(1);
  });
});
