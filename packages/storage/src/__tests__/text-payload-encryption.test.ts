/**
 * TEXT 컬럼 암호화 round-trip — claude_events.payload / system_prompts.content (R3 Stage B)
 *
 * @description
 *   실제 storage 함수(createEvent/getEvents*, upsertSystemPrompt/getSystemPromptByHash)를
 *   SPYGLASS_ENCRYPTION ON/OFF + 평문/암호문 혼재로 검증한다. 디코드 누락 시 평문이 깨지므로
 *   본 round-trip이 회귀 가드.
 *
 * @see packages/storage/src/queries/{event,system-prompt}.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { generateKey } from '../crypto';
import { resetEncryptionRuntime } from '../runtime/encryption';
import { createEvent, getEventsBySession } from '../queries/event';
import { upsertSystemPrompt, getSystemPromptByHash } from '../queries/system-prompt';

let db: Database;

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

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  disableEncryption();
});
afterEach(() => {
  db.close();
  disableEncryption();
});

const PAYLOAD = JSON.stringify({ tool: 'Bash', input: '민감 명령 🙂' });

describe('claude_events.payload', () => {
  test('OFF: 평문 저장(algo NULL) + round-trip', () => {
    createEvent(db, { event_id: 'e1', event_type: 'PreToolUse', session_id: 's1', timestamp: 1, payload: PAYLOAD });
    const raw = db.query('SELECT payload, payload_algo FROM claude_events WHERE event_id = ?').get('e1') as { payload: string; payload_algo: string | null };
    expect(raw.payload_algo).toBeNull();
    expect(raw.payload).toBe(PAYLOAD);
    expect(getEventsBySession(db, 's1')[0].payload).toBe(PAYLOAD);
  });

  test('ON: 암호문 저장(평문 비노출) + 읽기 시 복호', () => {
    enableEncryption();
    createEvent(db, { event_id: 'e2', event_type: 'PreToolUse', session_id: 's2', timestamp: 1, payload: PAYLOAD });
    const raw = db.query('SELECT payload, payload_algo FROM claude_events WHERE event_id = ?').get('e2') as { payload: string; payload_algo: string | null };
    expect(raw.payload_algo).toBe('aes256gcm');
    expect(raw.payload).not.toContain('민감');
    expect(getEventsBySession(db, 's2')[0].payload).toBe(PAYLOAD);
  });

  test('혼재: 평문 행 + 암호문 행 동시 조회 — 둘 다 복원', () => {
    // 평문 행 직접 INSERT(algo NULL)
    db.run(
      `INSERT INTO claude_events (event_id, event_type, session_id, timestamp, payload) VALUES (?, ?, ?, ?, ?)`,
      ['plain', 'Stop', 's3', 1, PAYLOAD],
    );
    // 암호문 행 createEvent(ON)
    enableEncryption();
    createEvent(db, { event_id: 'enc', event_type: 'Stop', session_id: 's3', timestamp: 2, payload: PAYLOAD });
    const rows = getEventsBySession(db, 's3');
    expect(rows.length).toBe(2);
    for (const r of rows) expect(r.payload).toBe(PAYLOAD); // 키가 로드돼 둘 다 복원
  });
});

describe('system_prompts.content', () => {
  const CONTENT = 'You are a helpful assistant. 민감 시스템 프롬프트.';

  test('OFF: 평문 저장 + lazy-fetch round-trip', () => {
    upsertSystemPrompt(db, { hash: 'h1', content: CONTENT, byteSize: 50, segmentCount: 1, nowMs: 1 });
    const raw = db.query('SELECT content, content_algo FROM system_prompts WHERE hash = ?').get('h1') as { content: string; content_algo: string | null };
    expect(raw.content_algo).toBeNull();
    expect(getSystemPromptByHash(db, 'h1')!.content).toBe(CONTENT);
  });

  test('ON: 암호문 저장(평문 비노출, hash·byte_size 평문 기준) + 복호', () => {
    enableEncryption();
    upsertSystemPrompt(db, { hash: 'h2', content: CONTENT, byteSize: 50, segmentCount: 1, nowMs: 1 });
    const raw = db.query('SELECT content, content_algo, byte_size FROM system_prompts WHERE hash = ?').get('h2') as { content: string; content_algo: string | null; byte_size: number };
    expect(raw.content_algo).toBe('aes256gcm');
    expect(raw.content).not.toContain('민감');
    expect(raw.byte_size).toBe(50); // 평문 기준 유지
    expect(getSystemPromptByHash(db, 'h2')!.content).toBe(CONTENT);
  });

  test('dedup: 같은 hash 재UPSERT 시 ref_count 증가(평문 기준 dedup 보존)', () => {
    enableEncryption();
    upsertSystemPrompt(db, { hash: 'h3', content: CONTENT, byteSize: 50, segmentCount: 1, nowMs: 1 });
    upsertSystemPrompt(db, { hash: 'h3', content: CONTENT, byteSize: 50, segmentCount: 1, nowMs: 2 });
    const row = db.query('SELECT ref_count FROM system_prompts WHERE hash = ?').get('h3') as { ref_count: number };
    expect(row.ref_count).toBe(2);
    expect(getSystemPromptByHash(db, 'h3')!.content).toBe(CONTENT);
  });
});
