-- Migration 040: Flow-specific active rows VIEW with event_rank tie-break
-- Purpose: Dedicated projection for flow chart BFS queries, independent from ACTIVE_REQUEST_FILTER_SQL
-- Risk level: ZERO — READ-ONLY VIEW, no table structure changes
-- Rollback: DROP VIEW v_flow_active_rows;

CREATE VIEW IF NOT EXISTS v_flow_active_rows AS
SELECT
  r.id,
  r.session_id,
  r.timestamp,
  r.turn_id,
  r.type,
  r.tool_name,
  r.tool_detail,
  r.slash_command,
  r.tool_use_id,
  r.parent_tool_use_id,
  r.agent_type,
  r.agent_id,
  r.event_type,
  r.tool_interrupted,
  r.tool_user_modified,
  CASE r.event_type
    WHEN 'tool'      THEN 0
    WHEN 'post_tool' THEN 1
    WHEN 'pre_tool'  THEN 2
    ELSE 3
  END AS event_rank
FROM requests r
WHERE (r.event_type IS NULL OR r.event_type = 'tool' OR r.event_type = 'post_tool')
  AND r.tool_use_id IS NOT NULL;
