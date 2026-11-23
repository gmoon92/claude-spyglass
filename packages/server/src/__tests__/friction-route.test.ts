/**
 * GET /api/friction — 라우트 계약 테스트.
 *
 * 검증 범위:
 *  - 응답 모양: data.{window,totals,by_session,top_failing_tools,repeated_failures}, meta.{scanned_events,truncated}
 *  - 쿼리 파라미터 해석: from/to(ms), session_id, cwd_prefix, limit, repeat_min, 기본 24시간 창
 *  - GET 이외 메서드·다른 경로는 이 라우터가 처리하지 않는다(404 로 떨어진다)
 *
 * 집계 규칙 자체는 storage friction.test.ts 가 고정한다. 여기서는 HTTP 경계만 본다.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { SpyglassDatabase, createEvent } from '@spyglass/storage';
import { apiRouter } from '../api';

const SUFFIX = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const TEST_DB_PATH = join(tmpdir(), `spyglass-friction-${SUFFIX}.db`);
let db: SpyglassDatabase;

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;
let n = 0;

function put(type: string, session: string, ts: number, payload: Record<string, unknown>, cwd = '/work/hub'): void {
  createEvent(db.instance, {
    event_id: `fr-${++n}-${SUFFIX}`, event_type: type, session_id: session, cwd,
    timestamp: ts, payload: JSON.stringify(payload),
  });
}

beforeAll(() => {
  db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  // 최근 1시간 안: 세션 s1 에서 Bash 3연속 실패 + 권한 요청, 세션 s2(다른 cwd)에서 Read 실패 1건
  for (let i = 0; i < 3; i++) {
    put('PostToolUseFailure', 's1', NOW - 50 * 60_000 + i * 1000, { tool_name: 'Bash', error: `Exit code ${i}\ndetail` });
  }
  put('PermissionRequest', 's1', NOW - 40 * 60_000, { tool_name: 'Bash' });
  put('PostToolUseFailure', 's2', NOW - 30 * 60_000, { tool_name: 'Read', error: 'ENOENT' }, '/work/other');
  // 3일 전 — 기본 창(24시간) 밖
  put('PostToolUseFailure', 's3', NOW - 72 * HOUR, { tool_name: 'Old', error: 'old' });
  // 잡음
  put('CwdChanged', 's1', NOW - 10 * 60_000, {});
});

afterAll(() => {
  try { db.close(); } catch {}
  try { unlinkSync(TEST_DB_PATH); } catch {}
});

interface FrictionResponse {
  success: boolean;
  data: {
    window: { from: number | null; to: number | null };
    totals: Record<string, number>;
    by_session: Array<{ session_id: string; tool_failures: number; permission_requests: number }>;
    top_failing_tools: Array<{ tool_name: string; failures: number; last_error: string | null }>;
    repeated_failures: Array<{ session_id: string; tool_name: string; streak: number }>;
  };
  meta: { scanned_events: number; truncated: boolean };
}

async function get(query = ''): Promise<FrictionResponse> {
  const res = await apiRouter(new Request(`http://x/api/friction${query}`), db.instance);
  expect(res.status).toBe(200);
  return await res.json() as FrictionResponse;
}

describe('GET /api/friction', () => {
  it('기본 창은 최근 24시간 — 3일 전 이벤트는 제외, 응답 모양 확인', async () => {
    const body = await get();
    expect(body.success).toBe(true);
    expect(body.data.window.from).not.toBeNull();
    expect(body.data.window.to).toBeNull();
    expect(body.data.totals).toEqual({
      tool_failures: 4, interrupts: 0, permission_requests: 1,
      permission_denied: 0, stop_failures: 0, compactions: 0,
    });
    expect(body.meta).toEqual({ scanned_events: 5, truncated: false });
    expect(body.data.top_failing_tools.map((t) => t.tool_name)).toEqual(['Bash', 'Read']);
    expect(body.data.top_failing_tools[0].last_error).toBe('Exit code 2'); // 첫 줄만
    expect(body.data.repeated_failures).toEqual([
      expect.objectContaining({ session_id: 's1', tool_name: 'Bash', streak: 3 }),
    ]);
  });

  it('from 을 3일 전보다 앞으로 주면 오래된 이벤트도 포함', async () => {
    const body = await get(`?from=${NOW - 100 * HOUR}`);
    expect(body.data.top_failing_tools.map((t) => t.tool_name)).toContain('Old');
  });

  it('to 만 주면 from 없이 그 시각까지', async () => {
    const body = await get(`?to=${NOW - 60 * HOUR}`);
    expect(body.data.window).toEqual({ from: null, to: NOW - 60 * HOUR });
    expect(body.data.top_failing_tools.map((t) => t.tool_name)).toEqual(['Old']);
  });

  it('session_id·cwd_prefix 로 좁힌다', async () => {
    const bySession = await get('?session_id=s2');
    expect(bySession.data.by_session.map((s) => s.session_id)).toEqual(['s2']);
    const byCwd = await get(`?cwd_prefix=${encodeURIComponent('/work/other')}`);
    expect(byCwd.data.by_session.map((s) => s.session_id)).toEqual(['s2']);
  });

  it('limit 에 걸리면 meta.truncated=true', async () => {
    const body = await get('?limit=2');
    expect(body.meta.truncated).toBe(true);
    expect(body.meta.scanned_events).toBe(2);
  });

  it('repeat_min 을 올리면 3연속이 더 이상 올라오지 않는다', async () => {
    const body = await get('?repeat_min=4');
    expect(body.data.repeated_failures).toEqual([]);
  });

  it('숫자가 아닌 파라미터는 무시한다 (다른 라우트와 같은 관대한 해석)', async () => {
    const body = await get('?from=abc&limit=xyz');
    expect(body.success).toBe(true);
    expect(body.data.window.from).not.toBeNull(); // 기본 24시간 창으로 복귀
  });

  it('POST 는 처리하지 않는다', async () => {
    const res = await apiRouter(new Request('http://x/api/friction', { method: 'POST' }), db.instance);
    expect(res.status).toBe(404);
  });
});
