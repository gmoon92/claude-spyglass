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
  first_prompt_payload?: string | null;
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
  created_at?: number;
}

// =============================================================================
// 테이블 스키마 메타데이터
// =============================================================================

/**
 * 테이블 스키마 정보 (마이그레이션/검증용)
 */
export const SCHEMA_VERSION = 10;

/**
 * v2 마이그레이션: tool_detail 컬럼 추가
 */
export const MIGRATION_V2 = `
ALTER TABLE requests ADD COLUMN tool_detail TEXT;
`;

/**
 * v3 마이그레이션: turn_id 컬럼 추가 + 기존 데이터 소급 적용
 *
 * turn_id 포맷: "<session_id>-T<순번>" (예: "abc123-T1")
 * - prompt 레코드: 세션 내 순번으로 채번
 * - tool_call/system 레코드: 직전 prompt의 turn_id 전파
 */
export const MIGRATION_V3 = `
ALTER TABLE requests ADD COLUMN turn_id TEXT;
CREATE INDEX IF NOT EXISTS idx_requests_turn ON requests(turn_id);

UPDATE requests
SET turn_id = session_id || '-T' || ((
  SELECT COUNT(*)
  FROM requests r2
  WHERE r2.session_id = requests.session_id
    AND r2.type = 'prompt'
    AND r2.timestamp < requests.timestamp
) + 1)
WHERE type = 'prompt';

UPDATE requests
SET turn_id = (
  SELECT r2.turn_id
  FROM requests r2
  WHERE r2.session_id = requests.session_id
    AND r2.type = 'prompt'
    AND r2.timestamp <= requests.timestamp
  ORDER BY r2.timestamp DESC
  LIMIT 1
)
WHERE type IN ('tool_call', 'system')
  AND turn_id IS NULL;
`;

/**
 * v4 마이그레이션: source 컬럼 추가
 */
export const MIGRATION_V4 = `
ALTER TABLE requests ADD COLUMN source TEXT;
`;

/**
 * v5 마이그레이션: 캐시 토큰 컬럼 추가
 */
export const MIGRATION_V5 = `
ALTER TABLE requests ADD COLUMN cache_creation_tokens INTEGER DEFAULT 0;
ALTER TABLE requests ADD COLUMN cache_read_tokens INTEGER DEFAULT 0;
`;

/**
 * v7 마이그레이션: requests에 preview 컬럼 추가 (프롬프트 내용 미리보기)
 */
export const MIGRATION_V7 = `
ALTER TABLE requests ADD COLUMN preview TEXT;
`;

/**
 * v6 마이그레이션: claude_events 테이블 추가 (raw hook payload 전체 수집)
 */
export const MIGRATION_V6 = `
CREATE TABLE IF NOT EXISTS claude_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    session_id TEXT NOT NULL,
    transcript_path TEXT,
    cwd TEXT,
    agent_id TEXT,
    agent_type TEXT,
    timestamp INTEGER NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    schema_version INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_events_session_time ON claude_events(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_type_time ON claude_events(event_type, timestamp);
`;

/**
 * v8 마이그레이션: tool_use_id 컬럼 추가 (Pre/Post 페어링 키)
 *                  event_type 컬럼 추가 ('pre_tool' | 'tool' | null)
 *
 * Upsert 패턴:
 *  - PreToolUse → event_type='pre_tool' INSERT
 *  - PostToolUse → event_type='tool' → 동일 tool_use_id의 pre_tool 레코드 UPDATE
 *
 * 기존 데이터 역추출:
 *  - id LIKE 'p-%' AND type='tool_call' → event_type='pre_tool'
 *  - id LIKE 't-%' AND type='tool_call' → event_type='tool'
 */
export const MIGRATION_V8 = `
ALTER TABLE requests ADD COLUMN tool_use_id TEXT DEFAULT NULL;
ALTER TABLE requests ADD COLUMN event_type TEXT DEFAULT NULL;
UPDATE requests SET event_type = 'pre_tool' WHERE id LIKE 'p-%' AND type = 'tool_call';
UPDATE requests SET event_type = 'tool' WHERE id LIKE 't-%' AND type = 'tool_call';
CREATE INDEX IF NOT EXISTS idx_requests_tool_use_id ON requests(tool_use_id) WHERE tool_use_id IS NOT NULL;
`;

/**
 * v9 마이그레이션: Skill/Agent tool_detail 개선
 *
 * 훅 스크립트 변경으로 인해 Skill/Agent 호출 시 tool_detail 저장 방식이 변경됨:
 * - 기존: args/description 저장 → 화면에 "Skill(인자내용)" 표시
 * - 개선: skill 이름 저장 → 화면에 "Skill(backend-workflow)" 표시
 *
 * 이 마이그레이션은 기존 데이터를 새 형식으로 업데이트합니다.
 * 메시지 컬럼은 payload에서 별도로 노출되므로 정보 손실 없음.
 */
export const MIGRATION_V9 = `
-- Skill: tool_detail을 skill 이름으로 업데이트
-- != 조건으로 멱등성 보장 (동일 마이그레이션 반복 실행 가능)
-- 콜론 포함 스킬 이름(document-skills:theme-factory 등)도 정상 처리
UPDATE requests
SET tool_detail = json_extract(payload, '$.tool_input.skill')
WHERE tool_name = 'Skill'
  AND json_valid(payload)
  AND json_extract(payload, '$.tool_input.skill') IS NOT NULL
  AND (
    tool_detail IS NULL
    OR tool_detail != json_extract(payload, '$.tool_input.skill')
  );

-- Agent: tool_detail을 description으로 업데이트 (이미 된 경우 제외)
UPDATE requests
SET tool_detail = json_extract(payload, '$.tool_input.description')
WHERE tool_name = 'Agent'
  AND json_valid(payload)
  AND json_extract(payload, '$.tool_input.description') IS NOT NULL
  AND (
    tool_detail IS NULL
    OR tool_detail != json_extract(payload, '$.tool_input.description')
  );
`;

/**
 * v10 마이그레이션: 기존 100자로 잘린 preview를 payload에서 재추출 (최대 2000자)
 *
 * v7에서 preview 컬럼이 추가되었으나, 서버 측 extractPreview()가 100자로 제한하여
 * 저장하였음. 이 마이그레이션은 payload JSON에서 prompt 필드를 2000자까지 재추출하여
 * preview를 복원한다. SQLite TEXT 타입은 길이 제한이 없으므로 DDL 변경 불필요.
 *
 * 조건: type='prompt' AND payload NOT NULL AND json_valid(payload)
 * 멱등성: json_extract(...) IS NOT NULL 조건으로 payload 없는 행은 건드리지 않음
 */
export const MIGRATION_V10 = `
UPDATE requests
SET preview = substr(json_extract(payload, '$.prompt'), 1, 2000)
WHERE type = 'prompt'
  AND payload IS NOT NULL
  AND json_valid(payload)
  AND json_extract(payload, '$.prompt') IS NOT NULL;
`;

export const SCHEMA_META = {
  version: SCHEMA_VERSION,
  tables: ['sessions', 'requests', 'claude_events'],
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
  ],
} as const;
