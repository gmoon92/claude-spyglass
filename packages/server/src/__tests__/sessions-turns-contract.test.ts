/**
 * R-T — GET /api/sessions/:id/turns 의 인메모리 join + orphan/implicit 정책 무결성.
 *
 * 검증 범위:
 *  - 정상 turn 의 prompt + tool_calls + responses 가 한 turn item 으로 결합되는가
 *  - orphan(turn_id NULL) 행이 첫 turn 의 tool_calls / responses 에 흡수되는가
 *  - prompt 0건 + orphan 존재 시 implicit turn (meta.implicit_turn=true) 합성되는가
 *  - 빈 세션은 빈 배열 응답
 *
 * 본 테스트는 흐름 차트 / persist / SSoT 변경이 이 응답을 깨면 즉시 빨강.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import {
  SpyglassDatabase,
  createSession,
  createRequest,
} from '@spyglass/storage';
import { apiRouter } from '../api';

const SUFFIX = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const TEST_DB_PATH = `/tmp/spyglass-turns-${SUFFIX}.db`;
let db: SpyglassDatabase;

const NOW = Date.now() - 60_000;

// 4개 세션을 시드해 각 시나리오 독립 검증.
const SESSION_NORMAL   = crypto.randomUUID();   // prompt + tool_call + response (normal turn)
const SESSION_ORPHAN   = crypto.randomUUID();   // 정상 turn + orphan 행 (turn_id NULL)
const SESSION_IMPLICIT = crypto.randomUUID();   // prompt 0건, orphan 만
const SESSION_EMPTY    = crypto.randomUUID();   // 행 0개

beforeAll(() => {
  db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });

  for (const sid of [SESSION_NORMAL, SESSION_ORPHAN, SESSION_IMPLICIT, SESSION_EMPTY]) {
    createSession(db.instance, {
      id: sid, project_name: 'turns-test', started_at: NOW - 30_000,
    });
  }

  // SESSION_NORMAL — prompt + tool_call + response 가 하나의 turn 으로 결합.
  createRequest(db.instance, {
    id: 'n-prompt', session_id: SESSION_NORMAL, timestamp: NOW,
    type: 'prompt', turn_id: 'T1',
    tokens_input: 10, tokens_output: 0, tokens_total: 10,
    preview: 'hello',
  });
  createRequest(db.instance, {
    id: 'n-tool', session_id: SESSION_NORMAL, timestamp: NOW + 1000,
    type: 'tool_call', tool_name: 'Bash', tool_detail: 'ls',
    turn_id: 'T1', tool_use_id: 'n-tu', event_type: 'tool',
    tokens_input: 0, tokens_output: 0, tokens_total: 0,
  });
  createRequest(db.instance, {
    id: 'n-response', session_id: SESSION_NORMAL, timestamp: NOW + 2000,
    type: 'response', turn_id: 'T1',
    tokens_input: 0, tokens_output: 50, tokens_total: 50,
  });

  // SESSION_ORPHAN — prompt + 정상 tool_call + orphan tool_call (turn_id NULL).
  createRequest(db.instance, {
    id: 'o-prompt', session_id: SESSION_ORPHAN, timestamp: NOW,
    type: 'prompt', turn_id: 'T1',
    tokens_input: 5, tokens_output: 0, tokens_total: 5,
  });
  createRequest(db.instance, {
    id: 'o-tool-in-turn', session_id: SESSION_ORPHAN, timestamp: NOW + 500,
    type: 'tool_call', tool_name: 'Read', tool_detail: 'file.txt',
    turn_id: 'T1', tool_use_id: 'o-tu1', event_type: 'tool',
    tokens_input: 0, tokens_output: 0, tokens_total: 0,
  });
  createRequest(db.instance, {
    id: 'o-tool-orphan', session_id: SESSION_ORPHAN, timestamp: NOW + 1500,
    type: 'tool_call', tool_name: 'Bash', tool_detail: 'pwd',
    turn_id: undefined,  // orphan
    tool_use_id: 'o-tu2', event_type: 'tool',
    tokens_input: 0, tokens_output: 0, tokens_total: 0,
  });

  // SESSION_IMPLICIT — orphan 행만, prompt 없음.
  createRequest(db.instance, {
    id: 'i-orphan-tool', session_id: SESSION_IMPLICIT, timestamp: NOW,
    type: 'tool_call', tool_name: 'Bash', tool_detail: 'echo',
    turn_id: undefined,
    tool_use_id: 'i-tu', event_type: 'tool',
    tokens_input: 0, tokens_output: 0, tokens_total: 0,
  });
});

afterAll(() => {
  try { db.close(); } catch {}
  try { require('fs').unlinkSync(TEST_DB_PATH); } catch {}
});

interface TurnsResponse {
  success: boolean;
  data: Array<{
    turn_id: string;
    turn_index: number;
    prompt: { id: string; preview: string | null } | null;
    tool_calls: Array<{ id: string; tool_name: string }>;
    responses: Array<{ id: string }>;
    summary: { tool_call_count: number; total_tokens: number };
  }>;
  prologue?: unknown[];
  meta?: { total: number; implicit_turn?: boolean };
}

describe('GET /api/sessions/:id/turns — R-T 6단계 join 무결성', () => {
  it('정상 turn — prompt + tool_call + response 가 한 turn 안에 결합', async () => {
    const res = await apiRouter(
      new Request(`http://x/api/sessions/${SESSION_NORMAL}/turns`),
      db.instance,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as TurnsResponse;
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);

    const turn = body.data[0];
    expect(turn.turn_id).toBe('T1');
    expect(turn.prompt).not.toBeNull();
    expect(turn.prompt!.id).toBe('n-prompt');
    expect(turn.prompt!.preview).toBe('hello');
    expect(turn.tool_calls).toHaveLength(1);
    expect(turn.tool_calls[0].id).toBe('n-tool');
    expect(turn.tool_calls[0].tool_name).toBe('Bash');
    expect(turn.responses).toHaveLength(1);
    expect(turn.responses[0].id).toBe('n-response');
    expect(turn.summary.tool_call_count).toBe(1);
  });

  it('orphan 행이 첫 turn 의 tool_calls 에 흡수', async () => {
    const res = await apiRouter(
      new Request(`http://x/api/sessions/${SESSION_ORPHAN}/turns`),
      db.instance,
    );
    const body = await res.json() as TurnsResponse;
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);

    const turn = body.data[0];
    expect(turn.turn_id).toBe('T1');
    // 정상 tool + orphan tool 둘 다 첫 turn 에 모임.
    const toolIds = new Set(turn.tool_calls.map(t => t.id));
    expect(toolIds.has('o-tool-in-turn')).toBe(true);
    expect(toolIds.has('o-tool-orphan')).toBe(true);
    expect(turn.tool_calls.length).toBe(2);
    // implicit_turn 플래그 없음 (정상 prompt 있으므로).
    expect(body.meta?.implicit_turn).toBeUndefined();
  });

  it('prompt 0건 + orphan 만 — implicit turn 합성', async () => {
    const res = await apiRouter(
      new Request(`http://x/api/sessions/${SESSION_IMPLICIT}/turns`),
      db.instance,
    );
    const body = await res.json() as TurnsResponse;
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.meta?.implicit_turn).toBe(true);

    const turn = body.data[0];
    // implicit turn 은 합성된 prompt(id='implicit-<sid>-prompt') 를 갖는다.
    expect(turn.prompt).not.toBeNull();
    expect(turn.prompt!.id.startsWith('implicit-')).toBe(true);
    expect(turn.tool_calls.length).toBe(1);
    expect(turn.tool_calls[0].id).toBe('i-orphan-tool');
  });

  it('빈 세션 — turns=[] 반환', async () => {
    const res = await apiRouter(
      new Request(`http://x/api/sessions/${SESSION_EMPTY}/turns`),
      db.instance,
    );
    const body = await res.json() as TurnsResponse;
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(0);
  });

  it('summary.tool_call_count 가 tool_calls.length 와 일치 (집계 일관성)', async () => {
    // 흐름 차트 / persist 변경이 인메모리 1-pass 집계를 깨면 mismatch 발생.
    for (const sid of [SESSION_NORMAL, SESSION_ORPHAN]) {
      const res = await apiRouter(
        new Request(`http://x/api/sessions/${sid}/turns`),
        db.instance,
      );
      const body = await res.json() as TurnsResponse;
      for (const turn of body.data) {
        expect(turn.summary.tool_call_count).toBe(turn.tool_calls.length);
      }
    }
  });
});
