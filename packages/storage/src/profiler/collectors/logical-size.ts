/**
 * Collector — payload 컬럼 논리 크기 + 의미 단위 분해
 *
 * @description
 *   대용량 본문이 사는 컬럼별로 저장 바이트(SUM(length))·행수·algo 분해를 구한다.
 *   실제 payload 보유 컬럼(2026-06 스키마 기준):
 *     - request_payloads.payload (TEXT, 평문|aes256gcm) — requests.type으로 분해
 *     - proxy_requests.payload   (BLOB, zstd|zstd+aes256gcm) — payload_raw_size로 원본 추적
 *     - claude_events.payload    (TEXT, 평문|aes256gcm) — event_type으로 분해
 *   system_prompts.content은 이미 CAS라 realized-dedup 수집기에서 별도 처리.
 *
 * @dependencies bun:sqlite
 * @flow profiler/index.ts → collectLogical(db)
 */

import type { Database } from 'bun:sqlite';
import type { AlgoBreakdown, ColumnLogical } from '../types';

/** algo 컬럼의 NULL/빈값을 'plain'으로 정규화(평문 마커). */
function normAlgo(algo: string | null): string {
  return algo && algo.trim() ? algo : 'plain';
}

/** algo별 행수/저장바이트 분해. */
function algoBreakdown(
  db: Database,
  table: string,
  column: string,
  algoColumn: string,
): AlgoBreakdown[] {
  const rows = db
    .query(
      `SELECT ${algoColumn} AS algo, COUNT(*) AS rows, COALESCE(SUM(length(${column})),0) AS stored
       FROM ${table} GROUP BY ${algoColumn}`,
    )
    .all() as { algo: string | null; rows: number; stored: number }[];
  return rows
    .map((r) => ({ algo: normAlgo(r.algo), rows: r.rows, storedBytes: r.stored }))
    .sort((a, b) => b.storedBytes - a.storedBytes);
}

/** 단일 컬럼의 기본 집계(행수/저장합/최대). rawColumn이 있으면 원본 크기 합도. */
function baseAgg(
  db: Database,
  table: string,
  column: string,
  rawColumn: string | null,
): { rows: number; stored: number; max: number; raw: number | null } {
  const rawExpr = rawColumn ? `COALESCE(SUM(${rawColumn}),0)` : 'NULL';
  const r = db
    .query(
      `SELECT COUNT(*) AS rows,
              COALESCE(SUM(length(${column})),0) AS stored,
              COALESCE(MAX(length(${column})),0) AS max,
              ${rawExpr} AS raw
       FROM ${table}`,
    )
    .get() as { rows: number; stored: number; max: number; raw: number | null };
  return { rows: r.rows, stored: r.stored, max: r.max, raw: r.raw };
}

export function collectLogical(db: Database): ColumnLogical[] {
  const out: ColumnLogical[] = [];

  // 1) request_payloads.payload — requests.type으로 분해
  {
    const agg = baseAgg(db, 'request_payloads', 'payload', null);
    const byCategory = db
      .query(
        `SELECT r.type AS category, COUNT(*) AS rows, COALESCE(SUM(length(rp.payload)),0) AS stored
         FROM request_payloads rp JOIN requests r ON r.id = rp.request_id
         GROUP BY r.type ORDER BY stored DESC`,
      )
      .all() as { category: string; rows: number; stored: number }[];
    out.push({
      table: 'request_payloads',
      column: 'payload',
      rows: agg.rows,
      storedBytes: agg.stored,
      rawBytes: null,
      maxStoredBytes: agg.max,
      byAlgo: algoBreakdown(db, 'request_payloads', 'payload', 'payload_algo'),
      byCategory: byCategory.map((c) => ({
        category: c.category,
        rows: c.rows,
        storedBytes: c.stored,
      })),
    });
  }

  // 2) proxy_requests.payload — BLOB, zstd. 원본 크기는 payload_raw_size.
  {
    const agg = baseAgg(db, 'proxy_requests', 'payload', 'payload_raw_size');
    out.push({
      table: 'proxy_requests',
      column: 'payload',
      rows: agg.rows,
      storedBytes: agg.stored,
      rawBytes: agg.raw,
      maxStoredBytes: agg.max,
      byAlgo: algoBreakdown(db, 'proxy_requests', 'payload', 'payload_algo'),
    });
  }

  // 3) claude_events.payload — event_type으로 분해
  {
    const agg = baseAgg(db, 'claude_events', 'payload', null);
    const byCategory = db
      .query(
        `SELECT event_type AS category, COUNT(*) AS rows, COALESCE(SUM(length(payload)),0) AS stored
         FROM claude_events GROUP BY event_type ORDER BY stored DESC`,
      )
      .all() as { category: string; rows: number; stored: number }[];
    out.push({
      table: 'claude_events',
      column: 'payload',
      rows: agg.rows,
      storedBytes: agg.stored,
      rawBytes: null,
      maxStoredBytes: agg.max,
      byAlgo: algoBreakdown(db, 'claude_events', 'payload', 'payload_algo'),
      byCategory: byCategory.map((c) => ({
        category: c.category ?? '(null)',
        rows: c.rows,
        storedBytes: c.stored,
      })),
    });
  }

  return out.sort((a, b) => b.storedBytes - a.storedBytes);
}
