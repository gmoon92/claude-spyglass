/**
 * merge.ts — GraphOp[] → idempotent Cypher MERGE 실행
 *
 * 책임:
 *   enrich.ts 가 만든 GraphOp 배열을 LadybugClient 의 Cypher MERGE 문장으로 변환해
 *   op 단위 try/catch 로 순차 실행한다. Ladybug 0.16.x 의 transaction() 은 no-op 이라
 *   batch 단위 atomicity 는 보장되지 않으나, 모든 op 가 idempotent MERGE 라 부분적용/재시도
 *   모두 무해하다(아래 "디자인 결정" 참조).
 *
 * 의존성:
 *   - client.ts (LadybugClient.query / transaction)
 *   - sync/enrich.ts (GraphOp 타입)
 *
 * 호출 흐름:
 *   sync/worker.ts::tick()
 *     → for each outbox row: mergeOps(client, enrichOutboxRow(row))
 *     → mergeOps 가 op 단위 try/catch 로 { failed } 수집 (중단 없음)
 *     → worker 가 failed 로 row 의 attempts/dead 갱신 + cursor 정밀 전진
 *
 * 디자인 결정:
 *   - Ladybug 0.16.x 의 transaction() 은 no-op(롤백 없음) — batch atomicity 는 없고,
 *     모든 op 가 idempotent MERGE 라 재시도/부분적용 모두 무해(consistency-hardening P1).
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

/** 한 op 의 merge 실패 기록 — worker 가 row 단위 실패 집계/DLQ 판정에 사용. */
export interface FailedOp {
  op: GraphOp;
  error: unknown;
}

/** mergeOps 결과 — 실패한 op 목록. 비어 있으면 전부 성공. */
export interface MergeResult {
  failed: FailedOp[];
}

/**
 * GraphOp 배열을 순서대로 MERGE — op 단위 try/catch 로 격리.
 *
 * 설계 (consistency-hardening P1):
 *   Ladybug 0.16.x 의 transaction() 은 no-op(롤백 없음, client.ts 참조)이라 batch
 *   atomicity 는 애초에 없다. 따라서 한 op 가 throw 해도 *중단하지 않고* 계속 진행하며
 *   실패만 수집한다. 이렇게 하면 독성 op 1개가 같은 batch 의 나머지 정상 op 적재를
 *   막지 않는다(Head-of-Line 블로킹 제거). 모든 op 는 idempotent MERGE 라 다음 tick
 *   재시도 시 중복 손상이 없다.
 *
 *   호출자(worker)는 반환된 failed 를 보고 outbox row 단위로 attempts/dead 를 갱신하고
 *   cursor 전진을 정밀 제어한다.
 */
export async function mergeOps(client: LadybugClient, ops: GraphOp[]): Promise<MergeResult> {
  const failed: FailedOp[] = [];
  for (const op of ops) {
    try {
      await dispatchOp(client, op);
    } catch (error) {
      failed.push({ op, error });
    }
  }
  return { failed };
}

/** 단일 op 를 종류별 MERGE 헬퍼로 디스패치. exhaustive switch. */
async function dispatchOp(client: LadybugClient, op: GraphOp): Promise<void> {
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
 *
 * PARENT_OF single-parent 불변식 (subagent-sibling-parent 교정의 그래프 짝):
 *   한 ToolCall 은 부모가 정확히 1개라는 도메인 불변식을 가진다. RDB 측 persistSubagentChildren
 *   가 자식의 parent_tool_use_id 를 잘못된 형제(A)에서 권위값(B)으로 교정하면 outbox 'update' 가
 *   흘러와 enrich 가 PARENT_OF(B→child) 를 발행한다. 그러나 그래프 sync 가 CREATE-only 였던 탓에
 *   구 엣지 PARENT_OF(A→child) 가 잔존해 child 가 A·B 양쪽 자식으로 중복 표시됐다.
 *
 *   해결: PARENT_OF 를 CREATE 하기 전, 같은 child(to) 로 들어오는 *다른* parent(from≠B)의
 *   PARENT_OF 엣지를 먼저 DELETE 한다. self-healing(매 발행이 불변식을 재확정) · idempotent
 *   (현재 parent 엣지는 보존되어 중복/재추가 없음). DELETE 는 best-effort — 실패해도 정답 엣지
 *   CREATE 는 그대로 진행하고 throw 를 전파하지 않아(DLQ/HoL 위험 0) 다음 발행에서 수렴한다.
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

  // single-parent 불변식 강제 — PARENT_OF 한정. 같은 child 로 들어오는 다른 부모 엣지 제거.
  if (rel.type === 'PARENT_OF') {
    const deleteCypher =
      `MATCH (other:${rel.from.label})-[r:PARENT_OF]->(b:${rel.to.label} {${rel.to.key}: $to_value}) ` +
      `WHERE other.${rel.from.key} <> $from_value ` +
      `DELETE r`;
    try {
      await client.query(deleteCypher, params);
    } catch {
      // best-effort — DELETE 실패는 정답 엣지 CREATE 를 막지 않는다(throw 미전파).
      //   stale 엣지는 다음 PARENT_OF 발행(child-side/parent-side 양방향)에서 다시 제거 시도된다.
    }
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
