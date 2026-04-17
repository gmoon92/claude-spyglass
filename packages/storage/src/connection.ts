/**
 * SQLite Database Connection Manager
 *
 * @description WAL 모드 설정 및 연결 풀 관리
 * @see docs/planning/03-adr.md - ADR-002
 */

import { Database } from 'bun:sqlite';
import { INIT_SCHEMA, MIGRATION_V2, MIGRATION_V3, WAL_MODE_PRAGMAS } from './schema';

// =============================================================================
// 설정 상수
// =============================================================================

/** 기본 데이터베이스 경로 */
const DEFAULT_DB_PATH = `${process.env.HOME || process.env.USERPROFILE}/.spyglass/spyglass.db`;

/** 연결 타임아웃 (ms) */
const CONNECT_TIMEOUT_MS = 5000;

/** 재시도 간격 (ms) */
const RETRY_INTERVAL_MS = 100;

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

    if (this.options.debug) {
      console.log(`[SpyglassDB] Connected: ${this.options.dbPath}`);
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
        this.db.run(trimmed);
      }
    }

    if (this.options.debug) {
      // WAL 모드 확인
      const result = this.db.query("PRAGMA journal_mode;").get() as { journal_mode: string };
      console.log(`[SpyglassDB] Journal mode: ${result?.journal_mode}`);
    }
  }

  /** 스키마 초기화 */
  private initializeSchema(): void {
    this.db.exec(INIT_SCHEMA);
    this.runMigrations();
  }

  /** 마이그레이션 실행 */
  private runMigrations(): void {
    const cols = this.db.query('PRAGMA table_info(requests)').all() as Array<{ name: string }>;

    const hasToolDetail = cols.some(c => c.name === 'tool_detail');
    if (!hasToolDetail) {
      this.db.exec(MIGRATION_V2);
    }

    const hasTurnId = cols.some(c => c.name === 'turn_id');
    if (!hasTurnId) {
      this.db.exec(MIGRATION_V3);
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
    this.db.run('PRAGMA wal_checkpoint(TRUNCATE);');
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
