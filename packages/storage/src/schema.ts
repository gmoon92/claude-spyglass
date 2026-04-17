/**
 * SQLite Database Schema for spyglass
 *
 * @description Session 및 Request 테이블 정의
 * @see docs/planning/02-prd.md - 데이터 모델 섹션
 */

// =============================================================================
// 테이블 생성 SQL
// =============================================================================

/**
 * Session 테이블: Claude Code 세션 단위 정보 저장
 */
export const CREATE_SESSION_TABLE = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  total_tokens INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- 인덱스: 시작 시간 기준 내림차순 (최근 세션 조회용)
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);

-- 인덱스: 프로젝트명 기준 조회
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_name);
`;

/**
 * Request 테이블: 개별 API 요청 정보 저장
 */
export const CREATE_REQUEST_TABLE = `
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('prompt', 'tool_call', 'system')),
  tool_name TEXT,
  model TEXT,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  tokens_total INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  payload TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- 인덱스: 세션별 요청 조회
CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id, timestamp DESC);

-- 인덱스: 타입별 요청 조회
CREATE INDEX IF NOT EXISTS idx_requests_type ON requests(type, timestamp DESC);

-- 인덱스: 토큰 사용량 기준 상위 요청 조회
CREATE INDEX IF NOT EXISTS idx_requests_tokens ON requests(tokens_total DESC);
`;

// =============================================================================
// WAL 모드 설정
// =============================================================================

/**
 * WAL 모드 및 성능 최적화 PRAGMA 설정
 * @see docs/planning/03-adr.md - ADR-002
 */
export const WAL_MODE_PRAGMAS = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;  -- 64MB cache
PRAGMA foreign_keys = ON;
`;

// =============================================================================
// 초기화 SQL
// =============================================================================

/**
 * 모든 테이블 생성을 위한 통합 SQL
 */
export const INIT_SCHEMA = `
${WAL_MODE_PRAGMAS}

${CREATE_SESSION_TABLE}

${CREATE_REQUEST_TABLE}
`;

// =============================================================================
// 타입 정의 (런타임용)
// =============================================================================

/**
 * 세션 엔티티 타입
 */
export interface Session {
  id: string;
  project_name: string;
  started_at: number;
  ended_at: number | null;
  total_tokens: number;
  created_at?: number;
}

/**
 * 요청 타입 열거형
 */
export type RequestType = 'prompt' | 'tool_call' | 'system';

/**
 * 요청 엔티티 타입
 */
export interface Request {
  id: string;
  session_id: string;
  timestamp: number;
  type: RequestType;
  tool_name?: string;
  tool_detail?: string;
  model?: string;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  duration_ms: number;
  payload?: string;
  created_at?: number;
}

// =============================================================================
// 테이블 스키마 메타데이터
// =============================================================================

/**
 * 테이블 스키마 정보 (마이그레이션/검증용)
 */
export const SCHEMA_VERSION = 2;

/**
 * v2 마이그레이션: tool_detail 컬럼 추가
 */
export const MIGRATION_V2 = `
ALTER TABLE requests ADD COLUMN tool_detail TEXT;
`;

export const SCHEMA_META = {
  version: SCHEMA_VERSION,
  tables: ['sessions', 'requests'],
  indexes: [
    'idx_sessions_started_at',
    'idx_sessions_project',
    'idx_requests_session',
    'idx_requests_type',
    'idx_requests_tokens',
  ],
} as const;
