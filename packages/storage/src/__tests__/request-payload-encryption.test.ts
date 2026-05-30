/**
 * requests.payload 암호화 round-trip — 서버측 복호 + 혼재 (R3 Stage C)
 *
 * @description
 *   requests.payload는 클라이언트(web/tui)가 JSON.parse하므로 모든 read 출구가 평문 string을
 *   반환해야 한다. 쓰기(createRequest/updateRequest)·읽기(getRequestById/BySession/Turns,
 *   listVisibleSessions의 first_prompt_payload)를 ON/OFF·혼재로 고정한다.
 *
 * @see packages/storage/src/queries/request/{write,read,turn}.ts
 * @see packages/storage/src/domain/session-status.ts
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../migrator';
import { generateKey } from '../crypto';
import { resetEncryptionRuntime } from '../runtime/encryption';
import { createRequest, updateRequest } from '../queries/request/write';
import { getRequestById, getRequestsBySession } from '../queries/request/read';
import { getTurnsBySession } from '../queries/request/turn';
import { createSession } from '../queries/session/write';
import { listVisibleSessions } from '../domain/session-status';

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

const PAYLOAD = JSON.stringify({ role: 'user', content: '민감 프롬프트 본문 🙂' });

function mkReq(id: string, sessionId: string, extra: Record<string, unknown> = {}): void {
  createRequest(db, {
    id, session_id: sessionId, timestamp: Date.now(), type: 'prompt',
    payload: PAYLOAD, turn_id: 't1', ...extra,
  } as Parameters<typeof createRequest>[1]);
}

describe('requests.payload write/read', () => {
  test('OFF: 평문 저장(algo NULL) + getRequestById 복원', () => {
    mkReq('r1', 's1');
    const raw = db.query('SELECT payload, payload_algo FROM requests WHERE id = ?').get('r1') as { payload: string; payload_algo: string | null };
    expect(raw.payload_algo).toBeNull();
    expect(getRequestById(db, 'r1')!.payload).toBe(PAYLOAD);
  });

  test('ON: 암호문 저장(평문 비노출) + getRequestById 복호', () => {
    enableEncryption();
    mkReq('r2', 's2');
    const raw = db.query('SELECT payload, payload_algo FROM requests WHERE id = ?').get('r2') as { payload: string; payload_algo: string | null };
    expect(raw.payload_algo).toBe('aes256gcm');
    expect(raw.payload).not.toContain('민감');
    expect(getRequestById(db, 'r2')!.payload).toBe(PAYLOAD);
  });

  test('혼재: 평문 행 + 암호문 행 getRequestsBySession 동시 복원', () => {
    db.run(
      `INSERT INTO requests (id, session_id, timestamp, type, payload) VALUES (?, ?, ?, 'prompt', ?)`,
      ['plain', 's3', Date.now(), PAYLOAD],
    );
    enableEncryption();
    mkReq('enc', 's3', { id: 'enc' });
    const rows = getRequestsBySession(db, 's3');
    expect(rows.length).toBe(2);
    for (const r of rows) expect(r.payload).toBe(PAYLOAD);
  });

  test('updateRequest: payload 갱신 시 재암호화 + algo 동기', () => {
    enableEncryption();
    mkReq('r4', 's4');
    const NEW = JSON.stringify({ updated: true, text: '갱신된 본문' });
    updateRequest(db, 'r4', { payload: NEW });
    const raw = db.query('SELECT payload, payload_algo FROM requests WHERE id = ?').get('r4') as { payload: string; payload_algo: string | null };
    expect(raw.payload_algo).toBe('aes256gcm');
    expect(raw.payload).not.toContain('갱신');
    expect(getRequestById(db, 'r4')!.payload).toBe(NEW);
  });
});

describe('클라이언트 계약 (서버측 복호 funnel)', () => {
  test('getTurnsBySession: 암호문 prompt가 평문으로 복원되어 전달', () => {
    enableEncryption();
    createSession(db, { id: 's5', project_name: 'p', started_at: Date.now() });
    mkReq('r5', 's5');
    const turns = getTurnsBySession(db, 's5');
    const blob = JSON.stringify(turns);
    expect(blob).toContain('민감 프롬프트 본문'); // 평문 복원됨
    expect(blob).not.toContain('aes256gcm');      // 암호 marker/ciphertext 미노출
  });

  test('listVisibleSessions: first_prompt_payload 평문 복원 + 내부 algo marker 비노출', () => {
    enableEncryption();
    createSession(db, { id: 's6', project_name: 'p', started_at: Date.now() });
    mkReq('r6', 's6');
    const sessions = listVisibleSessions(db, 100, {}, Date.now());
    const s6 = sessions.find((s) => s.id === 's6')!;
    expect(s6.first_prompt_payload).toBe(PAYLOAD);
    expect((s6 as unknown as Record<string, unknown>).first_prompt_payload_algo).toBeUndefined();
  });
});
