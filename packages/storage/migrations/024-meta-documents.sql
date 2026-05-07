-- Migration 024: 메타 문서 카탈로그 + 슬래시 커맨드 추출
--
-- 책임
--  - Claude Code 메타 문서(에이전트/스킬/슬래시 커맨드) 카탈로그를 DB에 보존
--  - 동일 이름이 여러 source(user/project/...)에 있을 수 있으므로 multi-source row 모델
--  - cwd → 호출 매핑(meta_doc_resolutions)을 별도 테이블로 분리하여 source precedence 해소
--  - requests.slash_command 컬럼으로 사용자 슬래시 커맨드 호출을 직접 매칭 가능하게 함
--  - v_meta_doc_usage VIEW로 (agent / skill / command) 통합 집계
--
-- 설계 근거: round-2 회의 결과 — DB 아키텍트(분리), Lifecycle(realpath/soft-delete), 집계 전략가(VIEW + 인덱스)

-- =============================================================================
-- (1) 카탈로그: 발견된 모든 정의 (multi-source row)
-- =============================================================================
-- UNIQUE(type, name, source, source_root)
--   - 동일 이름이 user / project A / project B 에 모두 있으면 3개 row
--   - 호출 매칭은 meta_doc_resolutions가 cwd 기준 winning source를 결정
-- source_root: project면 git root realpath, user면 ~/.claude, built-in/bundled면 NULL
CREATE TABLE IF NOT EXISTS meta_documents (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    type             TEXT NOT NULL CHECK (type IN ('agent', 'skill', 'command')),
    name             TEXT NOT NULL,
    source           TEXT NOT NULL CHECK (source IN (
                       'built-in', 'plugin', 'userSettings', 'projectSettings',
                       'policySettings', 'bundled', 'unknown'
                     )),
    source_root      TEXT,
    file_path        TEXT,
    description      TEXT,
    user_invocable   INTEGER NOT NULL DEFAULT 0,
    frontmatter_json TEXT,
    first_seen_at    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    last_seen_at     INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    deleted_at       INTEGER,
    UNIQUE (type, name, source, source_root)
);

CREATE INDEX IF NOT EXISTS idx_meta_docs_type_name
    ON meta_documents(type, name)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_meta_docs_source_root
    ON meta_documents(source_root)
    WHERE source_root IS NOT NULL;

-- =============================================================================
-- (2) cwd별 호출 매핑 — Agent/Command precedence 해소용
-- =============================================================================
-- claude-code 우선순위: managed > project(deepest) > user > plugin > built-in
-- 매번 호출마다 chain을 다시 풀지 않고 SessionStart 동기화 끝에 한 번에 계산해 저장
CREATE TABLE IF NOT EXISTS meta_doc_resolutions (
    cwd              TEXT NOT NULL,
    type             TEXT NOT NULL,
    name             TEXT NOT NULL,
    meta_document_id INTEGER NOT NULL REFERENCES meta_documents(id) ON DELETE CASCADE,
    resolved_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    PRIMARY KEY (cwd, type, name)
);

CREATE INDEX IF NOT EXISTS idx_meta_doc_res_doc
    ON meta_doc_resolutions(meta_document_id);

-- =============================================================================
-- (3) 슬래시 커맨드 추출 컬럼 + 부분 인덱스
-- =============================================================================
-- UserPromptSubmit hook 처리 시 prompt 페이로드에서 <command-name>X</command-name> 패턴 추출.
-- 기존 prompt 행에 대해서는 backfill로 채움.
ALTER TABLE requests ADD COLUMN slash_command TEXT;

CREATE INDEX IF NOT EXISTS idx_requests_slash
    ON requests(slash_command)
    WHERE slash_command IS NOT NULL;

-- 메타 문서 매칭용 부분 인덱스: 집계 전략가 권고
CREATE INDEX IF NOT EXISTS idx_requests_meta_doc
    ON requests(tool_name, tool_detail)
    WHERE tool_name IN ('Agent', 'Skill');

-- backfill: 기존 prompt 페이로드에서 <command-name>...</command-name> 추출
--  - extractSlashCommand(slash-command.ts)와 동일 정규화 — 선행 '/' 제거.
--  - 카탈로그(meta_documents.name)와 직접 매칭되도록 정리된 이름만 저장.
UPDATE requests
SET slash_command = TRIM(
    substr(
        payload,
        instr(payload, '<command-name>') + length('<command-name>'),
        instr(payload, '</command-name>')
            - instr(payload, '<command-name>')
            - length('<command-name>')
    ),
    '/ '
)
WHERE type = 'prompt'
  AND payload IS NOT NULL
  AND payload LIKE '%<command-name>%</command-name>%'
  AND slash_command IS NULL;

-- =============================================================================
-- (4) 집계 VIEW — 실시간 GROUP BY (idx_requests_meta_doc + idx_requests_slash 사용)
-- =============================================================================
-- agent / skill / command를 단일 (type, name, ...) 결과로 통합. UI는 카탈로그와 LEFT JOIN.
CREATE VIEW IF NOT EXISTS v_meta_doc_usage AS
    SELECT
        'agent'           AS type,
        tool_detail       AS name,
        COUNT(*)          AS invocations,
        COALESCE(SUM(tokens_total), 0)    AS total_tokens,
        COALESCE(SUM(duration_ms), 0)     AS total_duration_ms,
        MAX(timestamp)    AS last_used_at,
        MIN(timestamp)    AS first_used_at
    FROM requests
    WHERE tool_name = 'Agent' AND tool_detail IS NOT NULL
    GROUP BY tool_detail
    UNION ALL
    SELECT
        'skill', tool_detail, COUNT(*),
        COALESCE(SUM(tokens_total), 0),
        COALESCE(SUM(duration_ms), 0),
        MAX(timestamp), MIN(timestamp)
    FROM requests
    WHERE tool_name = 'Skill' AND tool_detail IS NOT NULL
    GROUP BY tool_detail
    UNION ALL
    SELECT
        'command', slash_command, COUNT(*),
        COALESCE(SUM(tokens_total), 0),
        COALESCE(SUM(duration_ms), 0),
        MAX(timestamp), MIN(timestamp)
    FROM requests
    WHERE slash_command IS NOT NULL AND slash_command != ''
    GROUP BY slash_command;
