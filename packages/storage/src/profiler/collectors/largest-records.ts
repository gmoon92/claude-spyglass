/**
 * Collector — Top-100 대형 레코드
 *
 * @description
 *   개별 레코드 단위로 가장 큰 payload를 찾아낸다. 합계만으로는 안 보이는
 *   "단일 거대 레코드"(예: 비정상적으로 큰 tool output 한 건)를 드러내기 위함.
 *   각 payload 보유 컬럼에서 상위 N개를 뽑아 한 리스트로 병합·정렬한다.
 *
 * @dependencies bun:sqlite
 * @flow profiler/index.ts → collectLargest(db, limit)
 */

import type { Database } from 'bun:sqlite';
import type { LargestRecord } from '../types';

function normAlgo(algo: string | null): string {
  return algo && algo.trim() ? algo : 'plain';
}

export function collectLargest(db: Database, limit = 100): LargestRecord[] {
  const out: LargestRecord[] = [];

  // request_payloads — requests로 type/preview 조인
  for (const r of db
    .query(
      `SELECT rp.request_id AS id, length(rp.payload) AS sz, rp.payload_algo AS algo,
              r.type AS category, r.preview AS preview
       FROM request_payloads rp JOIN requests r ON r.id = rp.request_id
       ORDER BY sz DESC LIMIT ?`,
    )
    .all(limit) as {
    id: string;
    sz: number;
    algo: string | null;
    category: string | null;
    preview: string | null;
  }[]) {
    out.push({
      source: 'request_payloads',
      id: r.id,
      storedBytes: r.sz,
      algo: normAlgo(r.algo),
      category: r.category,
      preview: r.preview,
    });
  }

  // proxy_requests — request_preview를 미리보기로
  for (const r of db
    .query(
      `SELECT id, length(payload) AS sz, payload_algo AS algo, path AS category,
              request_preview AS preview
       FROM proxy_requests WHERE payload IS NOT NULL ORDER BY sz DESC LIMIT ?`,
    )
    .all(limit) as {
    id: string;
    sz: number;
    algo: string | null;
    category: string | null;
    preview: string | null;
  }[]) {
    out.push({
      source: 'proxy_requests',
      id: r.id,
      storedBytes: r.sz,
      algo: normAlgo(r.algo),
      category: r.category,
      preview: r.preview,
    });
  }

  // claude_events
  for (const r of db
    .query(
      `SELECT event_id AS id, length(payload) AS sz, payload_algo AS algo, event_type AS category
       FROM claude_events ORDER BY sz DESC LIMIT ?`,
    )
    .all(limit) as {
    id: string;
    sz: number;
    algo: string | null;
    category: string | null;
  }[]) {
    out.push({
      source: 'claude_events',
      id: r.id,
      storedBytes: r.sz,
      algo: normAlgo(r.algo),
      category: r.category,
      preview: null,
    });
  }

  return out.sort((a, b) => b.storedBytes - a.storedBytes).slice(0, limit);
}
