/**
 * Session CRUD Tests
 *
 * @description Session 생성/조회/수정/삭제 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  SpyglassDatabase,
  closeDatabase,
  createSession,
  createSessions,
  getSessionById,
  getAllSessions,
  getSessionsWithFilter,
  getSessionsByProject,
  getActiveSessions,
  updateSession,
  endSession,
  updateSessionTokens,
  deleteSession,
  deleteSessions,
  deleteOldSessions,
  getSessionStats,
  getProjectStats,
} from '../index';

const TEST_DB_PATH = `/tmp/spyglass-session-test-${Date.now()}.db`;

describe('Session CRUD', () => {
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

  describe('Create', () => {
    it('should create a session', () => {
      const id = crypto.randomUUID();
      const sessionId = createSession(db.instance, {
        id,
        project_name: 'test-project',
        started_at: Date.now(),
        total_tokens: 0,
      });
      expect(sessionId).toBe(id);

      const session = getSessionById(db.instance, id);
      expect(session).toBeDefined();
      expect(session?.project_name).toBe('test-project');
    });

    it('should create multiple sessions', () => {
      const sessions = [
        { id: crypto.randomUUID(), project_name: 'project-1', started_at: Date.now() },
        { id: crypto.randomUUID(), project_name: 'project-2', started_at: Date.now() },
        { id: crypto.randomUUID(), project_name: 'project-3', started_at: Date.now() },
      ];
      const ids = createSessions(db.instance, sessions);
      expect(ids).toHaveLength(3);

      const allSessions = getAllSessions(db.instance);
      expect(allSessions).toHaveLength(3);
    });
  });

  describe('Read', () => {
    beforeEach(() => {
      // 테스트 데이터 생성
      createSessions(db.instance, [
        { id: 'session-1', project_name: 'project-a', started_at: 1000, total_tokens: 100 },
        { id: 'session-2', project_name: 'project-a', started_at: 2000, total_tokens: 200 },
        { id: 'session-3', project_name: 'project-b', started_at: 3000, total_tokens: 300 },
      ]);
    });

    it('should get session by id', () => {
      const session = getSessionById(db.instance, 'session-1');
      expect(session).toBeDefined();
      expect(session?.project_name).toBe('project-a');
      expect(session?.total_tokens).toBe(100);
    });

    it('should return null for non-existent session', () => {
      const session = getSessionById(db.instance, 'non-existent');
      expect(session).toBeNull();
    });

    it('should get all sessions ordered by started_at DESC', () => {
      const sessions = getAllSessions(db.instance);
      expect(sessions).toHaveLength(3);
      expect(sessions[0].id).toBe('session-3');
      expect(sessions[1].id).toBe('session-2');
      expect(sessions[2].id).toBe('session-1');
    });

    it('should filter sessions by project', () => {
      const sessions = getSessionsByProject(db.instance, 'project-a');
      expect(sessions).toHaveLength(2);
      expect(sessions.every(s => s.project_name === 'project-a')).toBe(true);
    });

    it('should filter sessions with complex options', () => {
      const sessions = getSessionsWithFilter(db.instance, {
        project_name: 'project-a',
        started_after: 1500,
        limit: 10,
      });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('session-2');
    });

    it('should get active sessions (LIVE predicate: ended_at NULL + recent visible request)', () => {
      // 새 LIVE 정의: ended_at NULL 만으로는 부족. 최근 STALE_THRESHOLD 이내
      // visible request가 있어야 LIVE로 분류된다.
      // 이 테스트의 세션들은 requests를 만들지 않았으므로 LIVE 카운트는 0이어야 한다.
      const active = getActiveSessions(db.instance);
      expect(active).toHaveLength(0);
    });
  });

  describe('Update', () => {
    beforeEach(() => {
      createSession(db.instance, {
        id: 'update-test',
        project_name: 'test',
        started_at: Date.now(),
        total_tokens: 0,
      });
    });

    it('should update session ended_at', () => {
      const endedAt = Date.now();
      const updated = updateSession(db.instance, 'update-test', { ended_at: endedAt });
      expect(updated).toBe(true);

      const session = getSessionById(db.instance, 'update-test');
      expect(session?.ended_at).toBe(endedAt);
    });

    it('should update session total_tokens', () => {
      const updated = updateSession(db.instance, 'update-test', { total_tokens: 500 });
      expect(updated).toBe(true);

      const session = getSessionById(db.instance, 'update-test');
      expect(session?.total_tokens).toBe(500);
    });

    it('should end session', () => {
      const now = Date.now();
      const ended = endSession(db.instance, 'update-test', now);
      expect(ended).toBe(true);

      const session = getSessionById(db.instance, 'update-test');
      expect(session?.ended_at).toBe(now);
    });

    it('should update session tokens', () => {
      const updated = updateSessionTokens(db.instance, 'update-test', 1000);
      expect(updated).toBe(true);

      const session = getSessionById(db.instance, 'update-test');
      expect(session?.total_tokens).toBe(1000);
    });

    it('should return false for non-existent session update', () => {
      const updated = updateSession(db.instance, 'non-existent', { total_tokens: 100 });
      expect(updated).toBe(false);
    });
  });

  describe('Delete', () => {
    beforeEach(() => {
      createSessions(db.instance, [
        { id: 'delete-1', project_name: 'test', started_at: Date.now() },
        { id: 'delete-2', project_name: 'test', started_at: Date.now() },
        { id: 'delete-3', project_name: 'test', started_at: Date.now() },
      ]);
    });

    it('should delete a session', () => {
      const deleted = deleteSession(db.instance, 'delete-1');
      expect(deleted).toBe(true);

      const session = getSessionById(db.instance, 'delete-1');
      expect(session).toBeNull();
    });

    it('should delete multiple sessions', () => {
      const count = deleteSessions(db.instance, ['delete-1', 'delete-2']);
      expect(count).toBe(2);

      const allSessions = getAllSessions(db.instance);
      expect(allSessions).toHaveLength(1);
    });

    it('should delete old sessions', () => {
      const count = deleteOldSessions(db.instance, Date.now() + 1000);
      expect(count).toBe(3);

      const allSessions = getAllSessions(db.instance);
      expect(allSessions).toHaveLength(0);
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      createSessions(db.instance, [
        { id: 'stat-1', project_name: 'project-a', started_at: Date.now(), total_tokens: 100 },
        { id: 'stat-2', project_name: 'project-a', started_at: Date.now(), total_tokens: 200 },
        { id: 'stat-3', project_name: 'project-b', started_at: Date.now(), total_tokens: 300 },
      ]);
    });

    it('should get session statistics', () => {
      const stats = getSessionStats(db.instance);
      // 새 정의: total_sessions/total_tokens/avg는 visible 세션만 카운트.
      // 이 테스트의 세션들은 requests 없음 → visible 0 → 모두 0.
      expect(stats.total_sessions).toBe(0);
      expect(stats.total_tokens).toBe(0);
      expect(stats.avg_tokens_per_session).toBe(0);
      expect(stats.active_sessions).toBe(0);
    });

    it('should get project statistics', () => {
      // visible 세션이 0이면 HAVING session_count > 0 으로 제외 → 빈 배열.
      const stats = getProjectStats(db.instance);
      expect(stats).toHaveLength(0);
    });
  });
});
