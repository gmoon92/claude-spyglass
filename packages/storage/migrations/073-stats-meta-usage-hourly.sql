-- =============================================================================
-- 073 — stats_meta_usage_hourly: 스킬·에이전트·슬래시 명령 호출/실패 시간별 요약 (허브 요약 #1)
-- =============================================================================
-- 배경:
--   허브는 스킬·에이전트·명령별 호출 수와 실패율의 일별 추이가 필요하다. 지금은 /api/meta-docs 가
--   매번 requests 전체를 GROUP BY 하고(v_meta_doc_usage), 실패율은 낼 수 없으며, 원본은 30일 뒤 사라진다.
--
-- 설계:
--   - 키: (hour_ts, session_id, kind, name). kind = 'skill' | 'agent' | 'command'.
--   - calls·tokens_total·duration_ms_sum: requests 트리거가 올린다(v_meta_doc_usage 와 같은 대상).
--       · Skill/Agent 는 확정된 도구 행만 센다. PreToolUse 로 먼저 들어온 pre_tool 행은 세지 않고,
--         PostToolUse 가 그 행을 'tool' 로 바꾸는 순간(UPDATE) 센다 — trg_stats_after_update 와 같은 규칙.
--       · 슬래시 명령은 slash_command 가 채워진 행(INSERT 시, 또는 나중에 처음 채워질 때).
--   - failures: SQL 로 셀 수 없다(실패 정보는 claude_events.payload 안에 있고 payload 는 zstd 로 저장된다).
--     서버 훅 처리 경로(events.ts)가 PostToolUseFailure 를 받을 때 올린다. 과거분은 서버 기동 시 1회
--     storage backfillMetaUsageFailures 가 채운다. 범위: Skill/Agent 호출 자체 오류만(사용자 중단 제외).
--   - 실패한 호출은 PostToolUse 가 오지 않아 calls 에 들어가지 않는다 → 시도 수 = calls + failures.
--   - project_name: 행이 들어올 때 sessions 에서 복사(세션 행이 30일 뒤 지워져도 남게). 읽을 때 별칭 적용.
--   - 보존 365일: storage queries/session/retention.ts pruneSummaryTables 가 자른다.
-- =============================================================================

CREATE TABLE IF NOT EXISTS stats_meta_usage_hourly (
  hour_ts         INTEGER NOT NULL,
  session_id      TEXT    NOT NULL,
  kind            TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  project_name    TEXT,
  calls           INTEGER NOT NULL DEFAULT 0,
  failures        INTEGER NOT NULL DEFAULT 0,
  tokens_total    INTEGER NOT NULL DEFAULT 0,
  duration_ms_sum INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (hour_ts, session_id, kind, name)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_stats_meta_usage_hourly_name
  ON stats_meta_usage_hourly(kind, name, hour_ts);

-- Skill/Agent — 확정 행으로 바로 들어온 경우(pre_tool 단계 없이 INSERT)
CREATE TRIGGER IF NOT EXISTS trg_meta_usage_after_insert_tool
AFTER INSERT ON requests
WHEN NEW.tool_name IN ('Skill', 'Agent') AND NEW.tool_detail IS NOT NULL
 AND (NEW.event_type IS NULL OR NEW.event_type != 'pre_tool')
BEGIN
  INSERT INTO stats_meta_usage_hourly (hour_ts, session_id, kind, name, project_name, calls, tokens_total, duration_ms_sum, updated_at)
  VALUES (
    (NEW.timestamp / 1000 / 3600) * 3600, NEW.session_id,
    CASE NEW.tool_name WHEN 'Agent' THEN 'agent' ELSE 'skill' END, NEW.tool_detail,
    (SELECT s.project_name FROM sessions s WHERE s.id = NEW.session_id),
    1, COALESCE(NEW.tokens_total, 0), COALESCE(NEW.duration_ms, 0), strftime('%s','now')
  )
  ON CONFLICT(hour_ts, session_id, kind, name) DO UPDATE SET
    calls           = calls + 1,
    tokens_total    = tokens_total + excluded.tokens_total,
    duration_ms_sum = duration_ms_sum + excluded.duration_ms_sum,
    project_name    = COALESCE(project_name, excluded.project_name),
    updated_at      = strftime('%s','now');
END;

-- Skill/Agent — pre_tool 행이 PostToolUse 로 확정되는 순간
CREATE TRIGGER IF NOT EXISTS trg_meta_usage_after_update_tool
AFTER UPDATE OF event_type ON requests
WHEN OLD.event_type = 'pre_tool' AND NEW.event_type = 'tool'
 AND NEW.tool_name IN ('Skill', 'Agent') AND NEW.tool_detail IS NOT NULL
BEGIN
  INSERT INTO stats_meta_usage_hourly (hour_ts, session_id, kind, name, project_name, calls, tokens_total, duration_ms_sum, updated_at)
  VALUES (
    (NEW.timestamp / 1000 / 3600) * 3600, NEW.session_id,
    CASE NEW.tool_name WHEN 'Agent' THEN 'agent' ELSE 'skill' END, NEW.tool_detail,
    (SELECT s.project_name FROM sessions s WHERE s.id = NEW.session_id),
    1, COALESCE(NEW.tokens_total, 0), COALESCE(NEW.duration_ms, 0), strftime('%s','now')
  )
  ON CONFLICT(hour_ts, session_id, kind, name) DO UPDATE SET
    calls           = calls + 1,
    tokens_total    = tokens_total + excluded.tokens_total,
    duration_ms_sum = duration_ms_sum + excluded.duration_ms_sum,
    project_name    = COALESCE(project_name, excluded.project_name),
    updated_at      = strftime('%s','now');
END;

-- 슬래시 명령 — INSERT 시 채워져 있으면
CREATE TRIGGER IF NOT EXISTS trg_meta_usage_after_insert_command
AFTER INSERT ON requests
WHEN NEW.slash_command IS NOT NULL AND NEW.slash_command != ''
BEGIN
  INSERT INTO stats_meta_usage_hourly (hour_ts, session_id, kind, name, project_name, calls, tokens_total, duration_ms_sum, updated_at)
  VALUES (
    (NEW.timestamp / 1000 / 3600) * 3600, NEW.session_id, 'command', NEW.slash_command,
    (SELECT s.project_name FROM sessions s WHERE s.id = NEW.session_id),
    1, COALESCE(NEW.tokens_total, 0), COALESCE(NEW.duration_ms, 0), strftime('%s','now')
  )
  ON CONFLICT(hour_ts, session_id, kind, name) DO UPDATE SET
    calls           = calls + 1,
    tokens_total    = tokens_total + excluded.tokens_total,
    duration_ms_sum = duration_ms_sum + excluded.duration_ms_sum,
    project_name    = COALESCE(project_name, excluded.project_name),
    updated_at      = strftime('%s','now');
END;

-- 슬래시 명령 — 나중에 처음 채워질 때
CREATE TRIGGER IF NOT EXISTS trg_meta_usage_after_update_command
AFTER UPDATE OF slash_command ON requests
WHEN (OLD.slash_command IS NULL OR OLD.slash_command = '')
 AND NEW.slash_command IS NOT NULL AND NEW.slash_command != ''
BEGIN
  INSERT INTO stats_meta_usage_hourly (hour_ts, session_id, kind, name, project_name, calls, tokens_total, duration_ms_sum, updated_at)
  VALUES (
    (NEW.timestamp / 1000 / 3600) * 3600, NEW.session_id, 'command', NEW.slash_command,
    (SELECT s.project_name FROM sessions s WHERE s.id = NEW.session_id),
    1, COALESCE(NEW.tokens_total, 0), COALESCE(NEW.duration_ms, 0), strftime('%s','now')
  )
  ON CONFLICT(hour_ts, session_id, kind, name) DO UPDATE SET
    calls           = calls + 1,
    tokens_total    = tokens_total + excluded.tokens_total,
    duration_ms_sum = duration_ms_sum + excluded.duration_ms_sum,
    project_name    = COALESCE(project_name, excluded.project_name),
    updated_at      = strftime('%s','now');
END;

-- 백필(calls) — 현재 Hot requests 1회. 실패(failures)는 서버 기동 시 앱 코드가 채운다.
INSERT INTO stats_meta_usage_hourly (hour_ts, session_id, kind, name, project_name, calls, tokens_total, duration_ms_sum)
SELECT (r.timestamp / 1000 / 3600) * 3600, r.session_id,
       CASE r.tool_name WHEN 'Agent' THEN 'agent' ELSE 'skill' END, r.tool_detail,
       (SELECT s.project_name FROM sessions s WHERE s.id = r.session_id),
       COUNT(*), SUM(COALESCE(r.tokens_total, 0)), SUM(COALESCE(r.duration_ms, 0))
  FROM requests r
 WHERE r.tool_name IN ('Skill', 'Agent') AND r.tool_detail IS NOT NULL
   AND (r.event_type IS NULL OR r.event_type != 'pre_tool')
 GROUP BY 1, 2, 3, 4
ON CONFLICT(hour_ts, session_id, kind, name) DO NOTHING;

INSERT INTO stats_meta_usage_hourly (hour_ts, session_id, kind, name, project_name, calls, tokens_total, duration_ms_sum)
SELECT (r.timestamp / 1000 / 3600) * 3600, r.session_id, 'command', r.slash_command,
       (SELECT s.project_name FROM sessions s WHERE s.id = r.session_id),
       COUNT(*), SUM(COALESCE(r.tokens_total, 0)), SUM(COALESCE(r.duration_ms, 0))
  FROM requests r
 WHERE r.slash_command IS NOT NULL AND r.slash_command != ''
 GROUP BY 1, 2, 3, 4
ON CONFLICT(hour_ts, session_id, kind, name) DO NOTHING;
