/**
 * T8 — pre/post 시간 역순(timestamp 역전) 도착 시 merge 동작 고정.
 *
 * 검증 목적 (persist.ts mergePostToolIntoPreTool / saveRequest 의 timestamp 무관성 특성화):
 *   Upsert merge 는 (session_id, tool_use_id) 매칭으로만 결정되며 timestamp 비교를 하지 않는다.
 *   따라서 timestamp 가 역전돼 있어도(예: pre.timestamp > post.timestamp, 또는 post 가 먼저
 *   수신됐지만 더 작은 timestamp 를 가진 pre 가 나중에 와도) 동작은 수신 순서(arrival order)에
 *   의해서만 갈린다.
 *
 *   고정 항목:
 *     1. pre(늦은 ts) → post(이른 ts) 수신: 정상 머지(UPDATE), 행 1개, savedId=pre.
 *        merge 는 timestamp 컬럼을 갱신하지 않으므로 행 timestamp 는 *pre 의 값* 유지.
 *     2. post(이른 ts) 먼저 수신 → pre(늦은 ts) 나중 수신: post-first INSERT 후 pre 멱등 흡수.
 *        남는 행은 post 행(post 의 timestamp).
 *     3. 토큰/duration 은 항상 post 값으로 채워진다(시간 순서 무관).
 *
 * 격리: 고유 임시 DB + afterEach 본체/-wal/-shm 삭제 + closeDatabase(). sessionId 는 uuid.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { unlinkSync } from 'fs';
import type { Database } from 'bun:sqlite';
import { SpyglassDatabase, closeDatabase, createSession } from '@spyglass/storage';
import { saveRequest } from '../persist';
import type { NormalizedHookPayload } from '../types';

const TEST_DB_PATH = `/tmp/spyglass-ts-invert-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`;

function fetchRows(inst: Database, sessionId: string) {
  return inst.query(
    'SELECT id, event_type, tool_use_id, timestamp, tokens_total, duration_ms FROM requests WHERE session_id = ? ORDER BY timestamp ASC',
  ).all(sessionId) as Array<{
    id: string; event_type: string | null; tool_use_id: string | null;
    timestamp: number; tokens_total: number; duration_ms: number;
  }>;
}

function makeTool(opts: {
  id: string;
  session_id: string;
  event_type: 'pre_tool' | 'tool';
  tool_use_id: string;
  timestamp: number;
  tokens_total?: number;
  duration_ms?: number;
}): NormalizedHookPayload {
  return {
    id: opts.id,
    session_id: opts.session_id,
    project_name: 'ts-invert-test',
    timestamp: opts.timestamp,
    event_type: opts.event_type,
    request_type: 'tool_call',
    tool_name: 'Bash',
    tool_detail: 'ls',
    tokens_input: 0,
    tokens_output: opts.tokens_total ?? 0,
    tokens_total: opts.tokens_total ?? 0,
    duration_ms: opts.duration_ms ?? 0,
    payload: JSON.stringify({ tool_use_id: opts.tool_use_id }),
    source: 'test',
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    tokens_confidence: 'high',
    tokens_source: 'transcript',
  };
}

describe('T8 — pre/post 시간 역순 도착 merge', () => {
  let db: SpyglassDatabase;
  let sessionId: string;
  const base = Date.now() - 60_000;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, {
      id: sessionId,
      project_name: 'ts-invert-test',
      started_at: base - 30_000,
    });
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try { unlinkSync(`${TEST_DB_PATH}${ext}`); } catch { /* ignore */ }
    }
  });

  it('pre(늦은 ts) 먼저 수신 → post(이른 ts) 나중 수신: 정상 머지, 행 timestamp 는 pre 값 유지', () => {
    const tuid = 'tu-invert-pre-late-ts';
    const PRE_TS = base + 5000;  // pre 가 더 늦은 시각
    const POST_TS = base + 1000; // post 가 더 이른 시각 (역전)

    // 수신 순서: pre 먼저, post 나중.
    const r1 = saveRequest(db.instance, makeTool({
      id: 'inv-pre', session_id: sessionId, event_type: 'pre_tool',
      tool_use_id: tuid, timestamp: PRE_TS,
    }));
    expect(r1.wasUpsert).toBe(false);

    const r2 = saveRequest(db.instance, makeTool({
      id: 'inv-post', session_id: sessionId, event_type: 'tool',
      tool_use_id: tuid, timestamp: POST_TS, tokens_total: 30, duration_ms: 500,
    }));
    // timestamp 역전과 무관 — tool_use_id 매칭으로 정상 머지.
    expect(r2.wasUpsert).toBe(true);
    expect(r2.savedId).toBe('inv-pre');

    const rows = fetchRows(db.instance, sessionId).filter(r => r.tool_use_id === tuid);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('inv-pre');
    expect(rows[0].event_type).toBe('tool');
    // merge 는 timestamp 를 갱신하지 않음 → pre 의 timestamp(늦은 값) 유지.
    expect(rows[0].timestamp).toBe(PRE_TS);
    // 토큰/duration 은 post 값.
    expect(rows[0].tokens_total).toBe(30);
    expect(rows[0].duration_ms).toBe(500);
  });

  it('post(이른 ts) 먼저 수신 → pre(늦은 ts) 나중 수신: post-first INSERT + pre 멱등 흡수, post timestamp 유지', () => {
    const tuid = 'tu-invert-post-first';
    const POST_TS = base + 1000;
    const PRE_TS = base + 5000;

    const r1 = saveRequest(db.instance, makeTool({
      id: 'pf-post', session_id: sessionId, event_type: 'tool',
      tool_use_id: tuid, timestamp: POST_TS, tokens_total: 70, duration_ms: 222,
    }));
    expect(r1.wasUpsert).toBe(false); // post-first 최초 INSERT

    const r2 = saveRequest(db.instance, makeTool({
      id: 'pf-pre', session_id: sessionId, event_type: 'pre_tool',
      tool_use_id: tuid, timestamp: PRE_TS,
    }));
    // 이미 'tool' 행 존재 → 늦은 pre 멱등 흡수(새 행 미생성).
    expect(r2.duplicate).toBe(true);
    expect(r2.savedId).toBe('pf-post');

    const rows = fetchRows(db.instance, sessionId).filter(r => r.tool_use_id === tuid);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('pf-post');
    expect(rows[0].timestamp).toBe(POST_TS); // post 행 그대로 — 늦은 pre 영향 없음
    expect(rows[0].tokens_total).toBe(70);
    expect(rows[0].duration_ms).toBe(222);
  });

  it('동일 timestamp 의 pre/post — 정상 머지 (동률도 매칭 기반)', () => {
    const tuid = 'tu-invert-equal-ts';
    const TS = base + 3000;
    saveRequest(db.instance, makeTool({
      id: 'eq-pre', session_id: sessionId, event_type: 'pre_tool',
      tool_use_id: tuid, timestamp: TS,
    }));
    const r = saveRequest(db.instance, makeTool({
      id: 'eq-post', session_id: sessionId, event_type: 'tool',
      tool_use_id: tuid, timestamp: TS, tokens_total: 11,
    }));
    expect(r.wasUpsert).toBe(true);

    const rows = fetchRows(db.instance, sessionId).filter(r => r.tool_use_id === tuid);
    expect(rows.length).toBe(1);
    expect(rows[0].event_type).toBe('tool');
    expect(rows[0].tokens_total).toBe(11);
  });
});
