/**
 * backfill 단위 테스트 (ADR-004 검증)
 *
 * @description
 *   backfillRequestFromProxy의 실제 동작을 in-memory SQLite로 검증.
 *   - affected ID 배열 반환
 *   - 단계 1·2 분리 동작 (model NULL / tokens_source='unavailable')
 *   - sessionId/model NULL 시 no-op (빈 배열)
 *   - 시간 윈도우(±5s/-30s) 밖의 행은 미적용
 *
 * 인메모리 DB로 격리 — /tmp의 shared db에 의존하지 않아 worktree 환경 무관.
 */

import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { backfillRequestFromProxy } from '../backfill';

// =============================================================================
// fixture: in-memory DB + requests 테이블만 생성 (마이그레이션 우회)
// =============================================================================

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.run(`
    CREATE TABLE requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      type TEXT NOT NULL,
      tool_name TEXT,
      tool_detail TEXT,
      turn_id TEXT,
      model TEXT,
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      tokens_total INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      payload TEXT,
      source TEXT,
      cache_creation_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      preview TEXT,
      tool_use_id TEXT,
      event_type TEXT,
      tokens_confidence TEXT DEFAULT 'high',
      tokens_source TEXT DEFAULT 'transcript',
      parent_tool_use_id TEXT,
      api_request_id TEXT
    )
  `);
  return db;
}

function insertRow(db: Database, overrides: Record<string, unknown> = {}): string {
  const id = (overrides.id as string) ?? `r-${Math.random().toString(36).slice(2, 8)}`;
  const row = {
    id,
    session_id: 'sess-1',
    timestamp: 1_000_000_000_000,
    type: 'tool_call',
    tool_name: null,
    tool_detail: null,
    turn_id: null,
    model: null,
    tokens_input: 0,
    tokens_output: 0,
    tokens_total: 0,
    duration_ms: 0,
    payload: null,
    source: null,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    preview: null,
    tool_use_id: null,
    event_type: 'tool',
    tokens_confidence: 'high',
    tokens_source: 'transcript',
    parent_tool_use_id: null,
    api_request_id: null,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO requests (
      id, session_id, timestamp, type, tool_name, tool_detail, turn_id, model,
      tokens_input, tokens_output, tokens_total, duration_ms, payload, source,
      cache_creation_tokens, cache_read_tokens, preview, tool_use_id, event_type,
      tokens_confidence, tokens_source, parent_tool_use_id, api_request_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id, row.session_id, row.timestamp, row.type, row.tool_name, row.tool_detail,
    row.turn_id, row.model, row.tokens_input, row.tokens_output, row.tokens_total,
    row.duration_ms, row.payload, row.source, row.cache_creation_tokens,
    row.cache_read_tokens, row.preview, row.tool_use_id, row.event_type,
    row.tokens_confidence, row.tokens_source, row.parent_tool_use_id, row.api_request_id,
  );
  return id;
}

function getRow(db: Database, id: string): Record<string, unknown> | null {
  return db.query('SELECT * FROM requests WHERE id = ?').get(id) as Record<string, unknown> | null;
}

const PROXY_TS = 1_000_000_000_000;
const baseParams = {
  sessionId: 'sess-1',
  model: 'claude-opus-4-7',
  apiRequestId: 'api-req-001',
  tokensInput: 100,
  tokensOutput: 200,
  cacheCreationTokens: 50,
  cacheReadTokens: 30,
  proxyStartMs: PROXY_TS,
};

// =============================================================================
// no-op (가드)
// =============================================================================

describe('backfillRequestFromProxy — guard', () => {
  test('sessionId가 null이면 빈 배열 반환 + DB 변경 없음', () => {
    const db = createTestDb();
    insertRow(db, { id: 'r-1', model: null });
    const ids = backfillRequestFromProxy(db, { ...baseParams, sessionId: null });
    expect(ids).toEqual([]);
    expect(getRow(db, 'r-1')?.model).toBeNull();
  });

  test('model이 null이면 빈 배열 반환 + DB 변경 없음', () => {
    const db = createTestDb();
    insertRow(db, { id: 'r-1', model: null });
    const ids = backfillRequestFromProxy(db, { ...baseParams, model: null });
    expect(ids).toEqual([]);
    expect(getRow(db, 'r-1')?.model).toBeNull();
  });
});

// =============================================================================
// 단계 1: model NULL → proxy.model로 채움
// =============================================================================

describe('backfillRequestFromProxy — 단계 1 (model NULL 채움)', () => {
  test('같은 session_id + 시간 윈도우 안의 model NULL 행을 채우고 ID 반환', () => {
    const db = createTestDb();
    insertRow(db, { id: 'r-1', model: null, timestamp: PROXY_TS - 1000 });
    const ids = backfillRequestFromProxy(db, baseParams);
    expect(ids).toContain('r-1');
    expect(getRow(db, 'r-1')?.model).toBe('claude-opus-4-7');
    expect(getRow(db, 'r-1')?.api_request_id).toBe('api-req-001');
  });

  test('이미 model이 있는 행은 손대지 않음', () => {
    const db = createTestDb();
    insertRow(db, { id: 'r-1', model: 'claude-haiku-4-5' });
    const ids = backfillRequestFromProxy(db, baseParams);
    expect(ids).not.toContain('r-1');
    expect(getRow(db, 'r-1')?.model).toBe('claude-haiku-4-5');
  });

  test('다른 session_id의 행은 손대지 않음', () => {
    const db = createTestDb();
    insertRow(db, { id: 'r-other', session_id: 'sess-2', model: null });
    const ids = backfillRequestFromProxy(db, baseParams);
    expect(ids).not.toContain('r-other');
    expect(getRow(db, 'r-other')?.model).toBeNull();
  });

  test('시간 윈도우 밖(>+5s)의 행은 손대지 않음', () => {
    const db = createTestDb();
    insertRow(db, { id: 'r-late', model: null, timestamp: PROXY_TS + 6000 });
    const ids = backfillRequestFromProxy(db, baseParams);
    expect(ids).not.toContain('r-late');
    expect(getRow(db, 'r-late')?.model).toBeNull();
  });

  test('시간 윈도우 밖(<-30s)의 행은 손대지 않음', () => {
    const db = createTestDb();
    insertRow(db, { id: 'r-old', model: null, timestamp: PROXY_TS - 31_000 });
    const ids = backfillRequestFromProxy(db, baseParams);
    expect(ids).not.toContain('r-old');
    expect(getRow(db, 'r-old')?.model).toBeNull();
  });

  test('api_request_id가 이미 있으면 보존(COALESCE)', () => {
    const db = createTestDb();
    insertRow(db, { id: 'r-1', model: null, api_request_id: 'preserved' });
    backfillRequestFromProxy(db, baseParams);
    expect(getRow(db, 'r-1')?.api_request_id).toBe('preserved');
  });
});

// =============================================================================
// 단계 2: tokens_source='unavailable' → proxy usage로 채움
// =============================================================================

describe('backfillRequestFromProxy — 단계 2 (tokens_source unavailable 채움)', () => {
  test('tokens_source=unavailable 행에 토큰·source·confidence 모두 갱신', () => {
    const db = createTestDb();
    insertRow(db, {
      id: 'r-1',
      model: 'claude-opus-4-7', // 단계 1 미해당
      tokens_source: 'unavailable',
      tokens_confidence: 'error',
    });
    const ids = backfillRequestFromProxy(db, baseParams);
    expect(ids).toContain('r-1');
    const row = getRow(db, 'r-1');
    expect(row?.tokens_input).toBe(100);
    expect(row?.tokens_output).toBe(200);
    expect(row?.tokens_total).toBe(300);
    expect(row?.cache_creation_tokens).toBe(50);
    expect(row?.cache_read_tokens).toBe(30);
    expect(row?.tokens_source).toBe('proxy');
    expect(row?.tokens_confidence).toBe('high');
  });

  test('tokens_source=transcript는 손대지 않음 (정상 추출 보호)', () => {
    const db = createTestDb();
    insertRow(db, {
      id: 'r-1',
      model: 'claude-opus-4-7',
      tokens_source: 'transcript',
      tokens_input: 999,
    });
    const ids = backfillRequestFromProxy(db, baseParams);
    expect(ids).not.toContain('r-1');
    expect(getRow(db, 'r-1')?.tokens_input).toBe(999);
    expect(getRow(db, 'r-1')?.tokens_source).toBe('transcript');
  });
});

// =============================================================================
// 단계 1+2 합집합
// =============================================================================

describe('backfillRequestFromProxy — affected ID 합집합', () => {
  test('단계 1·2 모두 해당하는 행은 한 번만 반환 (Set)', () => {
    const db = createTestDb();
    insertRow(db, {
      id: 'r-both',
      model: null,
      tokens_source: 'unavailable',
    });
    const ids = backfillRequestFromProxy(db, baseParams);
    expect(ids.filter((id) => id === 'r-both').length).toBe(1);
  });

  test('단계 1만 해당, 단계 2만 해당 행이 모두 affected에 포함', () => {
    const db = createTestDb();
    insertRow(db, { id: 'r-stage1', model: null, tokens_source: 'transcript' });
    insertRow(db, { id: 'r-stage2', model: 'claude-opus-4-7', tokens_source: 'unavailable' });
    const ids = backfillRequestFromProxy(db, baseParams);
    expect(ids).toContain('r-stage1');
    expect(ids).toContain('r-stage2');
    expect(ids.length).toBe(2);
  });

  test('해당 행이 없으면 빈 배열', () => {
    const db = createTestDb();
    insertRow(db, { id: 'r-clean', model: 'claude-opus-4-7', tokens_source: 'transcript' });
    const ids = backfillRequestFromProxy(db, baseParams);
    expect(ids).toEqual([]);
  });
});
