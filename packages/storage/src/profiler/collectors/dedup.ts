/**
 * Collector — content dedup 측정 (Axis A: 평문 기준) + 이미 실현된 dedup
 *
 * @description
 *   "CAS를 적용하면 얼마나 줄어드나"의 이론적 상한을 평문 기준으로 측정한다.
 *   ⚠️ 측정 함정 두 가지를 여기서 흡수한다:
 *     1) 압축 바이트를 해시하면 가짜 dedup이 나온다 → payload-codec로 평문 디코드 후 해시.
 *     2) AES-256-GCM은 랜덤 nonce라 동일 평문도 암호문이 전부 다르다 → 키 없으면
 *        해당 행을 "측정 불가(encrypted)"로 분리하고 분모에서 제외(가짜 0% dedup 방지).
 *
 *   system_prompts는 이미 SHA-256 PK + ref_count CAS이므로 "이론 상한"이 아니라
 *   "이미 실현된 절감"을 byte_size×ref_count vs byte_size로 직접 산출한다.
 *
 * @dependencies bun:sqlite, ../../payload-codec, Bun.CryptoHasher
 * @flow profiler/index.ts → collectDedup(db, key, sampleLimit) / collectRealizedDedup(db)
 */

import type { Database } from 'bun:sqlite';
import { decodeText, decodeBlob } from '../../payload-codec';
import type { DedupMeasure, RealizedDedup } from '../types';

type ColumnKind = 'text' | 'blob';

interface DedupTarget {
  table: string;
  column: string;
  idColumn: string;
  algoColumn: string;
  kind: ColumnKind;
}

const TARGETS: DedupTarget[] = [
  {
    table: 'request_payloads',
    column: 'payload',
    idColumn: 'request_id',
    algoColumn: 'payload_algo',
    kind: 'text',
  },
  {
    table: 'claude_events',
    column: 'payload',
    idColumn: 'event_id',
    algoColumn: 'payload_algo',
    kind: 'text',
  },
  {
    table: 'proxy_requests',
    column: 'payload',
    idColumn: 'id',
    algoColumn: 'payload_algo',
    kind: 'blob',
  },
];

/** 평문(또는 raw 바이트)의 byte 길이와 sha256을 함께 반환. */
function hashPlain(bytes: Uint8Array): { hash: string; size: number } {
  const h = new Bun.CryptoHasher('sha256');
  h.update(bytes);
  return { hash: h.digest('hex'), size: bytes.byteLength };
}

const encoder = new TextEncoder();

/** algo 마커가 암호화 계열인지(키 없으면 측정 불가). */
function isEncrypted(algo: string | null): boolean {
  return algo === 'aes256gcm' || algo === 'zstd+aes256gcm';
}

function measureTarget(
  db: Database,
  t: DedupTarget,
  key: Buffer | null,
  sampleLimit: number | null,
): DedupMeasure {
  const totalRows = (
    db.query(`SELECT COUNT(*) AS n FROM ${t.table}`).get() as { n: number }
  ).n;

  const sampled = sampleLimit != null && totalRows > sampleLimit;
  const limitClause = sampled ? `ORDER BY ${t.idColumn} LIMIT ${sampleLimit}` : '';
  const stmt = db.query(
    `SELECT ${t.column} AS val, ${t.algoColumn} AS algo FROM ${t.table} ${limitClause}`,
  );

  // hash → 평문 byte size. 같은 해시는 한 번만 계산되므로 첫 size를 신뢰.
  const uniq = new Map<string, number>();
  let measuredRows = 0;
  let plaintextBytes = 0;
  let encryptedSkipped = 0;
  let errorSkipped = 0;

  for (const row of stmt.iterate() as IterableIterator<{
    val: string | Uint8Array | null;
    algo: string | null;
  }>) {
    if (row.val == null) continue;
    // 키 없는 암호문은 평문화 불가 → 분리 집계(분모 제외).
    if (!key && isEncrypted(row.algo)) {
      encryptedSkipped++;
      continue;
    }
    try {
      let bytes: Uint8Array;
      if (t.kind === 'text') {
        const plain = decodeText(row.val as string, row.algo, key);
        if (plain == null) continue;
        bytes = encoder.encode(plain);
      } else {
        const raw = decodeBlob(row.val as Uint8Array, row.algo, key);
        if (raw == null) continue;
        bytes = raw;
      }
      const { hash, size } = hashPlain(bytes);
      measuredRows++;
      plaintextBytes += size;
      if (!uniq.has(hash)) uniq.set(hash, size);
    } catch {
      // 디코드 실패(키 불일치/손상) — 측정 불가로 분리.
      errorSkipped++;
    }
  }

  let uniqueBytes = 0;
  for (const s of uniq.values()) uniqueBytes += s;
  const savedBytes = plaintextBytes - uniqueBytes;

  return {
    table: t.table,
    column: t.column,
    measuredRows,
    totalRows,
    sampled,
    encryptedRowsSkipped: encryptedSkipped,
    errorRowsSkipped: errorSkipped,
    plaintextBytes,
    uniqueBytes,
    savedBytes,
    savedPct: plaintextBytes > 0 ? (savedBytes / plaintextBytes) * 100 : 0,
    uniqueRatio: measuredRows > 0 ? uniq.size / measuredRows : 0,
  };
}

export function collectDedup(
  db: Database,
  key: Buffer | null,
  sampleLimit: number | null,
): DedupMeasure[] {
  return TARGETS.map((t) => measureTarget(db, t, key, sampleLimit)).sort(
    (a, b) => b.savedBytes - a.savedBytes,
  );
}

/** system_prompts — 이미 적용된 CAS의 실현 절감. */
export function collectRealizedDedup(db: Database): RealizedDedup[] {
  const r = db
    .query(
      `SELECT COUNT(*) AS rows,
              COALESCE(SUM(byte_size * ref_count),0) AS logical,
              COALESCE(SUM(byte_size),0) AS uniq,
              COALESCE(MAX(ref_count),0) AS maxref
       FROM system_prompts`,
    )
    .get() as { rows: number; logical: number; uniq: number; maxref: number };

  const saved = r.logical - r.uniq;
  return [
    {
      table: 'system_prompts',
      logicalBytes: r.logical,
      uniqueBytes: r.uniq,
      savedBytes: saved,
      savedPct: r.logical > 0 ? (saved / r.logical) * 100 : 0,
      refCountMax: r.maxref,
      rows: r.rows,
    },
  ];
}
