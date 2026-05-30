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
 *   §3.3 SQLite ↔ Ladybug 매핑 표 — 본 구현이 충실히 따라야 할 SSoT.
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
  | { kind: 'meta_doc'; props: MetaDocumentProps }
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

/** MetaDocument node 의 5종 kind — SQLite listFlowAggregates 규칙과 일치. */
export type MetaDocKind = 'command' | 'skill' | 'agent' | 'mcp' | 'tool';

/**
 * MetaDocument 노드 props. PK 는 합성 STRING `${kind}::${name}`.
 *
 * source / source_root 는 카탈로그 (SQLite meta_documents) 가 채울 수 있는 부가
 * 메타데이터로 현재는 null. 향후 카탈로그 sync PR 에서 채움 — 본 enrich path 는
 * 호출 시점에 알 수 없는 정보이므로 null 유지.
 */
export interface MetaDocumentProps {
  id: string;
  kind: MetaDocKind;
  name: string;
  source: string | null;
  source_root: string | null;
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
 *
 * op 정책:
 *   - 'insert' → 일반 enrich 경로.
 *   - 'update' → 동일 경로 (모든 GraphOp 는 idempotent MERGE — 같은 input 재실행 무해).
 *               Migration 051 이 pre_tool → tool 전환을 capture 해 본 경로로 흘려보낸다.
 *   - 'delete' → 빈 배열 (향후 PR — 현재 SQLite 측에서 soft-delete 만 사용).
 */
export function enrichOutboxRow(row: OutboxRow, db: Database): GraphOp[] {
  if (row.op === 'delete') return [];
  if (row.source === 'sessions') return enrichSession(row, db);
  if (row.source === 'requests') return enrichRequest(row, db);
  return [];
}

// =============================================================================
// sessions → Session 노드 1개
// =============================================================================

function enrichSession(row: OutboxRow, db: Database): GraphOp[] {
  // 실제 sessions 테이블 스키마 (마이그레이션 초기 정의 기준):
  //   id, project_name, started_at, ended_at, total_tokens, created_at
  //
  //   cwd / total_input_tokens / total_output_tokens 컬럼은 *존재하지 않는다*.
  //   초기 storage-graph 가 다른 fork 의 더 풍부한 스키마를 기대했지만 본 프로젝트의
  //   실제 SQLite 스키마는 단순함. Session 그래프 노드의 cwd 필드는 정보가 없어 null 유지.
  const stmt = db.prepare(
    `SELECT id, project_name, started_at, ended_at, total_tokens
       FROM sessions WHERE id = ?`,
  );
  const src = stmt.get(row.event_id) as
    | {
        id: string;
        project_name: string | null;
        started_at: number;
        ended_at: number | null;
        total_tokens: number | null;
      }
    | undefined;
  if (!src) return [];

  return [
    {
      kind: 'session',
      props: {
        id: src.id,
        project_name: src.project_name,
        cwd: null,           // SQLite 에 컬럼 없음 — graph 스키마 호환 위해 null.
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
  // 실제 requests 테이블의 PK 는 TEXT (예: 'pre-1779769378805-c5926b16', 'resp-msg-...').
  //   초기 storage-graph 가 INTEGER PK 를 가정해 Number() 변환 후 isFinite 체크로 throw 했고
  //   그 결과 enrichRequest 가 단 한 건도 처리 못 했다. 그냥 string 으로 사용.
  // 또한 토큰 컬럼명은 `tokens_total` (스키마 column #10) — `total_tokens` 는 sessions 쪽.
  const requestId = row.event_id;
  if (!requestId) return [];

  const stmt = db.prepare(
    `SELECT id, session_id, timestamp, turn_id, type, tool_name, tool_detail,
            slash_command, tool_use_id, parent_tool_use_id, agent_type, agent_id,
            event_type, tool_interrupted, tokens_total
       FROM requests WHERE id = ?`,
  );
  const r = stmt.get(requestId) as
    | {
        id: string;
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
        tokens_total: number | null;
      }
    | undefined;
  if (!r) return [];

  // pre_tool 미완성 행 가드 (사용자 명시 2026-05-26):
  //   PreToolUse 만 도착하고 PostToolUse 가 끝내 오지 않은 행(클로드 코드 강제 종료 등)은
  //   tokens=0 / duration=0 의 freeze 된 상태로 그래프에 적재되면 flow chart 에 유령
  //   노드를 만든다. event_type='pre_tool' 행은 모든 그래프 op 발행 자체를 skip —
  //   PostToolUse 가 도착해 UPDATE 가 일어나면 Migration 051 의 트리거가 outbox 에
  //   op='update' row 를 발행 → 다시 enrich → 이때는 event_type='tool' 이므로 정상 적재.
  //
  //   주의: enrichRequest 가 skip 해도 다른 source(sessions)의 outbox row 는 그대로
  //   처리된다 — Session 노드는 미완성 호출과 무관.
  if (r.event_type === 'pre_tool') {
    return [];
  }

  const ops: GraphOp[] = [];
  const eventId = r.id;

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
        tokens_total: r.tokens_total ?? 0,
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

    // R7: 양방향 PARENT_OF — 이 ToolCall 을 parent 로 갖는 기존 자식들에 대해서도 발행.
    //   부모 Agent ToolCall 노드는 PostToolUse 재enrich(event_type='tool') 시점에 생성되는데,
    //   이는 sub-agent 자식 활동 이후라(`:255-256`) 자식 측 PARENT_OF(`:312-320`)는 부모 노드
    //   부재로 조용히 유실됐을 수 있다(merge.ts mergeRel MATCH 0 → no-op). 부모 측에서도 발행해
    //   순서 무관 최종 일관성을 만든다 — 모두 idempotent MERGE 라 child-side 와 중복돼도 무해.
    //   pre_tool 자식은 ToolCall 노드가 아직 없어 제외(자식의 PostToolUse 재enrich 때 child-side 가 처리).
    const childRows = db
      .prepare(
        `SELECT tool_use_id FROM requests
          WHERE parent_tool_use_id = ? AND tool_use_id IS NOT NULL AND event_type != 'pre_tool'`,
      )
      .all(r.tool_use_id) as Array<{ tool_use_id: string }>;
    for (const child of childRows) {
      ops.push({
        kind: 'rel',
        rel: {
          type: 'PARENT_OF',
          from: { label: 'ToolCall', key: 'tool_use_id', value: r.tool_use_id },
          to: { label: 'ToolCall', key: 'tool_use_id', value: child.tool_use_id },
        },
      });
    }

    // MetaDocument + USES — flow 시각화의 SoT.
    //
    //   SQLite 측 카탈로그 매핑 규칙(storage/queries/meta-document.ts §listFlowAggregates)
    //   과 일치:
    //     slash_command non-null    → 'command' / slash_command
    //     tool_name='Agent'+detail  → 'agent'   / tool_detail
    //     tool_name='Skill'+detail  → 'skill'   / tool_detail
    //     tool_name LIKE 'mcp__%'   → 'mcp'     / tool_name (풀네임)
    //     그 외 일반 도구           → 'tool'    / tool_name
    //
    //   파생 실패(예: 모든 컬럼이 null 인 metadata-only request)는 skip — USES 가 없으면
    //   unified-flow 쿼리가 해당 ToolCall 을 seed 후보로 보지 않으므로 정상.
    const md = deriveMetaDoc(r);
    if (md) {
      const mdId = `${md.kind}::${md.name}`;
      ops.push({
        kind: 'meta_doc',
        props: {
          id: mdId,
          kind: md.kind,
          name: md.name,
          source: null,        // 향후 카탈로그 sync 가 채움.
          source_root: null,
        },
      });
      ops.push({
        kind: 'rel',
        rel: {
          type: 'USES',
          from: { label: 'ToolCall', key: 'tool_use_id', value: r.tool_use_id },
          to:   { label: 'MetaDocument', key: 'id',     value: mdId },
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

/**
 * requests row 에서 (kind, name) 도출 — flow 시각화에 노출할 *Behavior Definition* 만.
 *
 *   사용자 명시 정책 (2026-05-26): 흐름도는 프로젝트에서 *정의된 행동 단위* — Skill /
 *   Sub-agent / Slash Command / MCP / 내장 스킬 문서 — 만 노출한다. Read/Bash/Edit
 *   같은 generic 도구는 호출 빈도가 너무 높아 시각 노이즈를 만들고, 정의된 메타 문서의
 *   흐름을 가린다 (예: backend agent → Read/Bash/Edit/LSP/ToolSearch 다섯 줄이 메타
 *   문서 호출을 압도).
 *
 *   분기 우선순위 — listFlowAggregates (SQLite 측) 와 동일:
 *     - slash_command 가 우선 — 같은 turn 안에서 ToolCall.tool_name='Task' 등으로 보일
 *       수 있어도 슬래시 명령은 명시적 동작이라 가장 강한 신호.
 *     - 그 다음 Agent/Skill chip — tool_name 이 정확히 'Agent' / 'Skill' 일 때 tool_detail
 *       이 sub-agent / skill 이름.
 *     - mcp__<server>__<tool> 패턴은 풀네임 그대로 — UI 에서 server 단위 그룹핑은 enrich
 *       단계가 별도로 처리(graph.ts::applyMcpGrouping).
 *     - 그 외 일반 도구(Read/Bash/Write/Edit/LSP/ToolSearch 등): **null 반환 → skip**.
 *       MetaDocument / USES 엣지를 만들지 않는다. ToolCall 노드 자체는 그대로 살아 있어
 *       PARENT_OF 트리 추적은 끊기지 않는다.
 *
 *   결과: unified-flow 쿼리의 `MATCH (tc:ToolCall)-[:USES]->(md:MetaDocument)` 절이 USES
 *   가 없는 ToolCall 을 자연스럽게 제외 → 흐름도에 generic tool 카드가 등장하지 않음.
 */
function deriveMetaDoc(r: {
  tool_name: string | null;
  tool_detail: string | null;
  slash_command: string | null;
}): { kind: MetaDocKind; name: string } | null {
  if (r.slash_command && r.slash_command.length > 0) {
    return { kind: 'command', name: r.slash_command };
  }
  const tn = r.tool_name;
  if (!tn) return null;
  if (tn === 'Agent' && r.tool_detail) return { kind: 'agent', name: r.tool_detail };
  if (tn === 'Skill' && r.tool_detail) return { kind: 'skill', name: r.tool_detail };
  if (tn.startsWith('mcp__'))          return { kind: 'mcp',   name: tn };
  return null; // generic tool — 흐름도에서 제외.
}
