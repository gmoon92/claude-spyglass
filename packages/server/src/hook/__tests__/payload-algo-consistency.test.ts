/**
 * T1 — pre_tool INSERT → post_tool UPDATE(merge) 시 payload / payload_algo 일관성 특성화.
 *
 * 검증 목적 (현재 동작 고정):
 *   mergePostToolIntoPreTool(persist.ts)는 UPDATE 시 payload 와 payload_algo 를 *함께* 갱신한다.
 *   pre_tool INSERT 가 남긴 algo(암호화 ON 이면 'aes256gcm') 와 post 평문 payload 가 어긋나면
 *   복호 실패(silent corruption)가 나므로, 머지 후 행을 read-back 했을 때 평문이 정확히 복원돼야 한다.
 *
 *   - 암호화 OFF: payload 평문 그대로, payload_algo NULL, getRequestById 평문 복원.
 *   - 암호화 ON : payload 는 base64 암호문(평문 비노출), payload_algo='aes256gcm',
 *                 getRequestById 가 post 의 평문으로 복호.
 *
 * 격리: 고유 임시 DB + afterEach 본체/-wal/-shm 삭제 + closeDatabase().
 *       암호화 env 는 자기 테스트 내에서만 토글하고 afterEach 에서 원복 + resetEncryptionRuntime.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { unlinkSync } from 'fs';
import {
  SpyglassDatabase,
  closeDatabase,
  createSession,
  getRequestById,
  generateKey,
  resetEncryptionRuntime,
} from '@spyglass/storage';
import { saveRequest } from '../persist';
import type { NormalizedHookPayload } from '../types';

const TEST_DB_PATH = `/tmp/spyglass-payload-algo-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`;

function enableEncryption(): void {
  process.env.SPYGLASS_ENCRYPTION = '1';
  process.env.SPYGLASS_ENCRYPTION_KEY = generateKey().toString('base64');
  resetEncryptionRuntime();
}
function disableEncryption(): void {
  delete process.env.SPYGLASS_ENCRYPTION;
  delete process.env.SPYGLASS_ENCRYPTION_KEY;
  resetEncryptionRuntime();
}

/** pre/post payload 본문에 tool_use_id + 식별 텍스트를 담아 read-back 검증이 가능하도록 한다. */
function makePayload(opts: {
  id: string;
  session_id: string;
  event_type: 'pre_tool' | 'tool';
  tool_use_id: string;
  bodyText: string;
  timestamp: number;
  tokens_total?: number;
}): NormalizedHookPayload {
  return {
    id: opts.id,
    session_id: opts.session_id,
    project_name: 'payload-algo-test',
    timestamp: opts.timestamp,
    event_type: opts.event_type,
    request_type: 'tool_call',
    tool_name: 'Bash',
    tool_detail: 'ls',
    tokens_input: 0,
    tokens_output: opts.tokens_total ?? 0,
    tokens_total: opts.tokens_total ?? 0,
    duration_ms: 0,
    payload: JSON.stringify({ tool_use_id: opts.tool_use_id, body: opts.bodyText }),
    source: 'test',
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    tokens_confidence: 'high',
    tokens_source: 'transcript',
  };
}

function rawRow(db: SpyglassDatabase, id: string): { payload: string | null; payload_algo: string | null } {
  return db.instance
    .query('SELECT payload, payload_algo FROM requests WHERE id = ?')
    .get(id) as { payload: string | null; payload_algo: string | null };
}

describe('T1 — pre→post merge payload/payload_algo 일관성', () => {
  let db: SpyglassDatabase;
  let sessionId: string;
  const now = Date.now() - 60_000;

  beforeEach(() => {
    disableEncryption();
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, {
      id: sessionId,
      project_name: 'payload-algo-test',
      started_at: now - 30_000,
    });
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try { unlinkSync(`${TEST_DB_PATH}${ext}`); } catch { /* ignore */ }
    }
    disableEncryption();
  });

  it('암호화 OFF — 머지 후 payload 평문 + algo NULL + read-back 일치', () => {
    const tuid = 'tu-algo-off';
    const PRE_BODY = 'pre-body-plain';
    const POST_BODY = 'post-body-plain';

    saveRequest(db.instance, makePayload({
      id: 'pre-off', session_id: sessionId, event_type: 'pre_tool',
      tool_use_id: tuid, bodyText: PRE_BODY, timestamp: now,
    }));
    const r = saveRequest(db.instance, makePayload({
      id: 'post-off', session_id: sessionId, event_type: 'tool',
      tool_use_id: tuid, bodyText: POST_BODY, timestamp: now + 1000, tokens_total: 30,
    }));
    expect(r.wasUpsert).toBe(true);
    expect(r.savedId).toBe('pre-off');

    const raw = rawRow(db, 'pre-off');
    expect(raw.payload_algo).toBeNull();
    // 머지된 payload 는 post 본문으로 교체됨 (평문).
    expect(raw.payload).toContain(POST_BODY);

    const decoded = getRequestById(db.instance, 'pre-off')!;
    expect(JSON.parse(decoded.payload as string).body).toBe(POST_BODY);
  });

  it('암호화 ON — 머지 후 payload 암호문(평문 비노출) + algo aes256gcm + read-back 복호', () => {
    enableEncryption();
    const tuid = 'tu-algo-on';
    const PRE_BODY = 'pre-secret-민감';
    const POST_BODY = 'post-secret-민감본문';

    saveRequest(db.instance, makePayload({
      id: 'pre-on', session_id: sessionId, event_type: 'pre_tool',
      tool_use_id: tuid, bodyText: PRE_BODY, timestamp: now,
    }));
    const r = saveRequest(db.instance, makePayload({
      id: 'post-on', session_id: sessionId, event_type: 'tool',
      tool_use_id: tuid, bodyText: POST_BODY, timestamp: now + 1000, tokens_total: 30,
    }));
    expect(r.wasUpsert).toBe(true);

    const raw = rawRow(db, 'pre-on');
    expect(raw.payload_algo).toBe('aes256gcm');
    // 암호문이라 평문 본문이 그대로 노출되면 안 됨.
    expect(raw.payload).not.toContain('post-secret');
    expect(raw.payload).not.toContain('민감');

    // 서버측 복호 funnel(getRequestById)이 post 평문으로 복원.
    const decoded = getRequestById(db.instance, 'pre-on')!;
    expect(JSON.parse(decoded.payload as string).body).toBe(POST_BODY);
  });

  it('암호화 OFF→ON: pre 는 OFF(평문 algo NULL), post 머지는 ON → 행 전체가 ON 정책으로 일관 갱신', () => {
    // pre_tool 을 평문으로 INSERT 한 뒤 암호화를 켜고 post 머지 → mergePostToolIntoPreTool 가
    // payload+payload_algo 를 함께 갱신하므로 행은 ON 정책(aes256gcm)으로 수렴하고 복호 가능.
    const tuid = 'tu-algo-toggle';
    const POST_BODY = 'toggled-body';

    saveRequest(db.instance, makePayload({
      id: 'pre-tog', session_id: sessionId, event_type: 'pre_tool',
      tool_use_id: tuid, bodyText: 'pre-plain', timestamp: now,
    }));
    // pre 는 평문 저장 확인.
    expect(rawRow(db, 'pre-tog').payload_algo).toBeNull();

    enableEncryption();
    const r = saveRequest(db.instance, makePayload({
      id: 'post-tog', session_id: sessionId, event_type: 'tool',
      tool_use_id: tuid, bodyText: POST_BODY, timestamp: now + 1000, tokens_total: 10,
    }));
    expect(r.wasUpsert).toBe(true);

    const raw = rawRow(db, 'pre-tog');
    // 머지가 algo 를 함께 갱신 → 평문/algo 불일치(silent corruption) 없음.
    expect(raw.payload_algo).toBe('aes256gcm');
    expect(raw.payload).not.toContain(POST_BODY);
    expect(JSON.parse(getRequestById(db.instance, 'pre-tog')!.payload as string).body).toBe(POST_BODY);
  });
});
