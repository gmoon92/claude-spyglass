/**
 * processor-token-accrual.test.ts — 세션 토큰 이중 누적 방지 통합 가드 (P0.1)
 *
 * 배경:
 *   persist-merge-race.test 는 saveRequest 단위(행 수)만 검증한다. 그러나 멱등 흡수
 *   (duplicate=true)의 실제 가치는 processor.processHookEvent 가 세션 토큰을 *이중으로*
 *   누적하지 않는 데 있다 — 중복 PostToolUse 가 도착해도 sessions.total_tokens 는 첫 값만
 *   반영해야 한다(정책 b: 첫 값 고정).
 *
 *   본 테스트는 saveRequest → updateSessionTotalTokens → (duplicate 시 skip) 전 경로를
 *   processHookEvent 로 통과시켜, 중복 post 가 세션 토큰을 부풀리지 않음을 고정한다.
 *
 * 격리: 고유 임시 DB, autoInit, afterEach 정리. session_id 는 uuid 로 in-memory 캐시 충돌 회피.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { unlinkSync } from 'fs';
import { SpyglassDatabase, closeDatabase, getSessionById } from '@spyglass/storage';
import { processHookEvent } from '../processor';
import type { NormalizedHookPayload } from '../types';

const TEST_DB_PATH = `/tmp/spyglass-token-accrual-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`;

function makeToolPayload(opts: {
  id: string;
  session_id: string;
  event_type: 'pre_tool' | 'tool';
  tool_use_id: string;
  tokens_total?: number;
  timestamp: number;
}): NormalizedHookPayload {
  const tokens = opts.tokens_total ?? 0;
  return {
    id: opts.id,
    session_id: opts.session_id,
    project_name: 'token-accrual-test',
    timestamp: opts.timestamp,
    event_type: opts.event_type,
    request_type: 'tool_call',
    tool_name: 'Bash',
    tool_detail: 'ls',
    tokens_input: 0,
    tokens_output: tokens,
    tokens_total: tokens,
    duration_ms: 0,
    payload: JSON.stringify({ tool_use_id: opts.tool_use_id }),
    source: 'test',
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    tokens_confidence: 'high',
    tokens_source: 'transcript',
  };
}

describe('processHookEvent — 세션 토큰 이중 누적 방지 (P0.1)', () => {
  let db: SpyglassDatabase;
  let sessionId: string;
  const now = Date.now() - 60_000;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try {
        unlinkSync(`${TEST_DB_PATH}${ext}`);
      } catch {
        /* ignore */
      }
    }
  });

  it('정상 pre→post: 세션 토큰 = post 토큰 (1회 누적)', () => {
    const tuid = 'tu-normal';
    processHookEvent(db.instance, makeToolPayload({ id: 'pre-1', session_id: sessionId, event_type: 'pre_tool', tool_use_id: tuid, timestamp: now }));
    processHookEvent(db.instance, makeToolPayload({ id: 'post-1', session_id: sessionId, event_type: 'tool', tool_use_id: tuid, tokens_total: 50, timestamp: now + 1000 }));

    expect(getSessionById(db.instance, sessionId)?.total_tokens).toBe(50);
  });

  it('중복 PostToolUse: 세션 토큰은 첫 post 값만 (이중 누적 없음)', () => {
    const tuid = 'tu-dup';
    processHookEvent(db.instance, makeToolPayload({ id: 'pre-2', session_id: sessionId, event_type: 'pre_tool', tool_use_id: tuid, timestamp: now }));
    processHookEvent(db.instance, makeToolPayload({ id: 'post-2a', session_id: sessionId, event_type: 'tool', tool_use_id: tuid, tokens_total: 50, timestamp: now + 1000 }));
    // 두 번째 post — 흡수(duplicate) → 토큰 누적 건너뜀.
    processHookEvent(db.instance, makeToolPayload({ id: 'post-2b', session_id: sessionId, event_type: 'tool', tool_use_id: tuid, tokens_total: 70, timestamp: now + 2000 }));

    // 70 이 더해지지 않고 첫 post 의 50 만 유지.
    expect(getSessionById(db.instance, sessionId)?.total_tokens).toBe(50);
  });

  it('out-of-order post-first + 늦은 pre: 세션 토큰 = post 1회만', () => {
    const tuid = 'tu-ooo';
    // post 먼저 — 정상 INSERT, 토큰 누적.
    processHookEvent(db.instance, makeToolPayload({ id: 'post-ooo', session_id: sessionId, event_type: 'tool', tool_use_id: tuid, tokens_total: 40, timestamp: now + 1000 }));
    // 늦은 pre — 흡수(duplicate) → pre 는 토큰 0 이지만 누적 자체를 건너뜀(broadcast 도 skip).
    processHookEvent(db.instance, makeToolPayload({ id: 'pre-ooo', session_id: sessionId, event_type: 'pre_tool', tool_use_id: tuid, timestamp: now }));

    expect(getSessionById(db.instance, sessionId)?.total_tokens).toBe(40);
  });
});
