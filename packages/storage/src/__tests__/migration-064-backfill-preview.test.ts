/**
 * Migration 064 — Skill/Agent 과거 행 preview 백필 검증.
 *
 * preview.ts §extractPreview 는 신규 수집부터만 preview 를 채우므로, 과거 Skill/Agent 행은
 * preview=NULL 이다. 064 가 request_payloads.tool_input 에서 extractPreview 와 동일 우선순위로
 * 백필하는지 + 멱등성 + tool_detail 불변을 고정한다.
 *
 * @see packages/storage/migrations/064-backfill-skill-agent-preview.sql
 * @see packages/server/src/hook/preview.ts (동일 우선순위)
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runMigrations } from '../migrator';
import { resetEncryptionRuntime } from '../runtime/encryption';
import { createRequest } from '../queries/request/write';
import { getRequestById } from '../queries/request/read';
import { createSession } from '../queries/session/write';

let db: Database;
const MIG_064 = readFileSync(
  join(import.meta.dir, '..', '..', 'migrations', '064-backfill-skill-agent-preview.sql'),
  'utf8',
);

beforeEach(() => {
  delete process.env.SPYGLASS_ENCRYPTION;
  delete process.env.SPYGLASS_ENCRYPTION_KEY;
  resetEncryptionRuntime();
  db = new Database(':memory:');
  runMigrations(db); // 064 포함 전체 적용(빈 DB라 백필 대상 없음)
  createSession(db, { id: 's1', project_name: 'p', started_at: Date.now() });
});
afterEach(() => {
  db.close();
  resetEncryptionRuntime();
});

/** 과거 행 시뮬레이션 — preview 없이 + payload 만 보유한 tool_call 행. */
function seedPastRow(id: string, toolName: string, toolDetail: string, toolInput: object): void {
  createRequest(db, {
    id, session_id: 's1', timestamp: Date.now(), type: 'tool_call',
    turn_id: 't1', tool_name: toolName, tool_detail: toolDetail, tool_use_id: id,
    event_type: 'tool',
    payload: JSON.stringify({ tool_input: toolInput }),
    // preview 미지정 → NULL (과거 데이터 상태)
  });
}

describe('Migration 064 — preview 백필', () => {
  test('Skill: args 로 백필 (없으면 skill 이름)', () => {
    seedPastRow('sk1', 'Skill', 'commit', { skill: 'commit', args: '변경사항 전체 커밋' });
    seedPastRow('sk2', 'Skill', 'explorer', { skill: 'explorer' }); // args 없음
    expect(getRequestById(db, 'sk1')!.preview ?? null).toBeNull(); // 백필 전 NULL

    db.exec(MIG_064);

    expect(getRequestById(db, 'sk1')!.preview).toBe('변경사항 전체 커밋');
    expect(getRequestById(db, 'sk2')!.preview).toBe('explorer');
    // tool_detail(식별자)은 불변
    expect(getRequestById(db, 'sk1')!.tool_detail).toBe('commit');
  });

  test('Agent: description 으로 백필 (없으면 prompt → subagent_type)', () => {
    seedPastRow('ag1', 'Agent', 'Explore', { subagent_type: 'Explore', description: '동시성 패턴 탐색', prompt: '긴 프롬프트' });
    seedPastRow('ag2', 'Agent', 'Explore', { subagent_type: 'Explore', prompt: '프롬프트만' });
    seedPastRow('ag3', 'Agent', 'Explore', { subagent_type: 'Explore' });

    db.exec(MIG_064);

    expect(getRequestById(db, 'ag1')!.preview).toBe('동시성 패턴 탐색');
    expect(getRequestById(db, 'ag2')!.preview).toBe('프롬프트만');
    expect(getRequestById(db, 'ag3')!.preview).toBe('Explore');
  });

  test('이미 preview 가 있는 행은 건드리지 않음 + 멱등', () => {
    createRequest(db, {
      id: 'sk3', session_id: 's1', timestamp: Date.now(), type: 'tool_call',
      turn_id: 't1', tool_name: 'Skill', tool_detail: 'commit', tool_use_id: 'sk3',
      event_type: 'tool', preview: '기존 preview',
      payload: JSON.stringify({ tool_input: { skill: 'commit', args: '새 args' } }),
    });

    db.exec(MIG_064);
    expect(getRequestById(db, 'sk3')!.preview).toBe('기존 preview'); // 보존

    seedPastRow('sk4', 'Skill', 'commit', { skill: 'commit', args: 'AAA' });
    db.exec(MIG_064); // 1회차
    db.exec(MIG_064); // 2회차(멱등)
    expect(getRequestById(db, 'sk4')!.preview).toBe('AAA');
  });

  test('Skill/Agent 외 도구(Bash)는 백필 대상 아님', () => {
    seedPastRow('b1', 'Bash', 'ls -la', { command: 'ls -la' });
    db.exec(MIG_064);
    expect(getRequestById(db, 'b1')!.preview ?? null).toBeNull();
  });
});
