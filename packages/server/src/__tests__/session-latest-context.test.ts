/**
 * GET /api/sessions/:id — anomalies.context_saturation 의 latest_* 계약.
 *
 * 검증 범위:
 *  - 기존 필드(stage·context_tokens·window_max·pct·threshold_*)는 그대로, latest_* 4개가 추가로 실린다.
 *  - context_tokens 는 세션 최고점, latest_context_tokens 는 가장 최근 대화 요청 — 압축 뒤 값이 갈린다.
 *  - 068 시드가 적용돼 Claude 5 모델의 window_max 가 1M 이다(관측 최대치로 부풀지 않는다).
 *
 * 소비자: 허브의 stop-context-guard 훅(1초 안에 현재 컨텍스트 비율을 읽는다).
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { SpyglassDatabase, createSession, createProxyRequest, invalidateModelLimitsCache } from '@spyglass/storage';
import { apiRouter } from '../api';

const SUFFIX = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const TEST_DB_PATH = join(tmpdir(), `spyglass-latest-ctx-${SUFFIX}.db`);
let db: SpyglassDatabase;

const NOW = Date.now() - 60_000;
const SESSION_COMPACTED = crypto.randomUUID(); // 500K 까지 갔다가 압축되어 현재 40K
const SESSION_EMPTY = crypto.randomUUID();     // proxy 행 없음

function proxyRow(id: string, sessionId: string, ts: number, ctx: number, toolsCount: number): void {
  createProxyRequest(db.instance, {
    id, timestamp: ts, method: 'POST', path: '/v1/messages',
    model: 'claude-opus-5-5', session_id: sessionId,
    tokens_input: ctx, tools_count: toolsCount,
  });
}

beforeAll(() => {
  invalidateModelLimitsCache();
  db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  for (const sid of [SESSION_COMPACTED, SESSION_EMPTY]) {
    createSession(db.instance, { id: sid, project_name: 'latest-ctx-test', started_at: NOW - 30_000 });
  }
  proxyRow('p1', SESSION_COMPACTED, NOW,         500_000, 28);
  proxyRow('p2', SESSION_COMPACTED, NOW + 1_000, 40_000, 28);  // 압축 뒤 현재 값
  proxyRow('p3', SESSION_COMPACTED, NOW + 2_000, 300, 0);      // 도구 없는 부가 질의 — 건너뛴다
});

afterAll(() => {
  try { db.close(); } catch {}
  try { unlinkSync(TEST_DB_PATH); } catch {}
  invalidateModelLimitsCache();
});

interface SessionResponse {
  success: boolean;
  data: {
    id: string;
    anomalies: {
      context_saturation: {
        stage: string | null;
        context_tokens: number;
        window_max: number;
        pct: number;
        threshold_warn: number;
        threshold_critical: number;
        latest_context_tokens: number;
        latest_pct: number;
        latest_at: number | null;
        latest_model: string | null;
      };
    };
  };
}

async function getSession(id: string): Promise<SessionResponse> {
  const res = await apiRouter(new Request(`http://x/api/sessions/${id}`), db.instance);
  expect(res.status).toBe(200);
  return await res.json() as SessionResponse;
}

describe('GET /api/sessions/:id — context_saturation.latest_*', () => {
  it('압축된 세션 — 최고점(context_tokens)은 유지, latest 는 현재 값', async () => {
    const cs = (await getSession(SESSION_COMPACTED)).data.anomalies.context_saturation;
    expect(cs.context_tokens).toBe(500_000);
    expect(cs.window_max).toBe(1_000_000);          // 068 시드 — 관측 최대치(500K)로 부풀지 않는다
    expect(cs.pct).toBeCloseTo(0.5, 3);
    expect(cs.latest_context_tokens).toBe(40_000);  // p3(tools_count 0)가 아니라 p2
    expect(cs.latest_pct).toBeCloseTo(0.04, 3);
    expect(cs.latest_at).toBe(NOW + 1_000);
    expect(cs.latest_model).toBe('claude-opus-5-5');
  });

  it('기존 필드는 그대로 존재한다 (추가만, 삭제·의미 변경 없음)', async () => {
    const cs = (await getSession(SESSION_COMPACTED)).data.anomalies.context_saturation;
    for (const key of ['stage', 'context_tokens', 'window_max', 'pct', 'threshold_warn', 'threshold_critical']) {
      expect(key in cs).toBe(true);
    }
  });

  it('proxy 행이 없는 세션 — latest 는 0 / null', async () => {
    const cs = (await getSession(SESSION_EMPTY)).data.anomalies.context_saturation;
    expect(cs.latest_context_tokens).toBe(0);
    expect(cs.latest_pct).toBe(0);
    expect(cs.latest_at).toBeNull();
    expect(cs.latest_model).toBeNull();
  });
});
