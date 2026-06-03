/**
 * T4 — PreToolUse payload 직렬화 + read-back 정합성 특성화 (현재 동작 고정).
 *
 * 검증 목적:
 *   PreToolUseHandler 는 raw ClaudeHookPayload 전체를 `JSON.stringify(raw)` 로 payload 컬럼에
 *   저장한다(pre-tool-use.handler.ts L75). getRequestById 로 read-back 했을 때:
 *     - payload 가 JSON.parse 가능하고
 *     - tool_use_id / tool_name / tool_input(중첩 객체·유니코드 포함) 이 손실 없이 복원되며
 *     - 암호화 OFF 시 평문 그대로, payload_algo NULL.
 *   또한 extractToolUseId 가 이 payload 에서 tool_use_id 를 정확히 뽑아 pre 행에 컬럼으로도
 *   기록됨을 확인한다(Upsert 매칭 키 SSoT).
 *
 * 격리: 고유 임시 DB + afterEach 본체/-wal/-shm 삭제 + closeDatabase(). 암호화 OFF 고정.
 *       SSE: pre_tool 은 broadcast 제외 정책이라 connections 미영향.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { unlinkSync } from 'fs';
import { SpyglassDatabase, closeDatabase, getRequestById } from '@spyglass/storage';
import { handleHookHttpRequest } from '../http-entry';
import type { HookProcessResult } from '../types';

const TEST_DB_PATH = `/tmp/spyglass-pre-payload-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`;

function sendPre(db: SpyglassDatabase, raw: Record<string, unknown>): Promise<HookProcessResult> {
  const req = new Request('http://localhost/collect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hook_event_name: 'PreToolUse', ...raw }),
  });
  return handleHookHttpRequest(req, db).then((r) => r.json() as Promise<HookProcessResult>);
}

describe('T4 — PreToolUse payload 직렬화/read-back', () => {
  let db: SpyglassDatabase;

  beforeEach(() => {
    delete process.env.SPYGLASS_ENCRYPTION;
    delete process.env.SPYGLASS_ENCRYPTION_KEY;
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try { unlinkSync(`${TEST_DB_PATH}${ext}`); } catch { /* ignore */ }
    }
  });

  it('raw 전체가 payload 에 JSON 직렬화 → read-back 시 tool_use_id/tool_name/tool_input 복원', async () => {
    const sessionId = crypto.randomUUID();
    const result = await sendPre(db, {
      session_id: sessionId,
      cwd: '/tmp/proj-pre-payload',
      tool_name: 'Bash',
      tool_use_id: 'tu-pre-payload-1',
      tool_input: { command: 'echo hello', timeout: 5000, nested: { a: [1, 2, 3] } },
    });
    expect(result.success).toBe(true);

    const row = getRequestById(db.instance, result.request_id)!;
    expect(row).not.toBeNull();
    expect(row.event_type).toBe('pre_tool');
    // payload 는 평문 JSON — 파싱 가능.
    const parsed = JSON.parse(row.payload as string) as Record<string, unknown>;
    expect(parsed.hook_event_name).toBe('PreToolUse');
    expect(parsed.tool_name).toBe('Bash');
    expect(parsed.tool_use_id).toBe('tu-pre-payload-1');
    // 중첩 객체 손실 없이 복원.
    expect((parsed.tool_input as Record<string, unknown>).command).toBe('echo hello');
    expect(((parsed.tool_input as Record<string, unknown>).nested as Record<string, unknown>).a)
      .toEqual([1, 2, 3]);
  });

  it('extractToolUseId 가 payload 에서 뽑은 tool_use_id 가 컬럼에도 기록됨 (Upsert 매칭 키 SSoT)', async () => {
    const sessionId = crypto.randomUUID();
    const result = await sendPre(db, {
      session_id: sessionId,
      cwd: '/tmp/proj-pre-payload',
      tool_name: 'Read',
      tool_use_id: 'tu-pre-payload-col',
      tool_input: { file_path: '/x' },
    });
    const row = getRequestById(db.instance, result.request_id)!;
    expect(row.tool_use_id).toBe('tu-pre-payload-col');
  });

  it('유니코드 본문(한글·이모지) payload 라운드트립 무손실', async () => {
    const sessionId = crypto.randomUUID();
    const KOR = '한글 명령어 — 줄바꿈\n탭\t끝';
    const result = await sendPre(db, {
      session_id: sessionId,
      cwd: '/tmp/proj-pre-payload',
      tool_name: 'Bash',
      tool_use_id: 'tu-pre-payload-uni',
      tool_input: { command: KOR, emoji: 'OK' },
    });
    const row = getRequestById(db.instance, result.request_id)!;
    const parsed = JSON.parse(row.payload as string) as Record<string, unknown>;
    expect((parsed.tool_input as Record<string, unknown>).command).toBe(KOR);
    expect((parsed.tool_input as Record<string, unknown>).emoji).toBe('OK');
  });

  it('암호화 OFF — payload 평문 그대로 + payload_algo NULL (raw 행 직접 확인)', async () => {
    const sessionId = crypto.randomUUID();
    const result = await sendPre(db, {
      session_id: sessionId,
      cwd: '/tmp/proj-pre-payload',
      tool_name: 'Bash',
      tool_use_id: 'tu-pre-payload-algo',
      tool_input: { command: 'sentinel-plaintext-marker' },
    });
    const rawRow = db.instance
      .query('SELECT payload, payload_algo FROM requests WHERE id = ?')
      .get(result.request_id) as { payload: string | null; payload_algo: string | null };
    expect(rawRow.payload_algo).toBeNull();
    expect(rawRow.payload).toContain('sentinel-plaintext-marker');
  });
});
