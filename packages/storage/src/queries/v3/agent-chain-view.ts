/**
 * agent_chain_view 쿼리 헬퍼 — R3 단일 writer (projection-worker D).
 *
 * 책임:
 *  - upsertAgentChainEdge : root → descendant 한 edge 를 멱등 upsert.
 *  - getDescendantsForRoot / sumDescendantTokens : anomaly_spike 등 read 측 SSoT.
 *
 * @see packages/storage/migrations/045-agent-chain-view.sql
 */

import type { Database } from 'bun:sqlite';

export interface AgentChainRow {
  root_tool_use_id: string;
  descendant_tool_use_id: string;
  session_id: string;
  depth: number;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  row_count: number;
  source_event_id: number;
  schema_version: number;
  updated_at: number;
}

export interface UpsertAgentChainEdgeParams {
  root_tool_use_id: string;
  descendant_tool_use_id: string;
  session_id: string;
  depth: number;
  tokens_input?: number;
  tokens_output?: number;
  tokens_total?: number;
  row_count?: number;
  source_event_id: number;
  updated_at?: number;
}

/** 한 edge (root, descendant) 멱등 upsert. */
export function upsertAgentChainEdge(db: Database, p: UpsertAgentChainEdgeParams): void {
  db.prepare(
    `INSERT OR REPLACE INTO agent_chain_view (
       root_tool_use_id, descendant_tool_use_id, session_id, depth,
       tokens_input, tokens_output, tokens_total, row_count,
       source_event_id, schema_version, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(
    p.root_tool_use_id,
    p.descendant_tool_use_id,
    p.session_id,
    p.depth,
    p.tokens_input ?? 0,
    p.tokens_output ?? 0,
    p.tokens_total ?? 0,
    p.row_count ?? 1,
    p.source_event_id,
    p.updated_at ?? Date.now(),
  );
}

/** 한 root 의 모든 descendants 조회. */
export function getDescendantsForRoot(db: Database, rootToolUseId: string): AgentChainRow[] {
  return db
    .query(
      `SELECT * FROM agent_chain_view
       WHERE root_tool_use_id = ?
       ORDER BY depth ASC, descendant_tool_use_id ASC`
    )
    .all(rootToolUseId) as AgentChainRow[];
}

/**
 * 한 root 의 descendants 토큰 합산 — WITH RECURSIVE 대체.
 *
 * depth>0 만 합산 (root 자신은 제외 — anomaly_spike 의도와 정합).
 */
export function sumDescendantTokens(
  db: Database,
  rootToolUseId: string,
): { tokens_input: number; tokens_output: number; tokens_total: number; row_count: number } {
  const row = db
    .query(
      `SELECT
         COALESCE(SUM(tokens_input), 0)  AS tokens_input,
         COALESCE(SUM(tokens_output), 0) AS tokens_output,
         COALESCE(SUM(tokens_total), 0)  AS tokens_total,
         COALESCE(SUM(row_count), 0)     AS row_count
       FROM agent_chain_view
       WHERE root_tool_use_id = ? AND depth > 0`
    )
    .get(rootToolUseId) as {
    tokens_input: number;
    tokens_output: number;
    tokens_total: number;
    row_count: number;
  };
  return row;
}

/**
 * 한 descendant 의 모든 ancestors 조회 (역방향, debugging).
 */
export function getAncestorsForDescendant(
  db: Database,
  descendantToolUseId: string,
): AgentChainRow[] {
  return db
    .query(
      `SELECT * FROM agent_chain_view
       WHERE descendant_tool_use_id = ?
       ORDER BY depth ASC`
    )
    .all(descendantToolUseId) as AgentChainRow[];
}

/** 행 수. */
export function countAgentChainView(db: Database): number {
  const row = db
    .query('SELECT COUNT(*) AS n FROM agent_chain_view')
    .get() as { n: number };
  return row.n;
}
