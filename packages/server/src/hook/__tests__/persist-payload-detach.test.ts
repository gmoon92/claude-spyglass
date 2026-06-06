/**
 * storage-payload-detach (Migration 063) — server write 경로(persist.ts)가 payload 를
 * request_payloads off-row 테이블에만 기록하는지 end-to-end 회귀.
 *
 * 검증 목적:
 *   063 에서 requests.payload/payload_algo 컬럼이 DROP 되어 request_payloads 가 단일 소스다.
 *   놓치기 쉬운 두 write 경로를 고정한다:
 *     1) mergePostToolIntoPreTool — saveRequest 의 pre_tool INSERT → post_tool merge(UPDATE).
 *        머지 후 payload 가 request_payloads 에 있고 getRequestById 로 복원되며, requests 본체엔
 *        payload 컬럼이 없다(전송 최적화 — 피드 스칼라 read 가 BLOB 미회수).
 *     2) persistAssistantTextResponses — response 행 payload 가 request_payloads 에 기록 + 복원.
 *        INSERT OR IGNORE 중복 시 기존 off-row payload 가 보존된다(재호출 멱등).
 *
 * 격리: 고유 임시 DB + afterEach 본체/-wal/-shm 삭제 + db.close(). 암호화 OFF 고정.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { unlinkSync } from 'fs';
import {
  SpyglassDatabase,
  createSession,
  getRequestById,
  resetEncryptionRuntime,
} from '@spyglass/storage';
import { saveRequest, persistAssistantTextResponses } from '../persist';
import type { NormalizedHookPayload } from '../types';
import type { AssistantTextEntry } from '../transcript';

const TEST_DB_PATH = `/tmp/spyglass-persist-detach-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`;

/** requests 본체에 payload 컬럼이 없음을 직접 확인(스키마 형태 — 063 DROP). */
function requestsHasNoPayloadColumn(db: SpyglassDatabase): boolean {
  const cols = (db.instance.query('PRAGMA table_info(requests)').all() as Array<{ name: string }>)
    .map((c) => c.name);
  return !cols.includes('payload') && !cols.includes('payload_algo');
}

/** request_payloads off-row 행을 직접 조회. payload 가 없으면 null. */
function offRow(db: SpyglassDatabase, id: string): { payload: string | null; payload_algo: string | null } | null {
  return db.instance
    .query('SELECT payload, payload_algo FROM request_payloads WHERE request_id = ?')
    .get(id) as { payload: string | null; payload_algo: string | null } | null;
}

function makeToolPayload(opts: {
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
    project_name: 'persist-detach',
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
    source: 'claude-code-hook',
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    tokens_confidence: 'high',
    tokens_source: 'transcript',
  };
}

describe('persist payload-detach (Migration 063)', () => {
  let db: SpyglassDatabase;
  let sessionId: string;
  const now = Date.now() - 60_000;

  beforeEach(() => {
    delete process.env.SPYGLASS_ENCRYPTION;
    delete process.env.SPYGLASS_ENCRYPTION_KEY;
    resetEncryptionRuntime();
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, {
      id: sessionId,
      project_name: 'persist-detach',
      started_at: now - 30_000,
    });
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    for (const ext of ['', '-wal', '-shm']) {
      try { unlinkSync(`${TEST_DB_PATH}${ext}`); } catch { /* ignore */ }
    }
    resetEncryptionRuntime();
  });

  it('mergePostToolIntoPreTool: 머지 후 payload 가 request_payloads 에 + getRequestById 복원, requests 엔 payload 컬럼 없음', () => {
    expect(requestsHasNoPayloadColumn(db)).toBe(true);

    const tuid = 'tu-merge-detach';
    const PRE_BODY = 'pre-body';
    const POST_BODY = 'post-body-merged';

    saveRequest(db.instance, makeToolPayload({
      id: 'pre-1', session_id: sessionId, event_type: 'pre_tool',
      tool_use_id: tuid, bodyText: PRE_BODY, timestamp: now,
    }));
    // pre_tool INSERT 직후 off-row 에 pre 본문이 있어야 함.
    expect(offRow(db, 'pre-1')!.payload).toContain(PRE_BODY);

    const r = saveRequest(db.instance, makeToolPayload({
      id: 'post-1', session_id: sessionId, event_type: 'tool',
      tool_use_id: tuid, bodyText: POST_BODY, timestamp: now + 1000, tokens_total: 42,
    }));
    // post 가 pre 행을 UPDATE(머지) — 새 행 생성 아님.
    expect(r.wasUpsert).toBe(true);
    expect(r.savedId).toBe('pre-1');

    // 머지 후 off-row payload 는 post 본문으로 교체(평문, algo NULL).
    const off = offRow(db, 'pre-1')!;
    expect(off.payload).toContain(POST_BODY);
    expect(off.payload).not.toContain(PRE_BODY);
    expect(off.payload_algo).toBeNull();

    // 복원 funnel(getRequestById)이 post 평문으로 복원 + 머지된 메타(토큰) 반영.
    const decoded = getRequestById(db.instance, 'pre-1')!;
    expect(JSON.parse(decoded.payload as string).body).toBe(POST_BODY);
    expect(decoded.tokens_total).toBe(42);
    expect(decoded.event_type).toBe('tool');

    // post 행은 별도로 생성되지 않음(머지) — request_payloads 에도 post-1 행 없음.
    expect(offRow(db, 'post-1')).toBeNull();
    const cnt = db.instance.query('SELECT COUNT(*) AS c FROM requests WHERE tool_use_id = ?')
      .get(tuid) as { c: number };
    expect(cnt.c).toBe(1);
  });

  it('persistAssistantTextResponses: response payload 가 request_payloads 에 기록 + 복원, 중복 INSERT OR IGNORE 시 기존 보존', () => {
    // 턴 채번을 위해 prompt 1건 적재(같은 turn 에 response 를 묶기 위함).
    saveRequest(db.instance, {
      id: 'prompt-1', session_id: sessionId, project_name: 'persist-detach',
      timestamp: now, event_type: 'prompt', request_type: 'prompt',
      tokens_input: 0, tokens_output: 0, tokens_total: 0, source: 'test',
      cache_creation_tokens: 0, cache_read_tokens: 0, payload: JSON.stringify({ prompt: 'hi' }),
    });
    const turnId = (db.instance.query(
      "SELECT turn_id FROM requests WHERE session_id = ? AND type = 'prompt' LIMIT 1",
    ).get(sessionId) as { turn_id: string }).turn_id;

    const entry: AssistantTextEntry = {
      messageId: 'msg_detach_1',
      text: '응답 본문 — assistant intermediate text 🙂',
      timestampMs: now + 500,
      model: 'claude-sonnet',
      tokensInput: 3,
      tokensOutput: 7,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };

    const inserted = persistAssistantTextResponses(db.instance, [entry], {
      sessionId, turnId, projectName: 'persist-detach',
    });
    expect(inserted).toBe(1);

    const respId = `resp-msg-${entry.messageId}`;
    // off-row 에 평문 payload(algo NULL) 기록.
    const off = offRow(db, respId)!;
    expect(off.payload_algo).toBeNull();
    expect(JSON.parse(off.payload as string).text).toBe(entry.text);
    // 복원 funnel.
    const decoded = getRequestById(db.instance, respId)!;
    expect(JSON.parse(decoded.payload as string).text).toBe(entry.text);
    expect(decoded.type).toBe('response');

    // 재호출(같은 message_id) → INSERT OR IGNORE silent skip. inserted=0, off-row payload 보존.
    const inserted2 = persistAssistantTextResponses(db.instance, [{
      ...entry, text: 'DIFFERENT-TEXT-should-not-overwrite',
    }], { sessionId, turnId, projectName: 'persist-detach' });
    expect(inserted2).toBe(0);
    // 기존 off-row payload 가 그대로 보존(덮어쓰기 없음).
    expect(JSON.parse(offRow(db, respId)!.payload as string).text).toBe(entry.text);
    // 행도 단일.
    const cnt = db.instance.query('SELECT COUNT(*) AS c FROM requests WHERE id = ?')
      .get(respId) as { c: number };
    expect(cnt.c).toBe(1);
  });
});
