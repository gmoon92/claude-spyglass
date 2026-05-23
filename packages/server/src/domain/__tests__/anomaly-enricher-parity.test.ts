/**
 * R-A — Anomaly enricher 일관성 (SSE 단일 vs API 배치).
 *
 * 검증 목적:
 *  - enrichWithAnomalies(rows) 와 enrichRowWithAnomalies(row) 가 같은 입력 행에 대해
 *    bloated_sys / agent_spike 필드를 동일하게 산출하는가.
 *  - 페이지 컨텍스트 의존 필드(spike / loop / slow) 가 단일 경로에서 null 정책 유지.
 *  - 출력에 anomaly 5개 필드 (bloated_sys, agent_spike, spike, loop, slow) 가 모두 존재.
 *
 * 회귀 보호: 흐름 차트 BFS / persist 변경이 anomaly enricher 의 depth-3 WITH RECURSIVE 또는
 *   normalizeRequest 인터페이스를 깨면 즉시 빨강.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import {
  SpyglassDatabase,
  createSession,
  createRequest,
  type Request,
} from '@spyglass/storage';
import { normalizeRequest, normalizeRequests } from '../request-normalizer';
import { enrichWithAnomalies, enrichRowWithAnomalies } from '../anomaly-enricher';

const SUFFIX = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const TEST_DB_PATH = `/tmp/spyglass-anomaly-parity-${SUFFIX}.db`;
let db: SpyglassDatabase;
const NOW = Date.now() - 60_000;
const SESSION_ID = crypto.randomUUID();
const ANOMALY_KEYS = ['bloated_sys', 'agent_spike', 'spike', 'loop', 'slow'] as const;

beforeAll(() => {
  db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  createSession(db.instance, {
    id: SESSION_ID, project_name: 'anomaly-test', started_at: NOW - 30_000,
  });

  // 정상 prompt + Agent + 자식 자식 트리. spike 가 발화하지 않을 normal 케이스.
  createRequest(db.instance, {
    id: 'a-prompt', session_id: SESSION_ID, timestamp: NOW,
    type: 'prompt', turn_id: 'T1',
    tokens_input: 100, tokens_output: 0, tokens_total: 100,
    model: 'claude-opus-4-7', tokens_confidence: 'high',
  });
  createRequest(db.instance, {
    id: 'a-agent', session_id: SESSION_ID, timestamp: NOW + 1000,
    type: 'tool_call', tool_name: 'Agent', tool_detail: 'reviewer',
    turn_id: 'T1', tool_use_id: 'a-tu-agent', event_type: 'tool',
    tokens_input: 50, tokens_output: 100, tokens_total: 150,
  });
  createRequest(db.instance, {
    id: 'a-child', session_id: SESSION_ID, timestamp: NOW + 2000,
    type: 'tool_call', tool_name: 'Bash', tool_detail: 'ls',
    turn_id: 'T1', tool_use_id: 'a-tu-child',
    parent_tool_use_id: 'a-tu-agent', event_type: 'tool',
    tokens_input: 0, tokens_output: 0, tokens_total: 0,
  });
});

afterAll(() => {
  try { db.close(); } catch {}
  try { require('fs').unlinkSync(TEST_DB_PATH); } catch {}
});

function loadRaw(id: string): Request {
  return db.instance.query('SELECT * FROM requests WHERE id = ?').get(id) as Request;
}

describe('Anomaly enricher R-A — SSE vs API 일관성', () => {
  it('두 enricher 모두 anomaly 5개 필드를 항상 출력', () => {
    const rawPrompt = loadRaw('a-prompt');
    const rawAgent = loadRaw('a-agent');

    const batch = enrichWithAnomalies(db.instance, normalizeRequests([rawPrompt, rawAgent]));
    const singlePrompt = enrichRowWithAnomalies(db.instance, normalizeRequest(rawPrompt));
    const singleAgent = enrichRowWithAnomalies(db.instance, normalizeRequest(rawAgent));

    for (const r of batch) {
      for (const k of ANOMALY_KEYS) {
        expect(k in r).toBe(true);
      }
    }
    for (const k of ANOMALY_KEYS) {
      expect(k in singlePrompt).toBe(true);
      expect(k in singleAgent).toBe(true);
    }
  });

  it('단일 enricher (SSE) — spike / loop / slow 항상 null (페이지 컨텍스트 부재 정책)', () => {
    const rawPrompt = loadRaw('a-prompt');
    const rawAgent = loadRaw('a-agent');
    const singlePrompt = enrichRowWithAnomalies(db.instance, normalizeRequest(rawPrompt));
    const singleAgent = enrichRowWithAnomalies(db.instance, normalizeRequest(rawAgent));

    for (const row of [singlePrompt, singleAgent]) {
      expect(row.spike).toBeNull();
      expect(row.loop).toBeNull();
      expect(row.slow).toBeNull();
    }
  });

  it('두 경로의 bloated_sys / agent_spike 결과 동일 (정상 케이스: 둘 다 null)', () => {
    const rawPrompt = loadRaw('a-prompt');
    const rawAgent = loadRaw('a-agent');

    const batch = enrichWithAnomalies(db.instance, normalizeRequests([rawPrompt, rawAgent]));
    const batchPrompt = batch.find(r => r.id === 'a-prompt')!;
    const batchAgent = batch.find(r => r.id === 'a-agent')!;
    const singlePrompt = enrichRowWithAnomalies(db.instance, normalizeRequest(rawPrompt));
    const singleAgent = enrichRowWithAnomalies(db.instance, normalizeRequest(rawAgent));

    // bloated_sys / agent_spike 는 같은 DB 메타에 기반 — 두 경로 동일해야 함.
    expect(batchPrompt.bloated_sys).toEqual(singlePrompt.bloated_sys);
    expect(batchAgent.agent_spike).toEqual(singleAgent.agent_spike);
  });

  it('빈 입력 — enrichWithAnomalies 는 빈 배열 반환', () => {
    const out = enrichWithAnomalies(db.instance, []);
    expect(out).toEqual([]);
  });

  it('입력 행의 raw 필드는 보존 (id / session_id / timestamp / tool_name)', () => {
    const rawAgent = loadRaw('a-agent');
    const out = enrichWithAnomalies(db.instance, normalizeRequests([rawAgent]))[0];

    expect(out.id).toBe('a-agent');
    expect(out.session_id).toBe(SESSION_ID);
    expect(out.timestamp).toBe(rawAgent.timestamp);
    expect(out.tool_name).toBe('Agent');
    expect(out.tool_detail).toBe('reviewer');
    expect(out.tool_use_id).toBe('a-tu-agent');
  });
});
