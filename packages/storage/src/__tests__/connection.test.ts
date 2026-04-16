/**
 * Database Connection Tests
 *
 * @description WAL 모드, 연결 관리 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  SpyglassDatabase,
  getDatabase,
  closeDatabase,
  resetDatabase,
  getDefaultDbPath,
  databaseExists,
} from '../connection';

// 테스트용 임시 DB 경로
const TEST_DB_PATH = `/tmp/spyglass-test-${Date.now()}.db`;

describe('Connection', () => {
  afterEach(() => {
    closeDatabase();
    // 임시 DB 파일 정리
    try {
      require('fs').unlinkSync(TEST_DB_PATH);
    } catch {}
  });

  describe('SpyglassDatabase', () => {
    it('should create database with default options', () => {
      const db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, debug: false });
      expect(db.instance).toBeDefined();
      expect(db.instance).toBeInstanceOf(Database);
      db.close();
    });

    it('should enable WAL mode by default', () => {
      const db = new SpyglassDatabase({ dbPath: TEST_DB_PATH });
      const status = db.getStatus();
      expect(status.journalMode).toBe('wal');
      db.close();
    });

    it('should return correct status', () => {
      const db = new SpyglassDatabase({ dbPath: TEST_DB_PATH });
      const status = db.getStatus();
      expect(status.path).toBe(TEST_DB_PATH);
      expect(status.isOpen).toBe(true);
      expect(status.journalMode).toBe('wal');
      db.close();
    });

    it('should close connection properly', () => {
      const db = new SpyglassDatabase({ dbPath: TEST_DB_PATH });
      db.close();
      expect(db.getStatus().isOpen).toBe(false);
    });

    it('should auto-initialize schema', () => {
      const db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true });
      // 테이블이 생성되었는지 확인
      const tables = db.instance.query(
        "SELECT name FROM sqlite_master WHERE type='table'"
      ).all() as { name: string }[];
      const tableNames = tables.map(t => t.name);
      expect(tableNames).toContain('sessions');
      expect(tableNames).toContain('requests');
      db.close();
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance with getDatabase', () => {
      const db1 = getDatabase({ dbPath: TEST_DB_PATH });
      const db2 = getDatabase({ dbPath: TEST_DB_PATH });
      expect(db1).toBe(db2);
    });

    it('should close global instance', () => {
      const db = getDatabase({ dbPath: TEST_DB_PATH });
      expect(db.getStatus().isOpen).toBe(true);
      closeDatabase();
      // 새 인스턴스를 생성해야 함
      const newDb = getDatabase({ dbPath: TEST_DB_PATH });
      expect(newDb.getStatus().isOpen).toBe(true);
    });

    it('should reset database', () => {
      const db1 = getDatabase({ dbPath: TEST_DB_PATH });
      const db2 = resetDatabase({ dbPath: TEST_DB_PATH });
      expect(db1).not.toBe(db2);
      expect(db2.getStatus().isOpen).toBe(true);
    });
  });

  describe('Utility Functions', () => {
    it('should return default DB path', () => {
      const path = getDefaultDbPath();
      expect(path).toContain('.spyglass/spyglass.db');
    });

    it('should check database existence', () => {
      expect(databaseExists(TEST_DB_PATH)).toBe(false);
      const db = new SpyglassDatabase({ dbPath: TEST_DB_PATH });
      db.close();
      expect(databaseExists(TEST_DB_PATH)).toBe(true);
    });
  });
});
