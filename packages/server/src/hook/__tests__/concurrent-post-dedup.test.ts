/**
 * T2 — 동일 tool_use_id PostToolUse 2건 연속/유사동시 도착 시 행 수·토큰 누적 현재 동작 고정.
 *
 * 검증 목적 (consistency-hardening P0.1 멱등 흡수 정책 특성화):
 *   동일 (session, tool_use_id) 의 PostToolUse 가 두 번 들어와도 'tool' 행은 1개만 유지되고,
 *   첫 값이 고정되며(정책 b), 세션 토큰은 이중 누적되지 않는다.
 *
 *   본 테스트는 persist 단(saveRequest 반환 + 행 수) 과 processor 단(세션 토큰)을 함께 고정한다.
 *   persist-merge-race.test.ts 는 pre→post→post 시나리오를, processor-token-accrual.test.ts 는
 *   토큰 누적을 다루지만, "pre 없이 post-first 가 2번 들어오는" 순수 중복 케이스는 두 곳 모두
 *   직접 다루지 않으므로 본 테스트가 그 공백을 메운다.
 *
 * 격리: 고유 임시 DB + afterEach 본체/-wal/-shm 삭제 + closeDatabase(). sessionId 는 uuid.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { unlinkSync } from 'fs';
import type { Database } from 'bun:sqlite';
import {
  SpyglassDatabase,
  closeDatabase,
  createSession,
  getSessionById,
} from '@spyglass/storage';
import { saveRequest } from '../persist';
import { processHookEvent } from '../processor';
import type { NormalizedHookPayload } from '../types';

const TEST_DB_PATH = `/tmp/spyglass-concurrent-post-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`;

function fetchRows(inst: Database, sessionId: string) {
  return inst.query(
    'SELECT id, event_type, tool_use_id, tokens_total FROM requests WHERE session_id = ? ORDER BY timestamp ASC',
  ).all(sessionId) as Array<{ id: string; event_type: string | null; tool_use_id: string | null; tokens_total: number }>;
}

function makePost(opts: {
  id: string;
  session_id: string;
  tool_use_id: string;
  tokens_total: number;
  timestamp: number;
}): NormalizedHookPayload {
  return {
    id: opts.id,
    session_id: opts.session_id,
    project_name: 'concurrent-post-test',
    timestamp: opts.timestamp,
    event_type: 'tool',
    request_type: 'tool_call',
    tool_name: 'Bash',
    tool_detail: 'ls',
    tokens_input: 0,
    tokens_output: opts.tokens_total,
    tokens_total: opts.tokens_total,
    duration_ms: 0,
    payload: JSON.stringify({ tool_use_id: opts.tool_use_id }),
    source: 'test',
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    tokens_confidence: 'high',
    tokens_source: 'transcript',
  };
}

describe('T2 — 동일 tool_use_id post 중복 도착', () => {
  let db: SpyglassDatabase;
  let sessionId: string;
  const now = Date.now() - 60_000;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, {
      id: sessionId,
      project_name: 'concurrent-post-test',
      started_at: now - 30_000,
    });
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try { unlinkSync(`${TEST_DB_PATH}${ext}`); } catch { /* ignore */ }
    }
  });

  it('persist: post-first 2건 — 첫 건 INSERT, 둘째 건 멱등 흡수(단일 행, 첫 값 고정)', () => {
    const tuid = 'tu-post-dup';
    const r1 = saveRequest(db.instance, makePost({
      id: 'post-a', session_id: sessionId, tool_use_id: tuid, tokens_total: 50, timestamp: now + 1000,
    }));
    expect(r1.saved).toBe(true);
    expect(r1.wasUpsert).toBe(false);    // post-first 최초 → 일반 INSERT
    expect(r1.duplicate).toBeUndefined();

    const r2 = saveRequest(db.instance, makePost({
      id: 'post-b', session_id: sessionId, tool_use_id: tuid, tokens_total: 70, timestamp: now + 2000,
    }));
    expect(r2.saved).toBe(true);
    expect(r2.wasUpsert).toBe(false);
    expect(r2.duplicate).toBe(true);     // 이미 'tool' 행 존재 → 흡수
    expect(r2.savedId).toBe('post-a');   // 흡수 대상은 첫 'tool' 행

    const rows = fetchRows(db.instance, sessionId).filter(r => r.tool_use_id === tuid);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('post-a');
    expect(rows[0].tokens_total).toBe(50); // 첫 값 고정 — 70 무시
  });

  it('processor: post-first 2건 — 세션 토큰은 첫 post 값만 (이중 누적 없음)', () => {
    const tuid = 'tu-post-dup-tok';
    processHookEvent(db.instance, makePost({
      id: 'p-a', session_id: sessionId, tool_use_id: tuid, tokens_total: 40, timestamp: now + 1000,
    }));
    processHookEvent(db.instance, makePost({
      id: 'p-b', session_id: sessionId, tool_use_id: tuid, tokens_total: 90, timestamp: now + 2000,
    }));

    // 첫 post 40 만 누적, 둘째(90)는 흡수되어 미누적.
    expect(getSessionById(db.instance, sessionId)?.total_tokens).toBe(40);
    const rows = fetchRows(db.instance, sessionId).filter(r => r.tool_use_id === tuid);
    expect(rows.length).toBe(1);
  });

  it('persist: 3건 연속 post — 단일 행 유지, 첫 값 고정', () => {
    const tuid = 'tu-post-triple';
    saveRequest(db.instance, makePost({ id: 't1', session_id: sessionId, tool_use_id: tuid, tokens_total: 11, timestamp: now + 1000 }));
    const r2 = saveRequest(db.instance, makePost({ id: 't2', session_id: sessionId, tool_use_id: tuid, tokens_total: 22, timestamp: now + 2000 }));
    const r3 = saveRequest(db.instance, makePost({ id: 't3', session_id: sessionId, tool_use_id: tuid, tokens_total: 33, timestamp: now + 3000 }));
    expect(r2.duplicate).toBe(true);
    expect(r3.duplicate).toBe(true);

    const rows = fetchRows(db.instance, sessionId).filter(r => r.tool_use_id === tuid);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('t1');
    expect(rows[0].tokens_total).toBe(11);
  });
});
