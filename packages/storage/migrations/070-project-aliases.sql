-- =============================================================================
-- 070 — project_aliases (프로젝트 이름 변경 시 사용 이력 합산)
-- =============================================================================
-- 배경:
--   sessions.project_name 은 세션의 첫 이벤트 cwd 마지막 세그먼트로 고정된다(hook/session.ts).
--   저장소 이름이 바뀌면 개명 전에 시작한 세션은 옛 이름을 계속 쓰고, 프로젝트 필터는 이름 하나만 받아
--   `project=<새 이름>` 조회에서 옛 이름 아래 쌓인 이력이 빠진다(예: 메타 문서 호출 빈도가 전부 0 으로 보임).
--
-- 정책:
--   - alias(옛 이름) → project_name(현재 이름). 한 단계만 허용한다(별칭의 별칭 금지 — 서버가 등록 시 검증).
--   - **읽을 때 풀어쓴다.** sessions 등 기존 행은 고치지 않는다 → 이 마이그레이션은 테이블 생성뿐이고,
--     등록하는 순간 과거 이력까지 합쳐 조회된다. 삭제하면 바로 원래대로 돌아간다.
--   - 어느 쪽 이름으로 조회해도 같은 묶음이 나온다(옛 이름 → 현재 이름으로 정규화).
--   - 시드 없음. 개명은 spyglass 가 알 수 없는 사건이라 사용자가 POST /api/projects/aliases 로 등록한다.
--
-- 멱등: CREATE TABLE/INDEX IF NOT EXISTS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_aliases (
  alias        TEXT PRIMARY KEY NOT NULL,   -- 옛 프로젝트 이름 (sessions.project_name 에 남아 있는 값)
  project_name TEXT NOT NULL,               -- 현재(대표) 프로젝트 이름
  note         TEXT,                        -- 메모 (예: 개명 사유·일자)
  created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

-- 대표 이름 → 별칭 목록 조회용
CREATE INDEX IF NOT EXISTS idx_project_aliases_project
  ON project_aliases(project_name);
