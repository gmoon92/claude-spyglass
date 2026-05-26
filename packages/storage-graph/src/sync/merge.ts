/**
 * merge.ts — GraphOp[] → idempotent Cypher MERGE 실행
 *
 * 책임:
 *   enrich.ts 가 만든 GraphOp 배열을 LadybugClient 의 Cypher MERGE 문장으로 변환해
 *   순차 실행한다. 트랜잭션 안에서 실행되므로 batch 단위 atomicity 보장.
 *
 * 의존성:
 *   - client.ts (LadybugClient.query / transaction)
 *   - sync/enrich.ts (GraphOp 타입)
 *
 * 호출 흐름:
 *   sync/worker.ts::tick()
 *     → client.transaction(async () => mergeOps(client, ops))
 *     → for each op: 적절한 MERGE 한 줄 실행
 *
 * 디자인 결정:
 *   - 모든 노드는 PRIMARY KEY 기준 MERGE — 같은 row 가 두 번 들어와도 idempotent.
 *   - 노드 속성은 MERGE 시 SET (덮어쓰기) — 가장 최근 enrich 결과가 승리.
 *   - 엣지는 fork 의 MATCH ... CREATE ... 패턴 (Ladybug 는 REL 에 MERGE 가 없을 수
 *     있어 MATCH + 존재 체크 패턴). 단순화를 위해 우선 CREATE 시도 + duplicate 에러
 *     무시 폴백.
 *   - 본 모듈은 *문자열 빌더 + dispatcher* — 실제 native 호출은 LadybugClient.query 에
 *     위임.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/.tmp/plans/spyglass/graph-db-research/01-database-architecture.md
 *   §5 Query Migration 예시 — MERGE 패턴 참고.
 */

import type { LadybugClient } from '../client';
import type { GraphOp, RelOp, MetaDocumentProps } from './enrich';

/**
 * GraphOp 배열을 순서대로 MERGE. 호출자(worker)가 본 함수를 transaction 으로 감싸야
 * batch atomicity 가 확보된다.
 */
export async function mergeOps(client: LadybugClient, ops: GraphOp[]): Promise<void> {
  for (const op of ops) {
    switch (op.kind) {
      case 'session':
        await mergeSession(client, op.props);
        break;
      case 'turn':
        await mergeTurn(client, op.props);
        break;
      case 'agent':
        await mergeAgent(client, op.props);
        break;
      case 'tool_call':
        await mergeToolCall(client, op.props);
        break;
      case 'event':
        await mergeEvent(client, op.props);
        break;
      case 'meta_doc':
        await mergeMetaDocument(client, op.props);
        break;
      case 'rel':
        await mergeRel(client, op.rel);
        break;
      // exhaustive switch — discriminated union 의 모든 case 처리.
    }
  }
}

// =============================================================================
// 노드별 MERGE 헬퍼 — 각 함수의 책임은 한 노드 타입의 idempotent 머지
// =============================================================================

async function mergeSession(client: LadybugClient, p: { id: string; project_name: string | null; cwd: string | null; started_at: number; ended_at: number | null; total_tokens: number }): Promise<void> {
  await client.query(
    `MERGE (s:Session {id: $id})
     SET s.project_name = $project_name,
         s.cwd          = $cwd,
         s.started_at   = $started_at,
         s.ended_at     = $ended_at,
         s.total_tokens = $total_tokens`,
    p,
  );
}

async function mergeTurn(client: LadybugClient, p: { id: string; session_id: string; ordinal: number; prompt_id: string; started_at: number }): Promise<void> {
  await client.query(
    `MERGE (t:Turn {id: $id})
     SET t.session_id = $session_id,
         t.ordinal    = $ordinal,
         t.prompt_id  = $prompt_id,
         t.started_at = $started_at`,
    p,
  );
}

async function mergeAgent(client: LadybugClient, p: { id: string; type: string | null; parent_tool_use: string | null; session_id: string }): Promise<void> {
  await client.query(
    `MERGE (a:Agent {id: $id})
     SET a.type            = $type,
         a.parent_tool_use = $parent_tool_use,
         a.session_id      = $session_id`,
    p,
  );
}

async function mergeToolCall(client: LadybugClient, p: { tool_use_id: string; request_id: string; session_id: string; turn_id: string | null; agent_id: string; tool_name: string | null; tool_detail: string | null; slash_command: string | null; is_virtual_slash: boolean; started_at: number; duration_ms: number; tokens_total: number; interrupted: boolean }): Promise<void> {
  await client.query(
    `MERGE (c:ToolCall {tool_use_id: $tool_use_id})
     SET c.request_id        = $request_id,
         c.session_id        = $session_id,
         c.turn_id           = $turn_id,
         c.agent_id          = $agent_id,
         c.tool_name         = $tool_name,
         c.tool_detail       = $tool_detail,
         c.slash_command     = $slash_command,
         c.is_virtual_slash  = $is_virtual_slash,
         c.started_at        = $started_at,
         c.duration_ms       = $duration_ms,
         c.tokens_total      = $tokens_total,
         c.interrupted       = $interrupted`,
    p,
  );
}

async function mergeEvent(client: LadybugClient, p: { id: string; event_type: string | null; tool_use_id: string | null; turn_id: string | null; session_id: string; timestamp: number; payload_ref: string }): Promise<void> {
  await client.query(
    `MERGE (e:Event {id: $id})
     SET e.event_type  = $event_type,
         e.tool_use_id = $tool_use_id,
         e.turn_id     = $turn_id,
         e.session_id  = $session_id,
         e.timestamp   = $timestamp,
         e.payload_ref = $payload_ref`,
    p,
  );
}

/**
 * MetaDocument 노드 idempotent MERGE. PK = 합성 STRING `${kind}::${name}`.
 *
 *   동일 (kind, name) 의 ToolCall 이 N 번 들어와도 노드는 1개로 유지된다.
 *   read query 들은 `MATCH (md:MetaDocument {kind, name})` 로 property 매칭하므로
 *   PK 형태는 무관 — 단지 MERGE 의 idempotency 만 보장하면 충분.
 */
async function mergeMetaDocument(client: LadybugClient, p: MetaDocumentProps): Promise<void> {
  // `MetaDocumentProps` 는 명명 인터페이스라 Record<string, unknown> 와 구조적 호환은
  // 되지만 TS index-signature 검사를 통과 못해 spread 로 plain object 만들어 전달.
  await client.query(
    `MERGE (m:MetaDocument {id: $id})
     SET m.kind        = $kind,
         m.name        = $name,
         m.source      = $source,
         m.source_root = $source_root`,
    { ...p },
  );
}

/**
 * 엣지 MERGE — Ladybug 는 REL 에 직접 MERGE 가 제한적이라 MATCH 두 노드 + CREATE
 * REL 패턴 + duplicate 에러 흡수. 노드가 아직 없으면(드물게 enrich 순서 어긋남) MATCH
 * 가 0 row 라 그냥 no-op — 다음 tick 에서 재시도.
 */
async function mergeRel(client: LadybugClient, rel: RelOp): Promise<void> {
  const propsClause =
    rel.props && Object.keys(rel.props).length > 0
      ? ` {${Object.keys(rel.props)
          .map((k) => `${k}: $rel_${k}`)
          .join(', ')}}`
      : '';
  const params: Record<string, unknown> = {
    from_value: rel.from.value,
    to_value: rel.to.value,
  };
  if (rel.props) {
    for (const [k, v] of Object.entries(rel.props)) params[`rel_${k}`] = v;
  }

  // 중복 방지를 위해 먼저 존재 체크 — 없을 때만 CREATE.
  const checkCypher =
    `MATCH (a:${rel.from.label} {${rel.from.key}: $from_value})-[r:${rel.type}]->(b:${rel.to.label} {${rel.to.key}: $to_value}) ` +
    `RETURN count(r) AS cnt`;
  try {
    const check = await client.query(checkCypher, params);
    const cnt = Number((check.rows[0] as Record<string, unknown> | undefined)?.cnt ?? 0);
    if (cnt > 0) return; // 이미 존재 — idempotent.
  } catch {
    // count 조회 실패는 무시하고 CREATE 시도 — 중복 에러는 catch 에서 무시.
  }

  const createCypher =
    `MATCH (a:${rel.from.label} {${rel.from.key}: $from_value}), ` +
    `(b:${rel.to.label} {${rel.to.key}: $to_value}) ` +
    `CREATE (a)-[r:${rel.type}${propsClause}]->(b)`;
  try {
    await client.query(createCypher, params);
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (msg.includes('duplicate') || msg.includes('already exists')) return;
    throw err;
  }
}
