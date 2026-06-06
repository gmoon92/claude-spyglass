#!/usr/bin/env bun
/**
 * getTurnsBySession 단계별 분해 측정.
 *
 * 각 SQL 쿼리 + JS 처리를 분리해서 실측. 어느 단계가 진짜 병목인지 식별.
 */

import { SpyglassDatabase, closeDatabase } from '../connection';
import { ACTIVE_REQUEST_FILTER_SQL } from '../queries/request/read';

const SID = process.argv[2] || '81ce9006-2141-40fb-b5db-7a4122360cd5';
const ITER = 20;

const db = new SpyglassDatabase({ dbPath: '/tmp/spyglass-bench.db' });
const d = db.instance;

function measure(name: string, fn: () => unknown): void {
  for (let i = 0; i < 3; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < ITER; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  console.log(`${name.padEnd(55)} p50=${p50.toFixed(2).padStart(7)}ms  p95=${p95.toFixed(2).padStart(7)}ms`);
}

console.log(`\n=== turn breakdown (session=${SID.slice(0, 8)}, iter=${ITER}) ===\n`);

measure('SQL 1 unified (all requests, all cols + payload)', () => {
  d.query(`
    SELECT r.turn_id, r.id, r.timestamp, r.type, r.preview, p.payload,
           r.tokens_input, r.tokens_output, r.tokens_total, r.duration_ms,
           r.model, r.cache_read_tokens, r.cache_creation_tokens, r.tokens_confidence,
           r.tool_name, r.tool_detail, r.event_type, r.parent_tool_use_id
    FROM requests r
    LEFT JOIN request_payloads p ON p.request_id = r.id
    WHERE r.session_id = ? AND r.turn_id IS NOT NULL
      AND r.type IN ('prompt', 'tool_call', 'response')
      AND ${ACTIVE_REQUEST_FILTER_SQL}
    ORDER BY r.turn_id, r.timestamp ASC
  `).all(SID);
});

measure('SQL 1b unified (no payload)', () => {
  d.query(`
    SELECT turn_id, id, timestamp, type, preview,
           tokens_input, tokens_output, tokens_total, duration_ms,
           model, cache_read_tokens, cache_creation_tokens, tokens_confidence,
           tool_name, tool_detail, event_type, parent_tool_use_id
    FROM requests
    WHERE session_id = ? AND turn_id IS NOT NULL
      AND type IN ('prompt', 'tool_call', 'response')
      AND ${ACTIVE_REQUEST_FILTER_SQL}
    ORDER BY turn_id, timestamp ASC
  `).all(SID);
});

measure('SQL 1c unified (only id + small)', () => {
  d.query(`
    SELECT turn_id, id, timestamp, type
    FROM requests
    WHERE session_id = ? AND turn_id IS NOT NULL
      AND type IN ('prompt', 'tool_call', 'response')
      AND ${ACTIVE_REQUEST_FILTER_SQL}
    ORDER BY turn_id, timestamp ASC
  `).all(SID);
});

measure('SQL 2 proxy system_hash (4137 rows)', () => {
  d.query(`
    SELECT turn_id, system_hash, system_byte_size FROM (
      SELECT turn_id, system_hash, system_byte_size,
             ROW_NUMBER() OVER (PARTITION BY turn_id ORDER BY timestamp ASC) AS rn
      FROM proxy_requests
      WHERE session_id = ? AND turn_id IS NOT NULL AND system_hash IS NOT NULL
    ) WHERE rn = 1
  `).all(SID);
});

measure('SQL 2b proxy system_reminder', () => {
  d.query(`
    SELECT turn_id, system_reminder FROM (
      SELECT turn_id, system_reminder,
             ROW_NUMBER() OVER (PARTITION BY turn_id ORDER BY timestamp DESC) AS rn
      FROM proxy_requests
      WHERE session_id = ? AND turn_id IS NOT NULL AND system_reminder IS NOT NULL
    ) WHERE rn = 1
  `).all(SID);
});

measure('SQL 2c proxy beta', () => {
  d.query(`
    SELECT turn_id, anthropic_beta FROM (
      SELECT turn_id, anthropic_beta,
             ROW_NUMBER() OVER (PARTITION BY turn_id ORDER BY timestamp ASC) AS rn
      FROM proxy_requests
      WHERE session_id = ? AND turn_id IS NOT NULL
    ) WHERE rn = 1
  `).all(SID);
});

measure('JS Map build (5062 rows)', () => {
  const rows = d.query(`
    SELECT r.turn_id, r.id, r.timestamp, r.type, r.preview, p.payload
    FROM requests r
    LEFT JOIN request_payloads p ON p.request_id = r.id
    WHERE r.session_id = ? AND r.turn_id IS NOT NULL
    ORDER BY r.turn_id, r.timestamp ASC
  `).all(SID) as Array<{turn_id: string; id: string; timestamp: number; type: string; preview: string | null; payload: string | null}>;
  const map = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = map.get(r.turn_id);
    if (arr) arr.push(r);
    else map.set(r.turn_id, [r]);
  }
});

console.log('');
closeDatabase();
