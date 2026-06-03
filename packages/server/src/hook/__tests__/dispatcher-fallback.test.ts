/**
 * T20 — dispatcher Strategy 라우팅 + fallback(SystemEventHandler) 현재 동작 고정.
 *
 * 검증 목적 (dispatcher.ts REGISTRY/FALLBACK 특성화):
 *   - 등록된 이벤트(PreToolUse/PostToolUse/UserPromptSubmit) 는 해당 핸들러로 라우팅.
 *   - 미등록 이벤트(임의 이름) 는 FALLBACK(SystemEventHandler) 가 처리해 request_type='system',
 *     event_type=<hook_event_name 소문자> 로 보존(200 흡수).
 *   - listRegisteredEventTypes 가 정확히 3개 등록 이벤트를 노출(SystemEventHandler 는 eventType=''
 *     이라 REGISTRY 키에 포함되지 않음).
 *
 * 격리: 고유 임시 DB + afterEach 본체/-wal/-shm 삭제 + closeDatabase(). sessionId 는 uuid.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { unlinkSync } from 'fs';
import { SpyglassDatabase, closeDatabase, getRequestById } from '@spyglass/storage';
import { dispatchHookEvent, listRegisteredEventTypes } from '../dispatcher';
import type { HookContext } from '../event-handler';

const TEST_DB_PATH = `/tmp/spyglass-dispatcher-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`;

describe('T20 — dispatcher 라우팅 + fallback', () => {
  let db: SpyglassDatabase;
  let ctx: HookContext;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    ctx = { db: db.instance, now: Date.now() - 60_000, projectName: 'dispatcher-test' };
  });

  afterEach(() => {
    closeDatabase();
    for (const ext of ['', '-wal', '-shm']) {
      try { unlinkSync(`${TEST_DB_PATH}${ext}`); } catch { /* ignore */ }
    }
  });

  it('listRegisteredEventTypes — 등록 이벤트 3종 (fallback 제외)', () => {
    const types = listRegisteredEventTypes();
    expect(types).toContain('PreToolUse');
    expect(types).toContain('PostToolUse');
    expect(types).toContain('UserPromptSubmit');
    // SystemEventHandler(eventType='')는 fallback 표식이라 REGISTRY 키에 없음.
    expect(types).not.toContain('');
    expect(types.length).toBe(3);
  });

  it('등록 이벤트 PreToolUse → PreToolUseHandler 라우팅 (request_id prefix=pre, event_type=pre_tool)', () => {
    const sessionId = crypto.randomUUID();
    const result = dispatchHookEvent(
      {
        hook_event_name: 'PreToolUse',
        session_id: sessionId,
        tool_name: 'Bash',
        tool_use_id: 'tu-disp-pre',
        tool_input: { command: 'ls' },
      },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(result.request_id.startsWith('pre-')).toBe(true);
    const row = getRequestById(db.instance, result.request_id)!;
    expect(row.event_type).toBe('pre_tool');
  });

  it('미등록 이벤트 → FALLBACK(SystemEventHandler): request_type=system, event_type=소문자, 200 흡수', () => {
    const sessionId = crypto.randomUUID();
    const result = dispatchHookEvent(
      { hook_event_name: 'NotificationXYZ', session_id: sessionId },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(result.request_id.startsWith('sys-')).toBe(true);
    const row = getRequestById(db.instance, result.request_id)!;
    expect(row.type).toBe('system');
    // SystemEventHandler 는 hook_event_name 을 소문자로 event_type 에 보존.
    expect(row.event_type).toBe('notificationxyz');
  });

  it('미등록 이벤트의 raw payload 는 payload 컬럼에 JSON 보존 (system 흡수 시에도 원문 유지)', () => {
    const sessionId = crypto.randomUUID();
    const result = dispatchHookEvent(
      { hook_event_name: 'CustomHook', session_id: sessionId, cwd: '/tmp/x-disp' },
      ctx,
    );
    const row = getRequestById(db.instance, result.request_id)!;
    const parsed = JSON.parse(row.payload as string) as Record<string, unknown>;
    expect(parsed.hook_event_name).toBe('CustomHook');
    expect(parsed.cwd).toBe('/tmp/x-disp');
  });
});
