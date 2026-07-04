/**
 * Collector — 청크(sub-document) 단위 dedup (Axis A')
 *
 * @description
 *   payload를 통째로 해시하면(document 단위) conversation처럼 append-only로 자라는 본문은
 *   dedup이 0%로 나온다. 하지만 내부 블록(system / 각 message / 각 tool 정의)은 매 요청마다
 *   재등장하므로, 블록 단위로 쪼개 해시하면 실제 CAS(Git blob) 절감을 측정할 수 있다.
 *   dev 환경 실측에서 document 0.0% → chunk 95.2%가 확인된 바로 그 측정이다.
 *
 *   청크 추출 정책(content-class별):
 *     - proxy_requests.payload (conversation): **chunker.splitConversation에 위임** — CAS가 실제로
 *       저장하는 단위(envelope + system + messages[전체객체] + tools)와 동일하게 측정한다. 이렇게 해야
 *       profiler 수치가 "실제 CAS 절감"을 정직하게 반영한다(정공법 A). 측정 hash 집합 = artifacts.hash 집합.
 *     - request_payloads.payload (hook): CAS 대상이 아니므로 로컬 extractChunks 유지 — 배열이면
 *       원소별, 객체면 top-level 값별, 그 외 통짜.
 *
 * @dependencies bun:sqlite, ../../payload-codec, ../../artifacts(splitConversation/sha256HexBytes)
 * @flow profiler/index.ts → collectChunkDedup(db, key, sampleLimit)
 */

import type { Database } from 'bun:sqlite';
import { decodeText, decodeBlob } from '../../payload-codec';
import { splitConversation, sha256HexBytes } from '../../artifacts';
import type { ChunkDedupMeasure } from '../types';

type ContentClass = 'conversation' | 'hook';

interface ChunkTarget {
  table: string;
  column: string;
  algoColumn: string;
  kind: 'text' | 'blob';
  contentClass: ContentClass;
}

const TARGETS: ChunkTarget[] = [
  {
    table: 'proxy_requests',
    column: 'payload',
    algoColumn: 'payload_algo',
    kind: 'blob',
    contentClass: 'conversation',
  },
  {
    table: 'request_payloads',
    column: 'payload',
    algoColumn: 'payload_algo',
    kind: 'text',
    contentClass: 'hook',
  },
];

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function isEncrypted(algo: string | null): boolean {
  return algo === 'aes256gcm' || algo === 'zstd+aes256gcm';
}

/**
 * hook payload(request_payloads) 전용 청킹 — 배열이면 원소별, 객체면 top-level 값별, 그 외 통짜.
 * conversation 청킹은 chunker.splitConversation이 SSoT(정공법 A) — 여기서 다루지 않는다.
 * 추출 실패(JSON 파싱 불가)는 null.
 */
function extractHookChunks(text: string): string[] | null {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }

  const chunks: string[] = [];
  if (Array.isArray(obj)) {
    for (const el of obj) chunks.push(typeof el === 'string' ? el : JSON.stringify(el));
  } else if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj as Record<string, unknown>)) {
      chunks.push(typeof v === 'string' ? v : JSON.stringify(v));
    }
  } else {
    chunks.push(text);
  }
  return chunks;
}

function measureTarget(
  db: Database,
  t: ChunkTarget,
  key: Buffer | null,
  sampleLimit: number | null,
): ChunkDedupMeasure {
  const totalRows = (db.query(`SELECT COUNT(*) AS n FROM ${t.table}`).get() as { n: number }).n;
  const sampled = sampleLimit != null && totalRows > sampleLimit;
  const limitClause = sampled ? `LIMIT ${sampleLimit}` : '';
  const stmt = db.query(
    `SELECT ${t.column} AS val, ${t.algoColumn} AS algo FROM ${t.table} ${limitClause}`,
  );

  const uniq = new Map<string, number>(); // chunkHash → byte size
  let measuredRows = 0;
  let parseFailed = 0;
  let encryptedSkipped = 0;
  let chunkCount = 0;
  let totalChunkBytes = 0;

  for (const row of stmt.iterate() as IterableIterator<{
    val: string | Uint8Array | null;
    algo: string | null;
  }>) {
    if (row.val == null) continue;
    if (!key && isEncrypted(row.algo)) {
      encryptedSkipped++;
      continue;
    }
    let text: string;
    try {
      if (t.kind === 'text') {
        const plain = decodeText(row.val as string, row.algo, key);
        if (plain == null) continue;
        text = plain;
      } else {
        const raw = decodeBlob(row.val as Uint8Array, row.algo, key);
        if (raw == null) continue;
        text = decoder.decode(raw);
      }
    } catch {
      parseFailed++;
      continue;
    }

    // 정공법 A: conversation은 CAS 실제 저장 단위(splitConversation), hook은 로컬 extractHookChunks.
    const chunks =
      t.contentClass === 'conversation'
        ? (splitConversation(text)?.chunks ?? null)
        : extractHookChunks(text);
    if (chunks == null) {
      parseFailed++;
      continue;
    }
    measuredRows++;
    for (const c of chunks) {
      // 해시·바이트를 chunker/artifact-store와 동일 함수로 계산 → 측정 hash 집합 = artifacts.hash 집합.
      const bytes = encoder.encode(c);
      const size = bytes.byteLength;
      chunkCount++;
      totalChunkBytes += size;
      const h = sha256HexBytes(bytes);
      if (!uniq.has(h)) uniq.set(h, size);
    }
  }

  let uniqueChunkBytes = 0;
  for (const s of uniq.values()) uniqueChunkBytes += s;
  const savedBytes = totalChunkBytes - uniqueChunkBytes;

  return {
    table: t.table,
    column: t.column,
    measuredRows,
    totalRows,
    sampled,
    parseFailedRows: parseFailed,
    encryptedRowsSkipped: encryptedSkipped,
    chunkCount,
    uniqueChunkCount: uniq.size,
    totalChunkBytes,
    uniqueChunkBytes,
    savedBytes,
    savedPct: totalChunkBytes > 0 ? (savedBytes / totalChunkBytes) * 100 : 0,
    dupCountPct: chunkCount > 0 ? (1 - uniq.size / chunkCount) * 100 : 0,
  };
}

export function collectChunkDedup(
  db: Database,
  key: Buffer | null,
  sampleLimit: number | null,
): ChunkDedupMeasure[] {
  return TARGETS.map((t) => measureTarget(db, t, key, sampleLimit)).sort(
    (a, b) => b.savedBytes - a.savedBytes,
  );
}
