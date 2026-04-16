/**
 * Collect API Integration Tests
 *
 * @description 훅 → 서버 → DB E2E 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  SpyglassDatabase,
  closeDatabase,
  getAllRequests,
  getSessionById,
} from '@spyglass/storage';
import { handleCollect, collectHandler, CollectPayload } from '../collect';

const TEST_DB_PATH = `/tmp/spyglass-collect-test-${Date.now()}.db`;

describe('Collect API', () => {
  let db: SpyglassDatabase;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
  });

  afterEach(() => {
    closeDatabase();
    try {
      require('fs').unlinkSync(TEST_DB_PATH);
    } catch {}
  });

  describe('handleCollect', () => {
    it('should create new session on first request', () => {
      const payload: CollectPayload = {
        id: 'req-1',
        session_id: 'session-1',
        project_name: 'test-project',
        timestamp: Date.now(),
        event_type: 'prompt',
        request_type: 'prompt',
        model: 'claude-sonnet',
        tokens_input: 100,
        tokens_output: 50,
        tokens_total: 150,
        source: 'test',
      };

      const result = handleCollect(db.instance, payload);

      expect(result.success).toBe(true);
      expect(result.saved).toBe(true);

      // 세션 생성 확인
      const session = getSessionById(db.instance, 'session-1');
      expect(session).toBeDefined();
      expect(session?.project_name).toBe('test-project');
    });

    it('should save request with correct data', () => {
      const payload: CollectPayload = {
        id: 'req-2',
        session_id: 'session-2',
        project_name: 'test-project',
        timestamp: 1234567890,
        event_type: 'tool',
        request_type: 'tool_call',
        tool_name: 'Read',
        tokens_input: 50,
        tokens_output: 25,
        tokens_total: 75,
        duration_ms: 500,
        source: 'test',
      };

      handleCollect(db.instance, payload);

      // 요청 저장 확인
      const requests = getAllRequests(db.instance);
      expect(requests).toHaveLength(1);
      expect(requests[0].id).toBe('req-2');
      expect(requests[0].type).toBe('tool_call');
      expect(requests[0].tool_name).toBe('Read');
      expect(requests[0].tokens_total).toBe(75);
    });

    it('should accumulate session tokens', () => {
      const sessionId = 'session-3';

      // 첫 번째 요청
      handleCollect(db.instance, {
        id: 'req-3a',
        session_id: sessionId,
        project_name: 'test',
        timestamp: Date.now(),
        event_type: 'prompt',
        request_type: 'prompt',
        tokens_input: 100,
        tokens_output: 50,
        tokens_total: 150,
        source: 'test',
      });

      // 두 번째 요청
      handleCollect(db.instance, {
        id: 'req-3b',
        session_id: sessionId,
        project_name: 'test',
        timestamp: Date.now(),
        event_type: 'prompt',
        request_type: 'prompt',
        tokens_input: 200,
        tokens_output: 100,
        tokens_total: 300,
        source: 'test',
      });

      // 세션 토큰 누적 확인
      const session = getSessionById(db.instance, sessionId);
      expect(session?.total_tokens).toBe(450); // 150 + 300
    });

    it('should reject invalid payload', () => {
      const result = handleCollect(db.instance, {
        id: '',
        session_id: '',
        project_name: 'test',
        timestamp: Date.now(),
        event_type: 'prompt',
        request_type: 'prompt',
        tokens_input: 0,
        tokens_output: 0,
        tokens_total: 0,
        source: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required fields');
    });
  });

  describe('collectHandler HTTP', () => {
    it('should reject non-POST methods', async () => {
      const req = new Request('http://localhost:9999/collect', { method: 'GET' });
      const res = await collectHandler(req, db);

      expect(res.status).toBe(405);

      const body = await res.json();
      expect(body.error).toBe('Method not allowed');
    });

    it('should handle valid POST request', async () => {
      const payload: CollectPayload = {
        id: 'http-req-1',
        session_id: 'http-session',
        project_name: 'http-test',
        timestamp: Date.now(),
        event_type: 'prompt',
        request_type: 'prompt',
        model: 'claude-sonnet',
        tokens_input: 100,
        tokens_output: 50,
        tokens_total: 150,
        source: 'http-test',
      };

      const req = new Request('http://localhost:9999/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const res = await collectHandler(req, db);

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.saved).toBe(true);

      // CORS 헤더 확인
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should handle invalid JSON', async () => {
      const req = new Request('http://localhost:9999/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });

      const res = await collectHandler(req, db);

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toBe('Invalid JSON payload');
    });
  });

  describe('Multiple requests flow', () => {
    it('should handle multiple requests to same session', () => {
      const sessionId = 'multi-session';
      const requests = [
        { id: 'm1', type: 'prompt', tokens: 100 },
        { id: 'm2', type: 'tool_call', tool: 'Read', tokens: 50 },
        { id: 'm3', type: 'prompt', tokens: 200 },
      ];

      for (const req of requests) {
        handleCollect(db.instance, {
          id: req.id,
          session_id: sessionId,
          project_name: 'multi-test',
          timestamp: Date.now(),
          event_type: req.type,
          request_type: req.type as 'prompt' | 'tool_call',
          tool_name: req.tool,
          tokens_input: req.tokens,
          tokens_output: Math.floor(req.tokens / 2),
          tokens_total: req.tokens,
          source: 'test',
        });
      }

      // 모든 요청 저장 확인
      const allRequests = getAllRequests(db.instance);
      expect(allRequests).toHaveLength(3);

      // 세션 토큰 합계 확인
      const session = getSessionById(db.instance, sessionId);
      expect(session?.total_tokens).toBe(350); // 100 + 50 + 200
    });
  });
});
