/**
 * storage-payload-detach (Migration 061/063) — off-row payload 분리의 read 경로 end-to-end 회귀.
 *
 * @description
 *   063 에서 requests.payload/payload_algo 컬럼이 DROP 되고 request_payloads(off-row)가 단일
 *   소스가 됐다. 본 테스트는 "payload 가 필요한 read 출구"가 모두 request_payloads LEFT JOIN 으로
 *   평문을 복원하는지, 그리고 "전송 최적화 경로(피드)"는 의도적으로 payload 를 싣지 않는지
 *   계약으로 고정한다. 암호화 round-trip 은 request-payload-encryption.test.ts 가 별도 커버하므로
 *   여기선 평문(algo NULL) 경로 + 스키마 형태 + retention cascade 에 집중한다.
 *
 * @see packages/storage/migrations/061-request-payloads-table.sql
 * @see packages/storage/migrations/063-requests-drop-payload-column.sql
 * @see packages/storage/src/queries/request/{write,read,turn}.ts
 * @see packages/storage/src/domain/session-status.ts
 * @see packages/storage/src/queries/session/retention.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { resetEncryptionRuntime } from '../runtime/encryption';
import { createRequest } from '../queries/request/write';
import {
  getRequestById,
  getRequestsBySession,
  getAllRequests,
  getChildRequestsByParentToolUseId,
} from '../queries/request/read';
import { getTurnsBySession, getOrphanRowsBySession } from '../queries/request/turn';
import { createSession } from '../queries/session/write';
import { deleteOldData } from '../queries/session/retention';
import { listVisibleSessions } from '../domain/session-status';

let db: Database;

beforeEach(() => {
  // 암호화 OFF 고정 — 본 테스트는 detach(저장 위치) 계약을 검증한다(암호화는 별도 스위트).
  delete process.env.SPYGLASS_ENCRYPTION;
  delete process.env.SPYGLASS_ENCRYPTION_KEY;
  resetEncryptionRuntime();
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => {
  db.close();
  resetEncryptionRuntime();
});

// ─────────────────────────────────────────────────────────────────────────────
// 스키마 형태 — 063 가 실제로 컬럼을 DROP 했고 request_payloads 가 존재하는지.
// ─────────────────────────────────────────────────────────────────────────────
describe('스키마 형태 (Migration 063)', () => {
  test('requests 에 payload/payload_algo 컬럼이 없음 + request_payloads 존재', () => {
    const reqCols = (db.query("PRAGMA table_info(requests)").all() as Array<{ name: string }>)
      .map((c) => c.name);
    expect(reqCols).not.toContain('payload');
    expect(reqCols).not.toContain('payload_algo');
    // preview/preview_algo 는 분리 대상이 아니라 requests 에 유지(피드 미리보기 직접 사용).
    expect(reqCols).toContain('preview');
    expect(reqCols).toContain('preview_algo');

    const payloadCols = (db.query("PRAGMA table_info(request_payloads)").all() as Array<{ name: string; pk: number }>);
    const names = payloadCols.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['request_id', 'payload', 'payload_algo']));
    // request_id 가 PK.
    expect(payloadCols.find((c) => c.name === 'request_id')!.pk).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// write(createRequest) → read 출구별 평문 복원 (LEFT JOIN request_payloads).
// ─────────────────────────────────────────────────────────────────────────────
describe('createRequest → payload 복원(JOIN)', () => {
  const PROMPT_PAYLOAD = JSON.stringify({ role: 'user', content: '프롬프트 본문 🙂' });
  const TOOL_PAYLOAD = JSON.stringify({ tool_use_id: 'tu-1', command: 'ls -la' });
  const RESP_PAYLOAD = JSON.stringify({ role: 'assistant', content: '응답 본문' });

  function seedTurn(sessionId: string): void {
    createSession(db, { id: sessionId, project_name: 'detach', started_at: Date.now() - 10_000 });
    createRequest(db, {
      id: 'p1', session_id: sessionId, timestamp: Date.now() - 3000, type: 'prompt',
      turn_id: 't1', payload: PROMPT_PAYLOAD, preview: 'prompt-preview',
    });
    createRequest(db, {
      id: 'tc1', session_id: sessionId, timestamp: Date.now() - 2000, type: 'tool_call',
      turn_id: 't1', tool_name: 'Bash', tool_detail: 'ls -la', tool_use_id: 'tu-1',
      event_type: 'tool', payload: TOOL_PAYLOAD,
    });
    createRequest(db, {
      id: 'rs1', session_id: sessionId, timestamp: Date.now() - 1000, type: 'response',
      turn_id: 't1', payload: RESP_PAYLOAD, preview: 'resp-preview',
    });
  }

  test('createRequest 는 request_payloads 에만 기록(single-write) — requests 행엔 payload 없음', () => {
    createSession(db, { id: 's1', project_name: 'detach', started_at: Date.now() });
    createRequest(db, {
      id: 'r1', session_id: 's1', timestamp: Date.now(), type: 'prompt',
      turn_id: 't1', payload: PROMPT_PAYLOAD,
    });
    // off-row 에 평문 + algo NULL.
    const off = db.query('SELECT payload, payload_algo FROM request_payloads WHERE request_id = ?')
      .get('r1') as { payload: string; payload_algo: string | null };
    expect(off.payload).toBe(PROMPT_PAYLOAD);
    expect(off.payload_algo).toBeNull();
  });

  test('getRequestById 가 평문 payload 복원(JOIN)', () => {
    seedTurn('s1');
    expect(getRequestById(db, 'p1')!.payload).toBe(PROMPT_PAYLOAD);
    expect(getRequestById(db, 'tc1')!.payload).toBe(TOOL_PAYLOAD);
  });

  test('getRequestsBySession 이 payload 복원(JOIN)', () => {
    seedTurn('s1');
    const rows = getRequestsBySession(db, 's1');
    const byId = new Map(rows.map((r) => [r.id, r.payload]));
    expect(byId.get('p1')).toBe(PROMPT_PAYLOAD);
    expect(byId.get('tc1')).toBe(TOOL_PAYLOAD);
    expect(byId.get('rs1')).toBe(RESP_PAYLOAD);
  });

  test('getTurnsBySession: prompt/tool_call/response 행의 payload 가 request_payloads 에서 복원', () => {
    seedTurn('s1');
    const turns = getTurnsBySession(db, 's1');
    expect(turns.length).toBe(1);
    const t = turns[0];
    expect(t.prompt!.payload).toBe(PROMPT_PAYLOAD);
    expect(t.tool_calls.find((c) => c.id === 'tc1')!.payload).toBe(TOOL_PAYLOAD);
    expect(t.responses.find((r) => r.id === 'rs1')!.payload).toBe(RESP_PAYLOAD);
  });

  test('getOrphanRowsBySession(turn_id IS NULL): payload 복원', () => {
    createSession(db, { id: 's2', project_name: 'detach', started_at: Date.now() });
    // turn_id 미지정 → orphan(프롤로그) 행.
    createRequest(db, {
      id: 'orphan1', session_id: 's2', timestamp: Date.now(), type: 'tool_call',
      tool_name: 'Read', tool_detail: '/x', tool_use_id: 'tu-orphan', event_type: 'tool',
      payload: TOOL_PAYLOAD,
    });
    const orphans = getOrphanRowsBySession(db, 's2');
    expect(orphans.length).toBe(1);
    expect(orphans[0].turn_id).toBeNull();
    expect(orphans[0].payload).toBe(TOOL_PAYLOAD);
  });

  test('getChildRequestsByParentToolUseId: 자식 행 payload 복원', () => {
    createSession(db, { id: 's3', project_name: 'detach', started_at: Date.now() });
    const CHILD_PAYLOAD = JSON.stringify({ tool_use_id: 'child-1', from: 'sub-transcript' });
    createRequest(db, {
      id: 'child1', session_id: 's3', timestamp: Date.now(), type: 'tool_call',
      tool_name: 'Bash', tool_detail: 'ls', tool_use_id: 'child-1', event_type: 'tool',
      parent_tool_use_id: 'parent-agent', payload: CHILD_PAYLOAD,
    });
    const children = getChildRequestsByParentToolUseId(db, 'parent-agent');
    expect(children.length).toBe(1);
    expect(children[0].payload).toBe(CHILD_PAYLOAD);
  });

  test('listVisibleSessions: first_prompt_payload 가 request_payloads JOIN 으로 복원', () => {
    seedTurn('s1');
    const sessions = listVisibleSessions(db, 100, {}, Date.now());
    const s1 = sessions.find((s) => s.id === 's1')!;
    // 첫 prompt(p1) 의 payload 가 복원돼야 함.
    expect(s1.first_prompt_payload).toBe(PROMPT_PAYLOAD);
    // 내부 algo marker 는 응답에 비노출.
    expect((s1 as unknown as Record<string, unknown>).first_prompt_payload_algo).toBeUndefined();
  });

  test('피드 getAllRequests: payload 미포함(JOIN 안 함) — 전송 최적화 계약 고정', () => {
    seedTurn('s1');
    const feed = getAllRequests(db, 100);
    expect(feed.length).toBeGreaterThan(0);
    // 피드는 payload JOIN 을 의도적으로 생략한다(전송 최적화). payload 컬럼 자체가 없으므로 undefined.
    for (const r of feed) {
      expect(r.payload).toBeUndefined();
    }
    // 그러나 preview/tool_detail fallback 은 살아있어야 피드 미리보기 회귀가 없다.
    const tc = feed.find((r) => r.id === 'tc1')!;
    expect(tc.tool_detail).toBe('ls -la');
    const p = feed.find((r) => r.id === 'p1')!;
    expect(p.preview).toBe('prompt-preview');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// retention — requests 삭제 시 request_payloads 도 동반 정리(cascade SSoT).
// ─────────────────────────────────────────────────────────────────────────────
describe('retention deleteOldData', () => {
  test('cutoff 이전 requests 삭제 시 request_payloads 도 정리됨', () => {
    const old = Date.now() - 1000 * 60 * 60 * 24 * 40; // 40일 전
    const recent = Date.now();
    createSession(db, { id: 'sOld', project_name: 'detach', started_at: old - 10_000 });
    createSession(db, { id: 'sNew', project_name: 'detach', started_at: recent - 10_000 });
    createRequest(db, {
      id: 'oldReq', session_id: 'sOld', timestamp: old, type: 'prompt',
      turn_id: 't-old', payload: JSON.stringify({ keep: false }),
    });
    createRequest(db, {
      id: 'newReq', session_id: 'sNew', timestamp: recent, type: 'prompt',
      turn_id: 't-new', payload: JSON.stringify({ keep: true }),
    });
    // 사전 조건: 둘 다 off-row payload 보유.
    expect(db.query('SELECT COUNT(*) AS c FROM request_payloads').get() as { c: number }).toEqual({ c: 2 });

    deleteOldData(db, Date.now() - 1000 * 60 * 60 * 24 * 30); // 30일 cutoff

    // 오래된 request 와 그 off-row payload 가 함께 사라지고, 최신 것은 보존.
    expect(db.query('SELECT COUNT(*) AS c FROM requests').get() as { c: number }).toEqual({ c: 1 });
    const remaining = db.query('SELECT request_id FROM request_payloads').all() as Array<{ request_id: string }>;
    expect(remaining).toEqual([{ request_id: 'newReq' }]);
  });
});
