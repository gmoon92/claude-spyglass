/**
 * Stop 이벤트(/events) — 세션 행이 없을 때 응답 저장이 FK 위반으로 유실되던 회귀.
 *
 * 재현 조건: requests 는 남아있는데 sessions 행이 사라진 상태(또는 도구 훅 없이 Stop 이 먼저 도착)에서
 * Stop 이 오면 saveAssistantResponse 의 createRequest 가 SQLITE_CONSTRAINT_FOREIGNKEY 로 실패했다.
 * 수정 후: ensureSession 으로 세션 행을 먼저 보장(cwd → project_name 파생) → response 행이 저장된다.
 *
 * 격리: 고유 임시 DB + afterEach 본체/-wal/-shm 삭제.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { unlinkSync } from 'fs';
import { SpyglassDatabase, getSessionById } from '@spyglass/storage';
import { eventsCollectHandler } from '../events';

const TEST_DB_PATH = `/tmp/spyglass-events-stop-${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}.db`;

describe('eventsCollectHandler — Stop 시 세션 보장', () => {
  let db: SpyglassDatabase;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  });

  afterEach(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { unlinkSync(TEST_DB_PATH + suffix); } catch { /* noop */ }
    }
  });

  it('sessions 행이 없어도 Stop 응답이 저장되고 세션이 생성된다', async () => {
    const sessionId = `stop-orphan-${crypto.randomUUID()}`;
    const req = new Request('http://localhost/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hook_event_name: 'Stop',
        session_id: sessionId,
        cwd: '/Users/someone/projects/my-app',
        last_assistant_message: '작업 완료했습니다.',
      }),
    });

    const res = await eventsCollectHandler(req, db.instance);
    expect(res.status).toBe(200);

    const session = getSessionById(db.instance, sessionId);
    expect(session?.project_name).toBe('my-app');

    const row = db.instance
      .query("SELECT type, preview FROM requests WHERE session_id = ? AND type = 'response'")
      .get(sessionId) as { type: string; preview: string } | null;
    expect(row).not.toBeNull();
  });
});
