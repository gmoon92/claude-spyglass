/**
 * Request CRUD Tests
 *
 * @description Request 생성/조회/수정/삭제 및 집계 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  SpyglassDatabase,
  closeDatabase,
  createSession,
  createRequest,
  createRequests,
  getRequestById,
  getAllRequests,
  getRequestsBySession,
  getRequestsByType,
  getRequestsWithFilter,
  getTopTokenRequests,
  updateRequest,
  deleteRequest,
  deleteOldRequests,
  getRequestStats,
  getRequestStatsBySession,
  getRequestStatsByType,
  getToolStats,
  getHourlyRequestStats,
} from '../index';

const TEST_DB_PATH = `/tmp/spyglass-request-test-${Date.now()}.db`;

describe('Request CRUD', () => {
  let db: SpyglassDatabase;
  let sessionId: string;

  beforeEach(() => {
    db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
    sessionId = crypto.randomUUID();
    createSession(db.instance, {
      id: sessionId,
      project_name: 'test-project',
      started_at: Date.now(),
    });
  });

  afterEach(() => {
    closeDatabase();
    try {
      require('fs').unlinkSync(TEST_DB_PATH);
    } catch {}
  });

  describe('Create', () => {
    it('should create a request', () => {
      const id = crypto.randomUUID();
      const requestId = createRequest(db.instance, {
        id,
        session_id: sessionId,
        timestamp: Date.now(),
        type: 'prompt',
        model: 'claude-sonnet',
        tokens_input: 100,
        tokens_output: 50,
        tokens_total: 150,
        duration_ms: 1000,
      });
      expect(requestId).toBe(id);

      const request = getRequestById(db.instance, id);
      expect(request).toBeDefined();
      expect(request?.type).toBe('prompt');
      expect(request?.tokens_total).toBe(150);
    });

    it('should create tool_call request', () => {
      const id = crypto.randomUUID();
      createRequest(db.instance, {
        id,
        session_id: sessionId,
        timestamp: Date.now(),
        type: 'tool_call',
        tool_name: 'Read',
        tokens_total: 50,
      });

      const request = getRequestById(db.instance, id);
      expect(request?.type).toBe('tool_call');
      expect(request?.tool_name).toBe('Read');
    });

    it('should create multiple requests', () => {
      const requests = [
        { id: crypto.randomUUID(), session_id: sessionId, timestamp: Date.now(), type: 'prompt' as const },
        { id: crypto.randomUUID(), session_id: sessionId, timestamp: Date.now(), type: 'tool_call' as const },
      ];
      const ids = createRequests(db.instance, requests);
      expect(ids).toHaveLength(2);
    });
  });

  describe('Read', () => {
    beforeEach(() => {
      createRequests(db.instance, [
        { id: 'req-1', session_id: sessionId, timestamp: 1000, type: 'prompt', tokens_total: 100 },
        { id: 'req-2', session_id: sessionId, timestamp: 2000, type: 'tool_call', tool_name: 'Read', tokens_total: 50 },
        { id: 'req-3', session_id: sessionId, timestamp: 3000, type: 'prompt', tokens_total: 200 },
      ]);
    });

    it('should get request by id', () => {
      const request = getRequestById(db.instance, 'req-1');
      expect(request).toBeDefined();
      expect(request?.type).toBe('prompt');
      expect(request?.tokens_total).toBe(100);
    });

    it('should return null for non-existent request', () => {
      const request = getRequestById(db.instance, 'non-existent');
      expect(request).toBeNull();
    });

    it('should get all requests ordered by timestamp DESC', () => {
      const requests = getAllRequests(db.instance);
      expect(requests).toHaveLength(3);
      expect(requests[0].id).toBe('req-3');
    });

    it('should get requests by session', () => {
      const requests = getRequestsBySession(db.instance, sessionId);
      expect(requests).toHaveLength(3);
    });

    it('should get requests by type', () => {
      const prompts = getRequestsByType(db.instance, 'prompt');
      expect(prompts).toHaveLength(2);

      const tools = getRequestsByType(db.instance, 'tool_call');
      expect(tools).toHaveLength(1);
      expect(tools[0].tool_name).toBe('Read');
    });

    it('should filter requests with options', () => {
      const requests = getRequestsWithFilter(db.instance, {
        session_id: sessionId,
        min_tokens: 100,
        limit: 10,
      });
      expect(requests).toHaveLength(2);
    });

    it('should get top token requests', () => {
      const top = getTopTokenRequests(db.instance, 2);
      expect(top).toHaveLength(2);
      expect(top[0].tokens_total).toBe(200);
      expect(top[1].tokens_total).toBe(100);
    });
  });

  describe('Update', () => {
    beforeEach(() => {
      createRequest(db.instance, {
        id: 'update-req',
        session_id: sessionId,
        timestamp: Date.now(),
        type: 'prompt',
        duration_ms: 0,
      });
    });

    it('should update request duration', () => {
      const updated = updateRequest(db.instance, 'update-req', { duration_ms: 5000 });
      expect(updated).toBe(true);

      const request = getRequestById(db.instance, 'update-req');
      expect(request?.duration_ms).toBe(5000);
    });

    it('should update request payload', () => {
      const payload = JSON.stringify({ result: 'success' });
      const updated = updateRequest(db.instance, 'update-req', { payload });
      expect(updated).toBe(true);

      const request = getRequestById(db.instance, 'update-req');
      expect(request?.payload).toBe(payload);
    });
  });

  describe('Delete', () => {
    beforeEach(() => {
      createRequests(db.instance, [
        { id: 'del-1', session_id: sessionId, timestamp: Date.now(), type: 'prompt' },
        { id: 'del-2', session_id: sessionId, timestamp: Date.now(), type: 'prompt' },
      ]);
    });

    it('should delete a request', () => {
      const deleted = deleteRequest(db.instance, 'del-1');
      expect(deleted).toBe(true);

      const request = getRequestById(db.instance, 'del-1');
      expect(request).toBeNull();
    });

    it('should delete old requests', () => {
      const count = deleteOldRequests(db.instance, Date.now() + 1000);
      expect(count).toBe(2);

      const all = getAllRequests(db.instance);
      expect(all).toHaveLength(0);
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      createRequests(db.instance, [
        { id: 'stat-1', session_id: sessionId, timestamp: 3600000, type: 'prompt', tokens_input: 100, tokens_output: 50, tokens_total: 150, duration_ms: 1000 },
        { id: 'stat-2', session_id: sessionId, timestamp: 7200000, type: 'tool_call', tool_name: 'Read', tokens_input: 20, tokens_output: 10, tokens_total: 30, duration_ms: 500 },
        { id: 'stat-3', session_id: sessionId, timestamp: 10800000, type: 'prompt', tokens_input: 200, tokens_output: 100, tokens_total: 300, duration_ms: 2000 },
      ]);
    });

    it('should get request statistics', () => {
      const stats = getRequestStats(db.instance);
      expect(stats.total_requests).toBe(3);
      expect(stats.total_tokens_input).toBe(320);
      expect(stats.total_tokens_output).toBe(160);
      expect(stats.total_tokens).toBe(480);
      expect(stats.avg_tokens_per_request).toBe(160);
      expect(stats.avg_duration_ms).toBe(1166.67);
    });

    it('should get session request statistics', () => {
      const stats = getRequestStatsBySession(db.instance, sessionId);
      expect(stats.total_requests).toBe(3);
      expect(stats.total_tokens).toBe(480);
    });

    it('should get request stats by type', () => {
      const stats = getRequestStatsByType(db.instance);
      expect(stats).toHaveLength(2);

      const promptStats = stats.find(s => s.type === 'prompt');
      expect(promptStats?.count).toBe(2);
      expect(promptStats?.total_tokens).toBe(450);

      const toolStats = stats.find(s => s.type === 'tool_call');
      expect(toolStats?.count).toBe(1);
      expect(toolStats?.total_tokens).toBe(30);
    });

    it('should get tool statistics', () => {
      const tools = getToolStats(db.instance);
      expect(tools).toHaveLength(1);
      expect(tools[0].tool_name).toBe('Read');
      expect(tools[0].call_count).toBe(1);
    });

    it('should get hourly request stats', () => {
      const hourly = getHourlyRequestStats(db.instance, sessionId);
      expect(hourly.length).toBeGreaterThan(0);
    });
  });
});
