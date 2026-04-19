/**
 * SQLite Database Connection Manager
 *
 * @description WAL 모드 설정 및 연결 풀 관리
 * @see docs/planning/03-adr.md - ADR-002
 */

import { Database } from 'bun:sqlite';
import { INIT_SCHEMA, MIGRATION_V2, MIGRATION_V3, MIGRATION_V4, MIGRATION_V5, MIGRATION_V6, MIGRATION_V7, MIGRATION_V8, MIGRATION_V9, MIGRATION_V10, MIGRATION_V12, WAL_MODE_PRAGMAS } from './schema';
import fs from 'fs';

// =============================================================================
// 설정 상수
// =============================================================================

/** 기본 데이터베이스 경로 */
const DEFAULT_DB_PATH = `${process.env.HOME || process.env.USERPROFILE}/.spyglass/spyglass.db`;

// =============================================================================
// 연결 설정 옵션
// =============================================================================

/**
 * 데이터베이스 연결 옵션
 */
export interface ConnectionOptions {
  /** 데이터베이스 파일 경로 */
  dbPath?: string;
  /** WAL 모드 활성화 여부 */
  walMode?: boolean;
  /** 초기 스키마 자동 생성 여부 */
  autoInit?: boolean;
  /** 디버그 로깅 활성화 */
  debug?: boolean;
}

/** 기본 옵션 */
const DEFAULT_OPTIONS: Required<ConnectionOptions> = {
  dbPath: DEFAULT_DB_PATH,
  walMode: true,
  autoInit: true,
  debug: false,
};

// =============================================================================
// Database 클래스 확장
// =============================================================================

/**
 * spyglass 전용 Database 인스턴스
 */
export class SpyglassDatabase {
  private db: Database;
  private options: Required<ConnectionOptions>;

  constructor(options: ConnectionOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // 디렉토리 생성
    const dbDir = this.options.dbPath.substring(0, this.options.dbPath.lastIndexOf('/'));
    this.ensureDirectory(dbDir);

    // 데이터베이스 연결
    this.db = new Database(this.options.dbPath, { create: true });

    // WAL 모드 설정
    if (this.options.walMode) {
      this.enableWalMode();
    }

    // 스키마 초기화
    if (this.options.autoInit) {
      this.initializeSchema();
    }

    // 파일 권한 강화 (스키마 초기화 후)
    this.applyFilePermissions();

    if (this.options.debug) {
      console.log(`[SpyglassDB] Connected: ${this.options.dbPath}`);
    }
  }

  /** 파일 권한 강화 (chmod) */
  private applyFilePermissions(): void {
    try {
      // DB 파일이 존재해야만 권한 변경 가능
      if (!fs.existsSync(this.options.dbPath)) {
        return;
      }

      // DB 파일 권한: 600 (소유자만 읽기/쓰기)
      const dbDir = this.options.dbPath.substring(0, this.options.dbPath.lastIndexOf('/'));

      try {
        fs.chmodSync(this.options.dbPath, 0o600);
      } catch (error) {
        // 개별 파일 권한 변경 실패는 무시 (발생 가능: /tmp, readonly fs 등)
        if (this.options.debug) {
          console.warn(`[SpyglassDB] Could not chmod DB file: ${error}`);
        }
      }

      // 상위 디렉토리 권한: 700 (소유자만 접근)
      try {
        fs.chmodSync(dbDir, 0o700);
      } catch (error) {
        // 디렉토리 권한 변경 실패도 무시 (발생 가능: /tmp, readonly fs 등)
        if (this.options.debug) {
          console.warn(`[SpyglassDB] Could not chmod DB dir: ${error}`);
        }
      }

      if (this.options.debug) {
        console.log(`[SpyglassDB] Attempted to apply file permissions: ${this.options.dbPath} (600), ${dbDir} (700)`);
      }
    } catch (error) {
      // 예기치 않은 에러는 경고만 하고 진행
      console.warn(`[SpyglassDB] Warning: Failed to set file permissions: ${error}`);
    }
  }

  /** 디렉토리 생성 */
  private ensureDirectory(dir: string): void {
    try {
      // Bun.file API로 디렉토리 존재 여부 확인
      const dirInfo = Bun.file(dir);
      if (!dirInfo.exists) {
        // Bun.write로 빈 디렉토리 마커 생성
        Bun.write(`${dir}/.gitkeep`, '');
        // 파일 삭제하고 디렉토리만 남기기
        try {
          require('fs').mkdirSync(dir, { recursive: true });
        } catch {
          // 이미 존재하면 무시
        }
      }
    } catch (error) {
      // Node.js fs fallback
      const fs = require('fs');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /** WAL 모드 활성화 */
  private enableWalMode(): void {
    const pragmas = WAL_MODE_PRAGMAS.split(';').filter(p => p.trim());

    for (const pragma of pragmas) {
      const trimmed = pragma.trim();
      if (trimmed) {
        this.db.prepare(trimmed).run();
      }
    }

    if (this.options.debug) {
      // WAL 모드 확인
      const result = this.db.query("PRAGMA journal_mode;").get() as { journal_mode: string };
      console.log(`[SpyglassDB] Journal mode: ${result?.journal_mode}`);
    }
  }

  /** 멀티 스테이트먼트 SQL 실행 (라인 주석 제거 후 세미콜론 분리) */
  private execMulti(sql: string): void {
    const stmts = sql
      .replace(/--[^\n]*/g, '')
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    for (const stmt of stmts) {
      this.db.prepare(stmt).run();
    }
  }

  /** 스키마 초기화 */
  private initializeSchema(): void {
    this.execMulti(INIT_SCHEMA);
    this.runMigrations();
  }

  /** 마이그레이션 실행 */
  private runMigrations(): void {
    const cols = this.db.query('PRAGMA table_info(requests)').all() as Array<{ name: string }>;

    const hasToolDetail = cols.some(c => c.name === 'tool_detail');
    if (!hasToolDetail) {
      this.db.prepare(MIGRATION_V2.trim()).run();
    }

    const hasTurnId = cols.some(c => c.name === 'turn_id');
    if (!hasTurnId) {
      this.execMulti(MIGRATION_V3);
    }

    const hasSource = cols.some(c => c.name === 'source');
    if (!hasSource) {
      this.db.prepare(MIGRATION_V4.trim()).run();
    }

    const hasCacheTokens = cols.some(c => c.name === 'cache_creation_tokens');
    if (!hasCacheTokens) {
      this.execMulti(MIGRATION_V5);
    }

    const tables = this.db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const hasEventsTable = tables.some(t => t.name === 'claude_events');
    if (!hasEventsTable) {
      this.execMulti(MIGRATION_V6);
    }

    const hasPreview = cols.some(c => c.name === 'preview');
    if (!hasPreview) {
      this.db.prepare(MIGRATION_V7.trim()).run();
    }

    const hasToolUseId = cols.some(c => c.name === 'tool_use_id');
    if (!hasToolUseId) {
      this.execMulti(MIGRATION_V8);
    }

    // V9: user_version 기반 실행 (데이터 마이그레이션)
    const currentVersion = this.db.query('PRAGMA user_version').get() as { user_version: number };
    if (currentVersion.user_version < 9) {
      this.execMulti(MIGRATION_V9);
      this.db.prepare('PRAGMA user_version = 9').run();
    }

    // V10: preview 컬럼 재추출 (100자 → 2000자)
    // payload JSON의 prompt 필드를 2000자까지 재저장하여 기존 truncation 복원
    if (currentVersion.user_version < 10) {
      this.execMulti(MIGRATION_V10);
      this.db.prepare('PRAGMA user_version = 10').run();
    }

    // V12: timestamp 인덱스 + visible_requests VIEW
    if (currentVersion.user_version < 12) {
      try {
        // 인덱스 생성
        this.db.prepare('CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp DESC)').run();
        // VIEW 생성 (별도 실행)
        this.db.prepare('DROP VIEW IF EXISTS visible_requests').run();
        this.db.prepare(
          `CREATE VIEW visible_requests AS
           SELECT * FROM requests
           WHERE event_type IS NULL
              OR event_type != 'pre_tool'
              OR tool_name = 'Agent'`
        ).run();
        this.db.prepare('PRAGMA user_version = 12').run();
      } catch (error) {
        console.error('[SpyglassDB] Error applying V12 migration:', error);
        throw error;
      }
    }
  }

  /** 원본 Database 인스턴스 반환 */
  get instance(): Database {
    return this.db;
  }

  /** 연결 종료 */
  close(): void {
    this.db.close();
    if (this.options.debug) {
      console.log(`[SpyglassDB] Closed: ${this.options.dbPath}`);
    }
  }

  /** WAL 체크포인트 수행 */
  checkpoint(): void {
    this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE);').run();
  }

  /** 데이터베이스 상태 정보 */
  getStatus(): DatabaseStatus {
    const journalMode = this.db.query("PRAGMA journal_mode;").get() as { journal_mode: string };
    const walSize = this.db.query("PRAGMA wal_checkpoint;").get() as
      | { busy: number; log: number; checkpointed: number }
      | undefined;

    return {
      path: this.options.dbPath,
      journalMode: journalMode?.journal_mode || 'unknown',
      walSize: walSize?.log || 0,
      isOpen: true,
    };
  }
}

/**
 * 데이터베이스 상태 정보
 */
export interface DatabaseStatus {
  path: string;
  journalMode: string;
  walSize: number;
  isOpen: boolean;
}

// =============================================================================
// 싱글톤 연결 관리자
// =============================================================================

/** 싱글톤 인스턴스 */
let globalInstance: SpyglassDatabase | null = null;

/**
 * 데이터베이스 인스턴스 가져오기 (싱글톤)
 */
export function getDatabase(options?: ConnectionOptions): SpyglassDatabase {
  if (!globalInstance) {
    globalInstance = new SpyglassDatabase(options);
  }
  return globalInstance;
}

/**
 * 데이터베이스 연결 종료
 */
export function closeDatabase(): void {
  if (globalInstance) {
    globalInstance.close();
    globalInstance = null;
  }
}

/**
 * 연결 재설정 (테스트용)
 */
export function resetDatabase(options?: ConnectionOptions): SpyglassDatabase {
  closeDatabase();
  return getDatabase(options);
}

// =============================================================================
// 유틸리티 함수
// =============================================================================

/**
 * 데이터베이스 파일 경로 반환
 */
export function getDefaultDbPath(): string {
  return DEFAULT_DB_PATH;
}

/**
 * 데이터베이스 존재 여부 확인
 */
export function databaseExists(dbPath?: string): boolean {
  const path = dbPath || DEFAULT_DB_PATH;
  try {
    const fs = require('fs');
    return fs.existsSync(path);
  } catch {
    return false;
  }
}
