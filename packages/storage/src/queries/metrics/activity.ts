/**
 * Observability Metrics — Tier 2/3: 활동·세션 구조·도구 호출 분포.
 *
 * 변경 이유: 활동 패턴/세션 구조 정책(turn 정의, compaction 분모, 카테고리 분류) 변경 시 묶여서 변경됨.
 *  - getActivityHeatmap           (7일 × 24시간)
 *  - getTurnsPerSession           (세션당 turn 수)
 *  - getCompactionSessionCount    (Compaction 발생 세션 수)
 *  - getActiveSessionCount        (활성 세션 수, compaction_rate 분모)
 *  - getAgentCallsPerSession      (에이전트 깊이 분포)
 *  - getToolCategoryRawCounts     (Tier 3: tool_name별 호출 수 raw)
 */

import type { Database } from 'bun:sqlite';
import { ACTIVE_REQUEST_FILTER_SQL } from '../request';
import { buildTimeWindow } from './_shared';
import type {
  ActivityHeatmapRow,
  TurnsPerSessionRow,
  ToolCategoryRawRow,
} from './types';

/**
 * 4) 시간대별 활동 heatmap (7일 × 24시간)
 *
 * - 모든 request 기준 (pre_tool 제외)
 * - SQLite strftime: '%w'=요일(0=Sun), '%H'=시
 * - timestamp는 ms 단위라 1000으로 나눠 unixepoch 변환
 */
export function getActivityHeatmap(
  db: Database,
  fromTs?: number,
  toTs?: number
): ActivityHeatmapRow[] {
  const params: number[] = [];
  const conds = [ACTIVE_REQUEST_FILTER_SQL];
  conds.push(...buildTimeWindow('timestamp', fromTs, toTs, params));

  return db.query(`
    SELECT
      CAST(strftime('%w', timestamp / 1000, 'unixepoch', 'localtime') AS INTEGER) AS weekday,
      CAST(strftime('%H', timestamp / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
      COUNT(*) AS count
    FROM requests
    WHERE ${conds.join(' AND ')}
    GROUP BY weekday, hour
    ORDER BY weekday, hour
  `).all(...params) as ActivityHeatmapRow[];
}

/**
 * 5-1) 세션당 turn 수
 *
 * - turn_id distinct count, type='prompt' 기준 (turn = prompt 단위)
 */
export function getTurnsPerSession(
  db: Database,
  fromTs?: number,
  toTs?: number
): TurnsPerSessionRow[] {
  const params: number[] = [];
  const conds = ["type = 'prompt'", 'turn_id IS NOT NULL'];
  conds.push(...buildTimeWindow('timestamp', fromTs, toTs, params));

  return db.query(`
    SELECT session_id, COUNT(DISTINCT turn_id) AS turn_count
    FROM requests
    WHERE ${conds.join(' AND ')}
    GROUP BY session_id
  `).all(...params) as TurnsPerSessionRow[];
}

/**
 * 5-2) Compaction 발생 세션 수
 *
 * - claude_events PreCompact / PostCompact 이벤트 보유 세션 수
 * - "PreCompact 또는 PostCompact 1건 이상" = compaction 발생 세션
 * - 분모(total_sessions)와 동일한 시간 윈도우 적용을 위해
 *   해당 세션이 같은 윈도우에서 prompt 활동이 있는 세션으로 한정한다.
 *   (window 외 compaction이 분자에 잡혀 1.0 초과 발생을 방지)
 */
export function getCompactionSessionCount(
  db: Database,
  fromTs?: number,
  toTs?: number
): { compacted_sessions: number } {
  const params: number[] = [];
  const eventConds = ["ce.event_type IN ('PreCompact', 'PostCompact')"];
  eventConds.push(...buildTimeWindow('ce.timestamp', fromTs, toTs, params));

  // 활성 세션(prompt 활동 있는 세션) 동일 윈도우와 교집합
  const sessionConds = ["r.type = 'prompt'", 'r.turn_id IS NOT NULL'];
  sessionConds.push(...buildTimeWindow('r.timestamp', fromTs, toTs, params));

  return db.query(`
    SELECT COUNT(DISTINCT ce.session_id) AS compacted_sessions
    FROM claude_events ce
    WHERE ${eventConds.join(' AND ')}
      AND EXISTS (
        SELECT 1 FROM requests r
        WHERE r.session_id = ce.session_id
          AND ${sessionConds.join(' AND ')}
      )
  `).get(...params) as { compacted_sessions: number };
}

/**
 * 5-3) 활성/대상 세션 수 (compaction_rate 분모)
 *
 * - prompt 레코드를 가진 세션 = "분석 대상 세션"
 *   (turn_id가 부여되어 turn 분포 분모와 동일)
 */
export function getActiveSessionCount(
  db: Database,
  fromTs?: number,
  toTs?: number
): { total_sessions: number } {
  const params: number[] = [];
  const conds = ["type = 'prompt'", 'turn_id IS NOT NULL'];
  conds.push(...buildTimeWindow('timestamp', fromTs, toTs, params));

  return db.query(`
    SELECT COUNT(DISTINCT session_id) AS total_sessions
    FROM requests
    WHERE ${conds.join(' AND ')}
  `).get(...params) as { total_sessions: number };
}

/**
 * 6) 에이전트 깊이 분포 — 세션당 Agent 호출 수
 *
 * - tool_name='Agent' 카운트
 * - 깊이 정의(0/1/multi) 매핑은 라우트 단계
 */
export function getAgentCallsPerSession(
  db: Database,
  fromTs?: number,
  toTs?: number
): Array<{ session_id: string; agent_calls: number }> {
  const params: number[] = [];
  const conds = ["type = 'prompt' OR type = 'tool_call'"];
  conds.push(...buildTimeWindow('timestamp', fromTs, toTs, params));

  // 세션 단위로 Agent 호출 수 집계 (Agent를 호출하지 않은 세션도 0으로 포함)
  return db.query(`
    SELECT
      session_id,
      SUM(CASE WHEN type = 'tool_call' AND tool_name = 'Agent' THEN 1 ELSE 0 END) AS agent_calls
    FROM requests
    WHERE ${conds.join(' AND ')}
    GROUP BY session_id
  `).all(...params) as Array<{ session_id: string; agent_calls: number }>;
}

/**
 * 7) Tool 카테고리 분포 — raw tool_name별 호출 수
 *
 * - 카테고리 매핑은 서버 라우트(tool-category.ts)에서 수행
 * - 여기서는 tool_name만 GROUP BY
 */
export function getToolCategoryRawCounts(
  db: Database,
  fromTs?: number,
  toTs?: number
): ToolCategoryRawRow[] {
  const params: number[] = [];
  const conds = [
    "type = 'tool_call'",
    'tool_name IS NOT NULL',
    "(event_type IS NULL OR event_type = 'tool')",
  ];
  conds.push(...buildTimeWindow('timestamp', fromTs, toTs, params));

  return db.query(`
    SELECT tool_name, COUNT(*) AS request_count
    FROM requests
    WHERE ${conds.join(' AND ')}
    GROUP BY tool_name
  `).all(...params) as ToolCategoryRawRow[];
}
