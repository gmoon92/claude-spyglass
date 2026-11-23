-- =============================================================================
-- 069 — sessions 에 허브 환경 태그(orca_terminal, hub_role) 추가
-- =============================================================================
-- 배경:
--   Orca 로 띄운 워커 세션과 메인 세션은 cwd·project_name 이 같아(허브 루트) 구분할 단서가 없었다.
--   수집 훅(hooks/spyglass-collect.sh)은 세션 환경에서 도는 bash 라 환경변수를 읽을 수 있다.
--   허용 목록 두 개만 payload 의 hub_env 로 서버에 보내고 세션에 저장한다.
--
-- 컬럼:
--   orca_terminal : ORCA_TERMINAL_HANDLE 값. 세션 ↔ Orca 터미널 연결 키. 없으면 NULL.
--   hub_role      : CLAUDE_HUB_SESSION_ROLE 값('main' | 'worker'). 없으면 NULL(태그 없는 세션).
--
-- 정책:
--   - 기존 행은 NULL 로 남는다(백필 없음). 새로 들어오는 이벤트부터 채운다.
--   - 값 검증(허용 목록·형식)은 서버(hook/hub-env.ts)가 한다. DB 는 TEXT 로만 둔다.
--   - 순수 additive. ADD COLUMN 은 migrator 가 'duplicate column' 을 감지해 건너뛴다(재적용 안전).
--   - /api/sessions* 응답은 `SELECT s.*` 계열이라 두 필드가 자동으로 실린다(기존 필드 변경 없음).
-- =============================================================================

ALTER TABLE sessions ADD COLUMN orca_terminal TEXT;
ALTER TABLE sessions ADD COLUMN hub_role TEXT;

-- 워커 목록·터미널 조인 조회용. 태그가 있는 행만 인덱스에 올린다.
CREATE INDEX IF NOT EXISTS idx_sessions_orca_terminal
  ON sessions(orca_terminal)
  WHERE orca_terminal IS NOT NULL;
