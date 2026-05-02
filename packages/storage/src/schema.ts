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
  type TEXT NOT NULL CHECK (type IN ('prompt', 'tool_call', 'system', 'response')),
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

-- 인덱스: assignTurnId COUNT 쿼리 최적화 (session_id + type 복합)
CREATE INDEX IF NOT EXISTS idx_requests_session_type ON requests(session_id, type);
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
PRAGMA journal_size_limit = 104857600;  -- 100MB WAL size limit
`;

// =============================================================================
// 초기화 SQL
// =============================================================================

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
  first_prompt_payload?: string | null;
  last_activity_at?: number | null;
}

/**
 * 요청 타입 열거형
 *
 * - 'prompt'    : 사용자 입력 (UserPromptSubmit 훅)
 * - 'tool_call' : 도구 호출 (PreToolUse / PostToolUse 훅)
 * - 'system'    : 시스템 이벤트 (SessionStart, Notification 등)
 * - 'response'  : Claude 응답 (Stop 훅의 last_assistant_message)
 */
export type RequestType = 'prompt' | 'tool_call' | 'system' | 'response';

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
  turn_id?: string;
  model?: string;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  duration_ms: number;
  payload?: string;
  source?: string | null;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  preview?: string | null;
  tool_use_id?: string | null;
  event_type?: string | null;
  tokens_confidence?: string;
  tokens_source?: string;
  parent_tool_use_id?: string | null;
  api_request_id?: string | null;
  // v20: hook raw 페이로드에서 추출한 감사용 메타
  permission_mode?: string | null;
  agent_id?: string | null;
  agent_type?: string | null;
  tool_interrupted?: number | null;
  tool_user_modified?: number | null;
  created_at?: number;
}

// =============================================================================
// 테이블 스키마 메타데이터
// =============================================================================

/**
 * 현재 스키마 버전
 * 마이그레이션 파일 기준: packages/storage/migrations/NNN-*.sql
 *
 * 버전 이력:
 *   - v14: 014-add-proxy-requests.sql (다른 워크트리에서 추가, proxy_requests 테이블)
 *   - v15: 015-proxy-requests-enrich.sql (proxy_requests 컬럼 + correlated_requests VIEW)
 *   - v16: 016-add-response-type.sql (requests.type CHECK 'response' 추가)
 *   - v17: 017-add-parent-tool-use-id.sql (requests.parent_tool_use_id + 인덱스)
 *   - v18: 018-cleanup-and-correlation.sql (sentinel 삭제, visible_requests 제거,
 *           correlated_requests를 prompt+tool_call 매칭으로 재정의)
 *   - v19: 019-proxy-hook-cross-link.sql (proxy_requests.session_id/turn_id,
 *           requests.api_request_id 추가 — 헤더 직접 매칭으로 휴리스틱 대체)
 *   - v20: 020-payload-audit-fields.sql (proxy/hook raw payload에서 발견한
 *           감사·분석용 메타 16개 컬럼 추가)
 *   - v21: 021-proxy-payload-compression.sql (proxy_requests 및 requests에
 *           zstd 압축 payload 저장 컬럼 + system_reminder 추가)
 */
export const SCHEMA_VERSION = 21;

export const SCHEMA_META = {
  version: SCHEMA_VERSION,
  tables: ['sessions', 'requests', 'claude_events', 'proxy_requests'],
  indexes: [
    'idx_sessions_started_at',
    'idx_sessions_project',
    'idx_requests_session',
    'idx_requests_type',
    'idx_requests_tokens',
    'idx_requests_session_type',
    'idx_events_session_time',
    'idx_events_type_time',
    'idx_requests_tool_use_id',
    'idx_requests_parent_tool_use_id',
  ],
} as const;
