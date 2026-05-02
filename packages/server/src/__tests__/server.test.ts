/**
 * Server Integration Tests
 *
 * @description HTTP 서버 및 API 통합 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  SpyglassDatabase,
  closeDatabase,
  createSession,
  createRequest,
  getRequestById,
} from '@spyglass/storage';
import { startServer, stopServer, isServerRunning } from '../index';
import { collectHandler } from '../hook';
import { apiRouter } from '../api';
import { sseRouter } from '../sse';

const TEST_DB_PATH = `/tmp/spyglass-server-test-${Date.now()}.db`;
const TEST_PORT = 19999;

describe('Server', () => {
  let db: SpyglassDatabase;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  });

  afterEach(async () => {
    await stopServer();
    closeDatabase();
    try {
      require('fs').unlinkSync(TEST_DB_PATH);
    } catch {}
  });

  describe('Server Lifecycle', () => {
    it('should start and stop server', async () => {
      expect(isServerRunning()).toBe(false);

      const server = startServer({ port: TEST_PORT });
      expect(server).toBeDefined();
      expect(isServerRunning()).toBe(true);

      await stopServer();
      expect(isServerRunning()).toBe(false);
    });

    it('should return existing server if already running', () => {
      const server1 = startServer({ port: TEST_PORT });
      const server2 = startServer({ port: TEST_PORT });

      expect(server1).toBe(server2);
    });
  });

  describe('Health Endpoint', () => {
    it('should return health status', async () => {
      startServer({ port: TEST_PORT });

      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.version).toBe('0.1.0');
    });
  });

  describe('Root Endpoint', () => {
    it('should return API info', async () => {
      startServer({ port: TEST_PORT });

      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.name).toBe('spyglass');
      expect(body.endpoints).toBeDefined();
    });
  });

  describe('CORS', () => {
    it('should handle OPTIONS request', async () => {
      startServer({ port: TEST_PORT });

      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`, {
        method: 'OPTIONS',
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });
});

describe('API Endpoints', () => {
  let db: SpyglassDatabase;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });

    // 테스트 데이터
    createSession(db.instance, {
      id: 'api-test-session',
      project_name: 'api-test',
      started_at: Date.now(),
    });

    createRequest(db.instance, {
      id: 'api-test-request',
      session_id: 'api-test-session',
      timestamp: Date.now(),
      type: 'prompt',
      tokens_total: 100,
    });
  });

  afterEach(() => {
    closeDatabase();
    try {
      require('fs').unlinkSync(TEST_DB_PATH);
    } catch {}
  });

  describe('GET /api/sessions', () => {
    it('should return all sessions', async () => {
      const req = new Request('http://localhost/api/sessions');
      const res = await apiRouter(req, db.instance);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.length).toBeGreaterThan(0);
    });

    it('should respect limit parameter', async () => {
      const req = new Request('http://localhost/api/sessions?limit=1');
      const res = await apiRouter(req, db.instance);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBeLessThanOrEqual(1);
    });
  });

  describe('GET /api/sessions/:id', () => {
    it('should return session by id', async () => {
      const req = new Request('http://localhost/api/sessions/api-test-session');
      const res = await apiRouter(req, db.instance);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('api-test-session');
    });

    it('should return 404 for non-existent session', async () => {
      const req = new Request('http://localhost/api/sessions/non-existent');
      const res = await apiRouter(req, db.instance);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/requests', () => {
    it('should return all requests', async () => {
      const req = new Request('http://localhost/api/requests');
      const res = await apiRouter(req, db.instance);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/dashboard', () => {
    it('should return dashboard data', async () => {
      const req = new Request('http://localhost/api/dashboard');
      const res = await apiRouter(req, db.instance);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.summary).toBeDefined();
      expect(body.data.sessions).toBeDefined();
      expect(body.data.requests).toBeDefined();
    });

    it('should reflect fromTs/toTs range on chartSection stats (avg/p95/error/cost)', async () => {
      // 과거(범위 밖) — 1시간 전 ~ 50분 전: prompt + tool_call PostToolUse(에러 포함)
      const oldBase = Date.now() - 60 * 60_000;
      createRequest(db.instance, {
        id: 'old-prompt',
        session_id: 'api-test-session',
        timestamp: oldBase,
        type: 'prompt',
        model: 'claude-3-5-sonnet-20241022',
        tokens_input: 10_000,
        tokens_output: 5_000,
        tokens_total: 15_000,
        cache_creation_tokens: 5_000,
        cache_read_tokens: 20_000,
        tokens_confidence: 'high',
      });
      createRequest(db.instance, {
        id: 'old-tool',
        session_id: 'api-test-session',
        timestamp: oldBase + 1_000,
        type: 'tool_call',
        tool_name: 'Bash',
        tool_detail: 'error: bad command',
        event_type: 'tool',
        duration_ms: 50_000,
      });

      // 최근(범위 안) — 5분 전 ~ 지금: tool_call PostToolUse 1건(빠름, 정상)
      const recentBase = Date.now() - 5 * 60_000;
      createRequest(db.instance, {
        id: 'recent-tool',
        session_id: 'api-test-session',
        timestamp: recentBase,
        type: 'tool_call',
        tool_name: 'Read',
        tool_detail: 'ok',
        event_type: 'tool',
        duration_ms: 100,
      });

      // 범위: 10분 전 ~ 지금  (recent-tool만 포함되어야 함)
      const fromTs = Date.now() - 10 * 60_000;
      const toTs = Date.now();
      const req = new Request(`http://localhost/api/dashboard?from=${fromTs}&to=${toTs}`);
      const res = await apiRouter(req, db.instance);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      const s = body.data.summary;
      // recent-tool(100ms)만 평균/P95에 반영되어야 함 — 50_000ms 이상값 미포함
      expect(s.avgDurationMs).toBe(100);
      expect(s.p95DurationMs).toBe(100);
      // recent-tool은 'ok'라 오류 0건
      expect(s.errorRate).toBe(0);
      // 토큰 비용은 범위 내 prompt 없으므로 0
      expect(s.costUsd).toBe(0);
      expect(s.cacheSavingsUsd).toBe(0);
    });

    it('should aggregate over full history when fromTs/toTs are not provided', async () => {
      const oldBase = Date.now() - 60 * 60_000;
      createRequest(db.instance, {
        id: 'full-tool',
        session_id: 'api-test-session',
        timestamp: oldBase,
        type: 'tool_call',
        tool_name: 'Bash',
        tool_detail: 'ok',
        event_type: 'tool',
        duration_ms: 200,
      });

      const req = new Request('http://localhost/api/dashboard');
      const res = await apiRouter(req, db.instance);

      const body = await res.json();
      expect(body.success).toBe(true);
      // 전체 기간 집계 시 full-tool이 평균 계산에 반영되어야 함
      expect(body.data.summary.avgDurationMs).toBe(200);
      expect(body.data.summary.p95DurationMs).toBe(200);
    });
  });

  describe('404 Handling', () => {
    it('should return 404 for unknown API endpoint', async () => {
      const req = new Request('http://localhost/api/unknown');
      const res = await apiRouter(req, db.instance);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.success).toBe(false);
    });
  });
});
