/**
 * GET /api/instructions/footprint — 라우트 계약 테스트.
 *
 * 검증 범위: 응답 모양(data.{window,path_prefix,files,reminder_bytes,system_prompt_bytes}, meta.{sampled_sessions,load_events}),
 * 쿼리 파라미터 해석(from/to/path_prefix/limit, 기본 7일 창, 숫자 아님 무시), GET 이외 메서드 미처리.
 * 파싱·집계 규칙 자체는 storage instruction-footprint.test.ts 가 고정한다.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { SpyglassDatabase, createProxyRequest, createEvent } from '@spyglass/storage';
import { apiRouter } from '../api';

const SUFFIX = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const TEST_DB_PATH = join(tmpdir(), `spyglass-instructions-${SUFFIX}.db`);
let db: SpyglassDatabase;
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

const reminder = (path: string, text: string) =>
  `<system-reminder>\nContents of ${path} (project instructions):\n\n${text}\n</system-reminder>\n`;

beforeAll(() => {
  db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  const put = (id: string, session: string, ts: number, text: string) =>
    createProxyRequest(db.instance, { id, timestamp: ts, method: 'POST', path: '/v1/messages', session_id: session, system_reminder: text });
  put('r1', 'recent', NOW - 1000, reminder('/work/hub/CLAUDE.md', 'x'.repeat(120)));
  put('r2', 'recent-other', NOW - 2000, reminder('/other/CLAUDE.md', 'y'.repeat(40)));
  put('r3', 'ancient', NOW - 30 * DAY, reminder('/work/hub/OLD.md', 'z'.repeat(10)));
  createEvent(db.instance, {
    event_id: 'ev1', event_type: 'InstructionsLoaded', session_id: 'recent', cwd: '/work/hub', timestamp: NOW - 900,
    payload: JSON.stringify({ file_path: '/work/hub/CLAUDE.md', memory_type: 'Project', load_reason: 'session_start' }),
  });
});
afterAll(() => {
  try { db.close(); } catch {}
  try { unlinkSync(TEST_DB_PATH); } catch {}
});

interface Body {
  success: boolean;
  data: {
    window: { from: number | null; to: number | null };
    path_prefix: string | null;
    files: Array<{ file_path: string; rel_path: string | null; loads: number; avg_bytes: number | null }>;
    reminder_bytes: { sessions: number; by_day: Array<{ day: string; requests: number }> | null };
    system_prompt_bytes: { latest: number | null; max: number | null; latest_at: number | null };
  };
  meta: { sampled_sessions: number; load_events: number };
}
async function get(query = ''): Promise<Body> {
  const res = await apiRouter(new Request(`http://x/api/instructions/footprint${query}`), db.instance);
  expect(res.status).toBe(200);
  return await res.json() as Body;
}

describe('GET /api/instructions/footprint', () => {
  it('기본 창은 최근 7일 — 30일 전 세션은 제외, 응답 모양 확인', async () => {
    const b = await get();
    expect(b.success).toBe(true);
    expect(b.data.window.from).not.toBeNull();
    expect(b.data.window.to).toBeNull();
    expect(b.data.path_prefix).toBeNull();
    expect(b.meta).toEqual({ sampled_sessions: 2, load_events: 1 });
    expect(b.data.files.map((f) => f.file_path).sort()).toEqual(['/other/CLAUDE.md', '/work/hub/CLAUDE.md']);
    const hub = b.data.files.find((f) => f.file_path === '/work/hub/CLAUDE.md')!;
    expect(hub).toMatchObject({ loads: 1, avg_bytes: 120 });
    expect(b.data.reminder_bytes.sessions).toBe(2);
    expect(b.data.reminder_bytes.by_day).toBeNull();
    expect(b.data.system_prompt_bytes).toEqual({ latest: null, max: null, latest_at: null });
  });

  it('path_prefix 로 거르고 rel_path 를 돌려준다', async () => {
    const b = await get(`?path_prefix=${encodeURIComponent('/work/hub')}`);
    expect(b.data.path_prefix).toBe('/work/hub');
    expect(b.data.files.map((f) => f.rel_path)).toEqual(['CLAUDE.md']);
  });

  it('from 을 앞당기면 오래된 세션도 포함', async () => {
    const b = await get(`?from=${NOW - 40 * DAY}`);
    expect(b.data.files.map((f) => f.file_path)).toContain('/work/hub/OLD.md');
  });

  it('limit 으로 표본 세션 수를 묶는다 (최근 활동 순)', async () => {
    const b = await get('?limit=1');
    expect(b.meta.sampled_sessions).toBe(1);
    expect(b.data.files.some((f) => f.file_path === '/work/hub/CLAUDE.md')).toBe(true);
  });

  it('trend=1 이면 일별 추이를 포함한다 (기간 안 요청 전체 기준)', async () => {
    const b = await get('?trend=1');
    expect(b.data.reminder_bytes.by_day).toEqual([expect.objectContaining({ requests: 2 })]);
  });

  it('숫자가 아닌 파라미터는 무시한다', async () => {
    const b = await get('?from=abc&limit=xyz');
    expect(b.success).toBe(true);
    expect(b.data.window.from).not.toBeNull();
  });

  it('POST 는 처리하지 않는다', async () => {
    const res = await apiRouter(new Request('http://x/api/instructions/footprint', { method: 'POST' }), db.instance);
    expect(res.status).toBe(404);
  });
});
