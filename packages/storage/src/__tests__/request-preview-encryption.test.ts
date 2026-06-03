/**
 * requests.preview 암호화 round-trip — 서버측 복호 + 혼재 (R3 확장, ⓝ1)
 *
 * @description
 *   requests.preview는 UI 미리보기로 직렬화되므로 모든 read 출구가 평문 string을 반환해야 한다.
 *   쓰기(createRequest)·읽기(getRequestById/BySession/Turns)를 ON/OFF·혼재로 고정한다.
 *   payload와 preview는 독립 algo 마커(preview_algo)를 가진다 — payload만 갱신해도 preview는 영향 없음.
 *
 * @see packages/storage/src/queries/request/{write,read,turn}.ts
 * @see packages/storage/migrations/057-preview-encryption.sql
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

const PREVIEW = '민감한 사용자 입력 미리보기 🙂 secret-token-abc';
const PAYLOAD = JSON.stringify({ role: 'user', content: PREVIEW });

function mkReq(id: string, sessionId: string, extra: Record<string, unknown> = {}): void {
  createRequest(db, {
    id, session_id: sessionId, timestamp: Date.now(), type: 'prompt',
    preview: PREVIEW, payload: PAYLOAD, turn_id: 't1', ...extra,
  } as Parameters<typeof createRequest>[1]);
}

describe('requests.preview write/read (ⓝ1)', () => {
  test('OFF: 평문 저장(preview_algo NULL) + getRequestById 복원', () => {
    mkReq('r1', 's1');
    const raw = db.query('SELECT preview, preview_algo FROM requests WHERE id = ?')
      .get('r1') as { preview: string; preview_algo: string | null };
    expect(raw.preview_algo).toBeNull();
    expect(raw.preview).toBe(PREVIEW);
    expect(getRequestById(db, 'r1')!.preview).toBe(PREVIEW);
  });

  test('ON: 암호문 저장(평문 비노출, algo 마커) + getRequestById 복호', () => {
    enableEncryption();
    mkReq('r2', 's2');
    const raw = db.query('SELECT preview, preview_algo FROM requests WHERE id = ?')
      .get('r2') as { preview: string; preview_algo: string | null };
    expect(raw.preview_algo).toBe('aes256gcm');
    expect(raw.preview).not.toContain('민감');
    expect(raw.preview).not.toContain('secret-token');
    expect(getRequestById(db, 'r2')!.preview).toBe(PREVIEW);
  });

  test('혼재: 평문 행 + 암호문 행 getRequestsBySession 동시 복원', () => {
    db.run(
      `INSERT INTO requests (id, session_id, timestamp, type, preview) VALUES (?, ?, ?, 'prompt', ?)`,
      ['plain', 's3', Date.now(), PREVIEW],
    );
    enableEncryption();
    mkReq('enc', 's3', { id: 'enc' });
    const rows = getRequestsBySession(db, 's3');
    expect(rows.length).toBe(2);
    for (const r of rows) expect(r.preview).toBe(PREVIEW);
  });

  test('독립 algo: payload만 updateRequest해도 preview는 평문 복원 유지', () => {
    enableEncryption();
    mkReq('r4', 's4');
    // payload만 갱신(preview·preview_algo 미변경) — 공유 컬럼이었다면 corruption 발생할 시나리오
    updateRequest(db, 'r4', { payload: JSON.stringify({ updated: true }) });
    const raw = db.query('SELECT preview, preview_algo, payload_algo FROM requests WHERE id = ?')
      .get('r4') as { preview: string; preview_algo: string | null; payload_algo: string | null };
    expect(raw.preview_algo).toBe('aes256gcm');
    expect(raw.payload_algo).toBe('aes256gcm');
    expect(getRequestById(db, 'r4')!.preview).toBe(PREVIEW);
  });

  test('preview 없는 행(payload만 존재): preview_algo NULL, payload는 정상', () => {
    enableEncryption();
    createRequest(db, {
      id: 'r5', session_id: 's5', timestamp: Date.now(), type: 'tool_call',
      payload: PAYLOAD, turn_id: 't1',
    } as Parameters<typeof createRequest>[1]);
    const raw = db.query('SELECT preview, preview_algo, payload_algo FROM requests WHERE id = ?')
      .get('r5') as { preview: string | null; preview_algo: string | null; payload_algo: string | null };
    expect(raw.preview).toBeNull();
    expect(raw.preview_algo).toBeNull();
    expect(raw.payload_algo).toBe('aes256gcm');
    expect(getRequestById(db, 'r5')!.payload).toBe(PAYLOAD);
  });
});

describe('클라이언트 계약 — turn 렌더 (서버측 복호 funnel)', () => {
  test('getTurnsBySession: 암호문 prompt/response preview가 평문으로 복원되어 전달', () => {
    enableEncryption();
    createSession(db, { id: 's6', project_name: 'p', started_at: Date.now() });
    mkReq('r6', 's6', { turn_id: 'turnA' });
    createRequest(db, {
      id: 'resp6', session_id: 's6', timestamp: Date.now() + 10, type: 'response',
      preview: PREVIEW, turn_id: 'turnA',
    } as Parameters<typeof createRequest>[1]);
    const turns = getTurnsBySession(db, 's6');
    const blob = JSON.stringify(turns);
    expect(blob).toContain('민감한 사용자 입력'); // 평문 복원됨
    expect(blob).not.toContain('aes256gcm');       // 암호 marker/ciphertext 미노출
  });
});
