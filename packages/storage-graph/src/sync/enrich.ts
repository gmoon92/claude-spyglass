/**
 * enrich.ts — outbox row → 그래프 노드/엣지 페이로드 변환
 *
 * 책임:
 *   `kuzu_outbox` 의 한 행(source + event_id)을 입력으로 받아, SQLite 에서 필요한
 *   row 를 추가 조회하여 Ladybug 에 MERGE 할 수 있는 형태의 GraphOp 으로 만든다.
 *   본 모듈이 SQLite 측 schema 와 그래프 측 schema 의 단일 매핑 지점이다 — 다른
 *   곳에서 컬럼 매핑을 흩뿌리지 않는다 (메모리: feedback_avoid_spaghetti).
 *
 * 의존성:
 *   - @spyglass/storage (Database 타입, getRequestById 등 기존 read 함수)
 *   - schema/ddl.ts 의 노드/엣지 정의 (런타임 영향 없음 — DDL 만)
 *
 * 호출 흐름:
 *   sync/worker.ts::tick()
 *     → SELECT * FROM kuzu_outbox WHERE id > cursor LIMIT 500
 *     → for each row: enrich(row, db) → GraphOp[]
 *     → sync/merge.ts::mergeOps(client, ops)
 *
 * 디자인 결정:
 *   - 본 모듈은 *순수 함수* 패턴 — SQLite read 만 하고 mutation 없음.
 *   - 한 outbox row 가 여러 노드/엣지를 만들 수 있음 (예: tool_use_id 가 있는 requests
 *     행은 Event 노드 + (ToolCall)-[:PRODUCED]->(Event) 엣지 + (Turn)-[:SPAWNED]->...).
 *   - SQLite 행이 갑자기 사라지는 경우(soft delete 등)는 무시 — outbox PK 진행만 한다.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/.tmp/plans/spyglass/graph-db-research/01-database-architecture.md
 *   §3.3 SQLite ↔ Kuzu 매핑 표 — 본 구현이 충실히 따라야 할 SSoT.
 */

import type { Database } from 'bun:sqlite';

// =============================================================================
// outbox / GraphOp 타입
// =============================================================================

/** kuzu_outbox 한 행. SELECT 결과 row 와 1:1. */
export interface OutboxRow {
  id: number;
  source: 'requests' | 'sessions';
  event_id: string;
  op: 'insert' | 'update' | 'delete';
  ts: number;
}

/**
 * Ladybug 에 MERGE 할 단위 작업. one outbox row → 0..N GraphOp.
 *
 * 모든 op 는 idempotent — 같은 input 으로 재실행해도 결과 동일. 따라서 worker tick 이
 * 실패 후 재시도해도 데이터 중복 없다.
 */
export type GraphOp =
  | { kind: 'session'; props: SessionProps }
  | { kind: 'turn'; props: TurnProps }
  | { kind: 'agent'; props: AgentProps }
  | { kind: 'tool_call'; props: ToolCallProps }
  | { kind: 'event'; props: EventProps }
  | { kind: 'rel'; rel: RelOp };

export interface SessionProps {
  id: string;
  project_name: string | null;
  cwd: string | null;
  started_at: number;
  ended_at: number | null;
  total_tokens: number;
}

export interface TurnProps {
  id: string;
  session_id: string;
  ordinal: number;
  prompt_id: string;
  started_at: number;
}

export interface AgentProps {
  id: string;
  type: string | null;
  parent_tool_use: string | null;
  session_id: string;
}

export interface ToolCallProps {
  tool_use_id: string;
  request_id: string;
  session_id: string;
  turn_id: string | null;
  agent_id: string;
  tool_name: string | null;
  tool_detail: string | null;
  slash_command: string | null;
  is_virtual_slash: boolean;
  started_at: number;
  duration_ms: number;
  tokens_total: number;
  interrupted: boolean;
}

export interface EventProps {
  id: string;
  event_type: string | null;
  tool_use_id: string | null;
  turn_id: string | null;
  session_id: string;
  timestamp: number;
  payload_ref: string;
}

export interface RelOp {
  /** 엣지 타입 (CONTAINS/NEXT/SPAWNED/CALLED/PARENT_OF/PRODUCED/USES/CARRIES). */
  type: string;
  /** 시작 노드 — { label, primaryKey, value }. */
  from: { label: string; key: string; value: string | number };
  /** 종료 노드. */
  to: { label: string; key: string; value: string | number };
  /** 엣지 속성 (예: NEXT.gap_ms, CALLED.sequence_no). 없으면 빈 객체. */
  props?: Record<string, unknown>;
}

// =============================================================================
// 메인 — outbox 한 행을 GraphOp 배열로
// =============================================================================

/**
 * outbox row 를 enrich. SQLite 에서 필요한 source row 를 1개 읽어와 위 타입에 매핑.
 * source row 가 사라진 경우(soft delete 등) 빈 배열 반환 — worker 는 cursor 만 전진.
 */
export function enrichOutboxRow(row: OutboxRow, db: Database): GraphOp[] {
  if (row.op !== 'insert') {
    // P1 범위는 insert 만. update/delete 는 후속 PR.
    return [];
  }
  if (row.source === 'sessions') return enrichSession(row, db);
  if (row.source === 'requests') return enrichRequest(row, db);
  return [];
}

// =============================================================================
// sessions → Session 노드 1개
// =============================================================================

function enrichSession(row: OutboxRow, db: Database): GraphOp[] {
  const stmt = db.prepare(
    `SELECT id, project_name, cwd, started_at, ended_at,
            COALESCE(total_input_tokens, 0) + COALESCE(total_output_tokens, 0) AS total_tokens
       FROM sessions WHERE id = ?`,
  );
  const src = stmt.get(row.event_id) as
    | {
        id: string;
        project_name: string | null;
        cwd: string | null;
        started_at: number;
        ended_at: number | null;
        total_tokens: number;
      }
    | undefined;
  if (!src) return [];

  return [
    {
      kind: 'session',
      props: {
        id: src.id,
        project_name: src.project_name,
        cwd: src.cwd,
        started_at: src.started_at,
        ended_at: src.ended_at,
        total_tokens: src.total_tokens ?? 0,
      },
    },
  ];
}

// =============================================================================
// requests → Event + (옵션) ToolCall, Turn, Agent + 엣지들
// =============================================================================

/**
 * requests row 는 가장 풍부한 enrichment 대상. 한 행에서 최대 5개 노드 + 4개 엣지가
 * 나올 수 있다 — 그러나 모두 idempotent MERGE 라 중복은 무해.
 *
 * 노드 derivation 규칙 (보고서 §3.3 표 그대로):
 *  - 모든 request → Event 노드 (id = requests.id)
 *  - tool_use_id 가 있으면 → ToolCall 노드 + (ToolCall)-[:PRODUCED]->(Event)
 *  - turn_id 가 있으면 → Turn 노드 (실제 prompt 행이면 더 풍부, 아니면 placeholder)
 *  - parent_tool_use_id 가 있으면 → (parent ToolCall)-[:PARENT_OF]->(child ToolCall)
 *  - session_id 가 있으면 → (Session)-[:CONTAINS]->(Turn) (Turn 이 있을 때만)
 */
function enrichRequest(row: OutboxRow, db: Database): GraphOp[] {
  const requestId = Number(row.event_id);
  if (!Number.isFinite(requestId)) return [];

  const stmt = db.prepare(
    `SELECT id, session_id, timestamp, turn_id, type, tool_name, tool_detail,
            slash_command, tool_use_id, parent_tool_use_id, agent_type, agent_id,
            event_type, tool_interrupted, total_tokens
       FROM requests WHERE id = ?`,
  );
  const r = stmt.get(requestId) as
    | {
        id: number;
        session_id: string;
        timestamp: number;
        turn_id: string | null;
        type: string;
        tool_name: string | null;
        tool_detail: string | null;
        slash_command: string | null;
        tool_use_id: string | null;
        parent_tool_use_id: string | null;
        agent_type: string | null;
        agent_id: string | null;
        event_type: string | null;
        tool_interrupted: number | null;
        total_tokens: number | null;
      }
    | undefined;
  if (!r) return [];

  const ops: GraphOp[] = [];
  const eventId = String(r.id);

  // 1) Event 노드 — 모든 request 에 대해 항상.
  ops.push({
    kind: 'event',
    props: {
      id: eventId,
      event_type: r.event_type,
      tool_use_id: r.tool_use_id,
      turn_id: r.turn_id,
      session_id: r.session_id,
      timestamp: r.timestamp,
      payload_ref: eventId, // SQLite request id 가 곧 payload 포인터.
    },
  });

  // 2) ToolCall 노드 (있을 때만) + PRODUCED 엣지.
  if (r.tool_use_id) {
    const isVirtualSlash = r.tool_use_id.startsWith('slash:');
    ops.push({
      kind: 'tool_call',
      props: {
        tool_use_id: r.tool_use_id,
        request_id: eventId,
        session_id: r.session_id,
        turn_id: r.turn_id,
        agent_id: r.agent_id ?? 'main', // root agent SSoT — null 일 때 'main' 합성.
        tool_name: r.tool_name,
        tool_detail: r.tool_detail,
        slash_command: r.slash_command,
        is_virtual_slash: isVirtualSlash,
        started_at: r.timestamp,
        duration_ms: 0, // 정확한 duration 은 post_tool event 에서 갱신 — 후속 PR.
        tokens_total: r.total_tokens ?? 0,
        interrupted: r.tool_interrupted === 1,
      },
    });
    ops.push({
      kind: 'rel',
      rel: {
        type: 'PRODUCED',
        from: { label: 'ToolCall', key: 'tool_use_id', value: r.tool_use_id },
        to: { label: 'Event', key: 'id', value: eventId },
      },
    });

    // PARENT_OF — parent tool_use_id 가 있을 때.
    if (r.parent_tool_use_id) {
      ops.push({
        kind: 'rel',
        rel: {
          type: 'PARENT_OF',
          from: { label: 'ToolCall', key: 'tool_use_id', value: r.parent_tool_use_id },
          to: { label: 'ToolCall', key: 'tool_use_id', value: r.tool_use_id },
        },
      });
    }
  }

  // 3) Turn 노드 (있을 때만) — prompt 행이면 풍부, 아니면 placeholder. MERGE 라 어느 쪽
  //    이 먼저 들어와도 됨. ordinal 은 turn_id 패턴 "<sess>-T<N>" 의 N.
  if (r.turn_id) {
    const ordinal = parseTurnOrdinal(r.turn_id);
    ops.push({
      kind: 'turn',
      props: {
        id: r.turn_id,
        session_id: r.session_id,
        ordinal,
        prompt_id: r.type === 'prompt' ? eventId : '',
        started_at: r.timestamp,
      },
    });
    // (Session)-[:CONTAINS]->(Turn)
    ops.push({
      kind: 'rel',
      rel: {
        type: 'CONTAINS',
        from: { label: 'Session', key: 'id', value: r.session_id },
        to: { label: 'Turn', key: 'id', value: r.turn_id },
      },
    });
  }

  // 4) Agent 노드 — subagent 든 main 이든. CALLED 엣지는 ToolCall 이 있을 때만.
  const agentId = r.agent_id ?? 'main';
  ops.push({
    kind: 'agent',
    props: {
      id: agentId,
      type: r.agent_type,
      parent_tool_use: r.parent_tool_use_id,
      session_id: r.session_id,
    },
  });
  if (r.tool_use_id) {
    ops.push({
      kind: 'rel',
      rel: {
        type: 'CALLED',
        from: { label: 'Agent', key: 'id', value: agentId },
        to: { label: 'ToolCall', key: 'tool_use_id', value: r.tool_use_id },
      },
    });
  }

  return ops;
}

/**
 * "<sess-id>-T<N>" 형태에서 N 을 파싱. 패턴이 다르면 0 폴백 — 정렬 자체엔 영향 없고
 * 그래프 traversal 에서 ordinal 은 가독성용 보조 컬럼.
 */
function parseTurnOrdinal(turnId: string): number {
  const m = turnId.match(/-T(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}
