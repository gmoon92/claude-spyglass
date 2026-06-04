/**
 * Conversations API Tests
 *
 * @description GET /api/conversations — 날짜 범위 대화(프롬프트·응답 전문) 조회.
 *   날짜 경계·project 필터·role 매핑·전문 추출 3종·툴 제외·세션 그룹핑·400 케이스 검증.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SpyglassDatabase, createSession, createRequest, type CreateRequestParams } from '@spyglass/storage';
import { apiRouter } from '../api';

// 로컬 TZ 기준 — 라우트의 new Date(`${date}T00:00:00.000`) 해석과 동일 축
const DAY1 = '2026-06-01';
const DAY2 = '2026-06-02';
const dayStart = (date: string) => new Date(`${date}T00:00:00.000`).getTime();

let testCounter = 0;
function testDbPath() {
  return `/tmp/spyglass-conversations-test-${Date.now()}-${++testCounter}.db`;
}

interface ConversationMessage {
  ts: number;
  role: 'user' | 'assistant';
  text: string;
  text_source: 'full' | 'preview';
}
interface ConversationSession {
  id: string;
  project: string;
  started_at: number;
  messages: ConversationMessage[];
}
interface ConversationsBody {
  success: boolean;
  data: ConversationSession[];
  error?: string;
  meta?: { total?: number; truncated?: boolean };
}

function makeRow(db: SpyglassDatabase, params: Partial<CreateRequestParams> & Pick<CreateRequestParams, 'id' | 'session_id' | 'timestamp' | 'type'>) {
  createRequest(db.instance, {
    tokens_input: 10,
    tokens_output: 5,
    tokens_total: 15,
    duration_ms: 0,
    ...params,
  });
}

async function getConversations(db: SpyglassDatabase, query: string): Promise<{ status: number; body: ConversationsBody }> {
  const res = await apiRouter(new Request(`http://localhost/api/conversations?${query}`), db.instance);
  return { status: res.status, body: await res.json() as ConversationsBody };
}

describe('GET /api/conversations', () => {
  let db: SpyglassDatabase;
  let dbPath: string;

  beforeEach(() => {
    dbPath = testDbPath();
    db = new SpyglassDatabase({ dbPath, autoInit: true });

    // 세션 2개 — 프로젝트 구분
    createSession(db.instance, { id: 's1', project_name: 'proj-a', started_at: dayStart(DAY1) });
    createSession(db.instance, { id: 's2', project_name: 'proj-b', started_at: dayStart(DAY1) });

    // s1: 프롬프트 (raw hook JSON — 전문은 .prompt)
    makeRow(db, {
      id: 'p1', session_id: 's1', timestamp: dayStart(DAY1) + 1000, type: 'prompt',
      payload: JSON.stringify({ prompt: 'full user prompt text', session_id: 's1' }),
      preview: 'full user prompt text'.slice(0, 2000),
    });
    // s1: Stop hook 응답 (전문은 .last_assistant_message)
    makeRow(db, {
      id: 'resp-stop-1', session_id: 's1', timestamp: dayStart(DAY1) + 2000, type: 'response',
      payload: JSON.stringify({ last_assistant_message: 'full stop-hook reply' }),
      preview: 'full stop-hook reply',
    });
    // s1: transcript backfill 응답 (전문은 .text)
    makeRow(db, {
      id: 'resp-msg-m1', session_id: 's1', timestamp: dayStart(DAY1) + 3000, type: 'response',
      payload: JSON.stringify({ message_id: 'm1', text: 'full transcript reply', source: 'transcript' }),
      preview: 'full transcript reply',
    });
    // s1: proxy-fallback 응답 (payload에 전문 없음 → preview 폴백)
    makeRow(db, {
      id: 'resp-proxy-1', session_id: 's1', timestamp: dayStart(DAY1) + 4000, type: 'response',
      payload: JSON.stringify({ session_id: 's1' }),
      preview: 'preview-only reply',
    });
    // s1: 툴 호출 — 제외 대상
    makeRow(db, {
      id: 't1', session_id: 's1', timestamp: dayStart(DAY1) + 5000, type: 'tool_call',
      tool_name: 'Bash',
    });
    // s2 (proj-b): DAY2 프롬프트
    makeRow(db, {
      id: 'p2', session_id: 's2', timestamp: dayStart(DAY2) + 1000, type: 'prompt',
      payload: JSON.stringify({ prompt: 'day2 prompt' }),
      preview: 'day2 prompt',
    });
  });

  afterEach(() => {
    try { db.instance.close(); } catch {}
    try { require('fs').unlinkSync(dbPath); } catch {}
  });

  it('세션별 그룹핑 + 세션 내 시간순 정렬', async () => {
    const { status, body } = await getConversations(db, `start=${DAY1}&end=${DAY2}`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(2);
    const s1 = body.data.find(s => s.id === 's1')!;
    expect(s1.project).toBe('proj-a');
    expect(s1.messages.map(m => m.ts)).toEqual([...s1.messages.map(m => m.ts)].sort((a, b) => a - b));
  });

  it('role 매핑 — prompt→user, response→assistant', async () => {
    const { body } = await getConversations(db, `start=${DAY1}&end=${DAY1}`);
    const s1 = body.data.find(s => s.id === 's1')!;
    expect(s1.messages[0].role).toBe('user');
    expect(s1.messages.slice(1).every(m => m.role === 'assistant')).toBe(true);
  });

  it('전문 추출 — .prompt / .last_assistant_message / .text 모두 full', async () => {
    const { body } = await getConversations(db, `start=${DAY1}&end=${DAY1}`);
    const msgs = body.data.find(s => s.id === 's1')!.messages;
    expect(msgs[0]).toMatchObject({ text: 'full user prompt text', text_source: 'full' });
    expect(msgs[1]).toMatchObject({ text: 'full stop-hook reply', text_source: 'full' });
    expect(msgs[2]).toMatchObject({ text: 'full transcript reply', text_source: 'full' });
  });

  it('proxy-fallback 행 — preview 폴백 + text_source=preview', async () => {
    const { body } = await getConversations(db, `start=${DAY1}&end=${DAY1}`);
    const msgs = body.data.find(s => s.id === 's1')!.messages;
    expect(msgs[3]).toMatchObject({ text: 'preview-only reply', text_source: 'preview' });
  });

  it('툴 호출 행 제외', async () => {
    const { body } = await getConversations(db, `start=${DAY1}&end=${DAY2}`);
    const allTexts = body.data.flatMap(s => s.messages);
    expect(allTexts.length).toBe(5); // p1 + 응답 3 + p2 (t1 제외)
    expect(body.meta?.total).toBe(5);
  });

  it('날짜 경계 — end 날짜 23:59:59.999 까지 포함, 다음 날 제외', async () => {
    const { body } = await getConversations(db, `start=${DAY1}&end=${DAY1}`);
    expect(body.data.length).toBe(1); // s2(DAY2)는 제외
    expect(body.data[0].id).toBe('s1');
  });

  it('project 필터', async () => {
    const { body } = await getConversations(db, `start=${DAY1}&end=${DAY2}&project=proj-b`);
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe('s2');
    expect(body.data[0].messages[0].text).toBe('day2 prompt');
  });

  it('truncated 미발생 시 false', async () => {
    const { body } = await getConversations(db, `start=${DAY1}&end=${DAY2}`);
    expect(body.meta?.truncated).toBe(false);
  });

  it('400 — 날짜 형식 오류', async () => {
    const { status } = await getConversations(db, `start=2026/06/01&end=${DAY1}`);
    expect(status).toBe(400);
  });

  it('400 — 파라미터 누락', async () => {
    const { status } = await getConversations(db, `start=${DAY1}`);
    expect(status).toBe(400);
  });

  it('400 — end < start', async () => {
    const { status } = await getConversations(db, `start=${DAY2}&end=${DAY1}`);
    expect(status).toBe(400);
  });

  it('400 — 31일 초과 범위', async () => {
    const { status } = await getConversations(db, `start=2026-01-01&end=2026-03-01`);
    expect(status).toBe(400);
  });
});
