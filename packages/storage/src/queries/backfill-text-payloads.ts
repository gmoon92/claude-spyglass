/**
 * backfill-text-payloads — Phase 4 기존 TEXT payload zstd 압축 백필 (roadmap Phase 4 후속)
 *
 * @description
 *   payload-codec의 encodeText는 512B+ TEXT를 zstd(-b64)로 압축하지만, 코덱 도입 '이전'에 쓰인
 *   기존 행은 평문(algo NULL) 또는 암호화만(aes256gcm)이라 미압축이다. 이 백필은 그 기존 행을
 *   decode→encodeText 재인코딩해 압축 형태(zstd-b64[/+aes256gcm])로 전환한다(신규 쓰기는 이미 압축).
 *
 *   대상 TEXT 컬럼(codec SSoT payload-codec.ts): request_payloads.payload(061) ·
 *   claude_events.payload(056) · system_prompts.content(056). proxy_requests.payload는 BLOB+CAS라
 *   대상 아님(backfillProxyPayloadToCas 별도).
 *
 *   안전 불변식(backfillProxyPayloadToCas 미러):
 *   - 행별 round-trip 검증(decodeText(재인코딩) === 원본 평문) 통과 시에만 UPDATE.
 *   - keyset 커서(PK ASC)로 스캔·skip 행 모두 전진 → 무한루프 없음. dry-run은 UPDATE만 생략.
 *   - 멱등: 후보 필터가 '미압축(NULL/aes256gcm)'만 잡아 이미 압축된 행은 재처리 안 함.
 *   - 압축 이득 없으면(<512B 등 encodeText가 비-zstd 반환) 건드리지 않음(skippedNoGain).
 *
 *   key: 암호화 ON이면 aes256gcm 행 decode + 재암호화에 필요(resolveEncryptionKey). key 부재 시
 *   평문(NULL) 행만 후보(암호문은 decode 불가라 제외).
 *
 * @dependencies bun:sqlite, ../payload-codec(encodeText/decodeText)
 * @flow packages/server/scripts/backfill-text-payloads.ts(CLI, bun run backfill:text-payloads) → backfillTextPayloads(db, {key, dryRun, ...})
 */

import type { Database } from 'bun:sqlite';
import { encodeText, decodeText, type PayloadAlgo } from '../payload-codec';

/** 대상 TEXT 컬럼 명세(테이블·PK·값·algo 컬럼명). */
interface TextPayloadSpec {
  table: string;
  idCol: string;
  valueCol: string;
  algoCol: string;
}

const SPECS: readonly TextPayloadSpec[] = [
  { table: 'request_payloads', idCol: 'request_id', valueCol: 'payload',  algoCol: 'payload_algo' },
  { table: 'claude_events',    idCol: 'event_id',   valueCol: 'payload',  algoCol: 'payload_algo' },
  { table: 'system_prompts',   idCol: 'hash',       valueCol: 'content',  algoCol: 'content_algo' },
];

/** encodeText가 실제 압축을 채택했음을 의미하는 algo(그 외는 압축 이득 없음). */
const COMPRESSED_ALGOS: ReadonlySet<PayloadAlgo> = new Set<PayloadAlgo>(['zstd-b64', 'zstd-b64+aes256gcm']);

export interface TextBackfillTableResult {
  scanned: number;
  compressed: number;
  skippedNoGain: number;
  skippedRoundtrip: number;
}

export interface TextBackfillResult {
  byTable: Record<string, TextBackfillTableResult>;
}

export interface TextBackfillOptions {
  /** 암호화 키(resolveEncryptionKey 결과). null=평문 경로(평문 행만 후보). */
  key?: Buffer | null;
  /** 배치 크기(트랜잭션 단위). 기본 200. */
  batchSize?: number;
  /** 스캔 상한(테이블별). null=무제한. */
  limit?: number | null;
  /** true면 UPDATE 생략(계측만). */
  dryRun?: boolean;
}

/**
 * 3개 TEXT payload 테이블의 기존 미압축 행을 zstd 압축으로 백필한다.
 * @returns 테이블별 {scanned, compressed, skippedNoGain, skippedRoundtrip}
 */
export function backfillTextPayloads(db: Database, opts: TextBackfillOptions = {}): TextBackfillResult {
  const key = opts.key ?? null;
  const byTable: Record<string, TextBackfillTableResult> = {};
  for (const spec of SPECS) {
    byTable[spec.table] = backfillTable(db, spec, key, opts);
  }
  return { byTable };
}

/** 단일 테이블 백필 — keyset 커서로 배치 순회, 행별 재인코딩+round-trip. */
function backfillTable(
  db: Database,
  spec: TextPayloadSpec,
  key: Buffer | null,
  opts: TextBackfillOptions,
): TextBackfillTableResult {
  const batchSize = opts.batchSize ?? 200;
  const limit = opts.limit ?? null;
  const dryRun = opts.dryRun ?? false;
  const r: TextBackfillTableResult = { scanned: 0, compressed: 0, skippedNoGain: 0, skippedRoundtrip: 0 };

  // 후보 = 아직 압축 안 된 형태만. 평문은 NULL 외에 레거시 값도 포함한다 — request_payloads 는
  // 021 의 죽은 DEFAULT 'zstd'(실제로는 평문 TEXT, decodeText passthrough)를 062/063 이관으로
  // 물려받았을 수 있다. 압축·암호 마커가 아닌 값은 전부 평문으로 본다(decodeText 분기와 동일 기준).
  // key 없으면 암호문(aes256gcm)은 decode 불가라 제외.
  const plainCond = `(${spec.algoCol} IS NULL OR ${spec.algoCol} NOT IN ('aes256gcm', 'zstd-b64', 'zstd-b64+aes256gcm'))`;
  const candidate = key
    ? `(${plainCond} OR ${spec.algoCol} = 'aes256gcm')`
    : plainCond;
  const scanSql = `
    SELECT ${spec.idCol} AS id, ${spec.valueCol} AS value, ${spec.algoCol} AS algo
      FROM ${spec.table}
     WHERE ${candidate} AND ${spec.idCol} > ?
     ORDER BY ${spec.idCol} ASC
     LIMIT ?`;
  const updSql = `UPDATE ${spec.table} SET ${spec.valueCol} = ?, ${spec.algoCol} = ? WHERE ${spec.idCol} = ?`;
  const scan = db.query(scanSql);

  // keyset 커서 — 스캔·skip 행 모두 넘겨 무한루프 방지(dryRun/skippedNoGain도 전진).
  let lastId = '';
  for (;;) {
    if (limit !== null && r.scanned >= limit) break;
    const take = limit === null ? batchSize : Math.min(batchSize, limit - r.scanned);
    if (take <= 0) break;

    const rows = scan.all(lastId, take) as { id: string; value: string | null; algo: string | null }[];
    if (rows.length === 0) break;

    db.transaction(() => {
      for (const row of rows) {
        lastId = row.id;
        r.scanned++;
        const plain = decodeText(row.value, row.algo, key);
        if (plain == null) { r.skippedNoGain++; continue; }
        const enc = encodeText(plain, key);
        // encodeText가 압축을 채택하지 않았으면(<512B/이득 없음) 원본 유지.
        if (!COMPRESSED_ALGOS.has(enc.algo)) { r.skippedNoGain++; continue; }
        // round-trip 안전 축: 재디코드가 원본과 동일할 때만 기록.
        if (decodeText(enc.value, enc.algo, key) !== plain) { r.skippedRoundtrip++; continue; }
        if (!dryRun) db.run(updSql, [enc.value, enc.algo ?? null, row.id]);
        r.compressed++;
      }
    })();
  }
  return r;
}
