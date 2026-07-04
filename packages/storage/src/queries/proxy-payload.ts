/**
 * proxy-payload — proxy_requests.payload 재조립 단일 진실 소스 (CAS Phase 3)
 *
 * @description
 *   proxy payload를 "평문 JSON 문자열"로 복원하는 유일한 경로. 두 저장 방식을 행 단위 신호
 *   컬럼(payload_manifest_algo)으로 자동 분기해, 소비처(routes/proxy.ts·cli/analyze.ts·
 *   backfill-system-prompts.ts)는 저장 방식을 몰라도 되게 한다(분기 분산 = silent corruption
 *   위험이므로 한 곳에 모은다 — payload-codec.ts와 같은 철학).
 *
 *   분기:
 *     'chunks/v1' (CAS)  : proxy_request_chunks(seq ASC) → 각 청크 artifact load → joinConversation.
 *     NULL        (레거시): payload BLOB 직접 decodeBlob(payload_algo 분기). 기존 동작 그대로.
 *     그 외/빈 body       : text=null.
 *
 *   역호환 불변식: payload_manifest_algo가 NULL인 모든 기존 행은 레거시 분기로 흘러 100%
 *     기존 동작을 유지한다. CAS 도입 후에도 레거시 행 읽기는 절대 바뀌지 않는다.
 *
 *   읽기 키 정책: system-prompt.ts:getSystemPromptByHash와 동일하게, shouldEncrypt() 게이트와
 *     무관하게 getActiveKey()로 항상 복호를 시도한다(암호화를 끈 뒤에도 과거 암호문 읽기 유지).
 *
 *   graceful: 디코드/재조립 실패는 throw하지 않고 { text:null, error } 로 반환한다. 소비처는
 *     200 with empty(+decode_error)로 응답해 UI가 죽지 않게 한다(기존 routes/proxy.ts 정책 계승).
 *
 * @dependencies bun:sqlite, ../artifacts(SqliteArtifactStore/joinConversation), ../payload-codec, ../runtime/encryption
 * @flow routes/proxy.ts·cli/analyze.ts·backfill-system-prompts.ts → reconstructProxyPayloadText
 */

import type { Database } from 'bun:sqlite';
import { decodeBlob } from '../payload-codec';
import { getActiveKey } from '../runtime/encryption';
import { SqliteArtifactStore, joinConversation, splitConversation, type SplitConversation } from '../artifacts';
import { upsertSystemPrompt } from './system-prompt';
import type { ProxyRequest } from './proxy';

/** 재조립 결과. text=복원된 payload 평문(빈 body면 null), error=graceful 실패 메시지. */
export interface ReconstructedPayload {
  text: string | null;
  error: string | null;
}

/** proxy payload 저장 방식 신호 값 — CAS 청크 매니페스트 v1. */
export const MANIFEST_CHUNKS_V1 = 'chunks/v1';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SQL_CHUNKS = `SELECT seq, chunk_hash FROM proxy_request_chunks WHERE request_id = ? ORDER BY seq ASC`;
const SQL_INSERT_CHUNK = `INSERT INTO proxy_request_chunks (request_id, seq, chunk_hash) VALUES (?, ?, ?)`;

/**
 * proxy payload 청크를 CAS에 저장하고 manifest(proxy_request_chunks)를 기록한다.
 * reconstructProxyPayloadText의 쓰기 짝 — CAS write/read 로직을 한 모듈(SSoT)에 둔다.
 *
 * 반드시 persistProxyRequest의 db.transaction 안에서 호출되어야 원자적이다(artifact store +
 * manifest INSERT가 proxy_requests INSERT와 함께 commit/rollback).
 *
 * @param db         persist 트랜잭션과 같은 connection
 * @param requestId  proxy_requests.id
 * @param chunks     splitConversation 결과(chunks[0]=envelope, 이후 블록). seq는 이 배열 인덱스.
 * @param nowMs      artifacts first_seen_at/last_seen_at (요청 timestamp)
 */
export function storeProxyPayloadChunks(
  db: Database,
  requestId: string,
  chunks: string[],
  nowMs: number,
): void {
  // 쓰기 키 정책: shouldEncrypt() 게이트를 따른다(SqliteArtifactStore 기본 동작 — key 미주입).
  const store = new SqliteArtifactStore(db, nowMs);
  chunks.forEach((text, seq) => {
    const ref = store.store(encoder.encode(text));
    db.run(SQL_INSERT_CHUNK, [requestId, seq, ref.hash]);
  });
}

/** reconstructProxyPayloadText가 필요로 하는 최소 행 형태. */
type PayloadRow = Pick<
  ProxyRequest,
  'id' | 'payload' | 'payload_algo' | 'payload_manifest_algo'
>;

/**
 * proxy_requests 한 행의 payload를 원본 평문 JSON 문자열로 복원한다.
 *
 * @param db   bun:sqlite Database (CAS 행이면 artifacts/proxy_request_chunks 조회)
 * @param row  최소 {id, payload, payload_algo, payload_manifest_algo}
 * @returns ReconstructedPayload — 실패해도 throw 없이 error 필드로 보고
 */
export function reconstructProxyPayloadText(db: Database, row: PayloadRow): ReconstructedPayload {
  // 읽기는 항상 getActiveKey()로 복호 시도(shouldEncrypt 게이트 무관 — system-prompt.ts와 동일).
  const key = getActiveKey();

  // 분기 1 — CAS: manifest(seq 순서)로 청크를 모아 재조립.
  if (row.payload_manifest_algo === MANIFEST_CHUNKS_V1) {
    try {
      const store = new SqliteArtifactStore(db, 0, { key }); // nowMs는 load에 미사용 → 0.
      const chunkRows = db.query(SQL_CHUNKS).all(row.id) as Array<{ seq: number; chunk_hash: string }>;
      if (chunkRows.length === 0) {
        return { text: null, error: 'CAS manifest empty' };
      }
      const chunkTexts = chunkRows.map((c) => decoder.decode(store.load(c.chunk_hash)));
      return { text: joinConversation(chunkTexts), error: null };
    } catch (err) {
      return { text: null, error: (err as Error).message ?? 'CAS reconstruct failed' };
    }
  }

  // 분기 2 — 레거시: payload BLOB 직접 디코드(기존 routes/proxy.ts:57-66 로직 이관).
  if (row.payload instanceof Uint8Array && row.payload.byteLength > 0) {
    try {
      const raw = decodeBlob(row.payload, row.payload_algo, key);
      return { text: raw ? decoder.decode(raw) : null, error: null };
    } catch (err) {
      return { text: null, error: (err as Error).message ?? 'decode failed' };
    }
  }

  // 빈 body — 정상(예: payload 미수집 행).
  return { text: null, error: null };
}

// =============================================================================
// 레거시 → CAS 대량 백필 (정공법 C)
// =============================================================================

const SQL_BACKFILL_SCAN = `
  SELECT id, timestamp, payload, payload_algo, payload_manifest_algo, system_hash
  FROM proxy_requests
  WHERE payload_manifest_algo IS NULL AND payload IS NOT NULL
    AND (timestamp > ? OR (timestamp = ? AND id > ?))
  ORDER BY timestamp ASC, id ASC
  LIMIT ?
`;
const SQL_BACKFILL_CONVERT = `
  UPDATE proxy_requests
  SET payload = NULL, payload_algo = NULL, payload_manifest_algo = '${MANIFEST_CHUNKS_V1}'
  WHERE id = ? AND payload_manifest_algo IS NULL
`;
const SQL_BACKFILL_SYSHASH = `
  UPDATE proxy_requests SET system_hash = ?, system_byte_size = ?
  WHERE id = ? AND system_hash IS NULL
`;

/** normalizeSystem 주입 형태 — server의 system-hash.ts NormalizedSystem과 구조 동일(역의존 회피). */
type NormalizeSystemFn = (
  system: unknown,
) => { hash: string; normalized: string; byteSize: number; segmentCount: number } | null;

/** backfillProxyPayloadToCas 옵션. */
export interface BackfillCasOptions {
  /** 배치 크기(트랜잭션 단위). 기본 100. */
  batchSize?: number;
  /** true면 round-trip 검증까지만 하고 DB를 바꾸지 않음(카운트만). 기본 false. */
  dryRun?: boolean;
  /** 스캔 상한(전체는 null). 기본 null. */
  limit?: number | null;
  /**
   * system_hash 동시 백필 훅. server의 normalizeSystem 주입(storage→server 역의존 회피).
   * 미주입 시 system_hash 백필 생략. payload를 NULL로 만들기 '전'에 처리해 순서 트랩을 없앤다.
   */
  normalizeSystem?: NormalizeSystemFn;
  /** 배치 커밋 후 진행 콜백. */
  onBatch?: (p: { done: number; converted: number }) => void;
  /** @internal 테스트 전용 — round-trip mismatch/배치 원자성 유발용. 프로덕션 미주입(기본 chunker). */
  _split?: (text: string) => SplitConversation | null;
  /** @internal 테스트 전용. */
  _join?: (chunkTexts: string[]) => string;
}

/** backfillProxyPayloadToCas 결과 카운트. */
export interface BackfillCasResult {
  scanned: number;
  converted: number;
  skippedNonConversation: number;
  skippedRoundtripMismatch: number;
  skippedDecodeError: number;
  systemBackfilled: number;
}

/** round-trip 안전 축 — 재조립 결과가 원본과 JSON semantic 동일한가(문자열 비교 금지: split/join이 정규화함). */
function deepEqualJson(a: string, b: string): boolean {
  return Bun.deepEquals(JSON.parse(a), JSON.parse(b), true);
}

interface BackfillScanRow {
  id: string;
  timestamp: number;
  payload: Uint8Array | null;
  payload_algo: string | null;
  payload_manifest_algo: string | null;
  system_hash: string | null;
}

/**
 * 레거시 proxy_requests.payload(통짜 BLOB)를 CAS 청크 저장으로 전환한다(비가역).
 *
 * 안전 불변식: 행별 round-trip 검증(deepEqualJson)을 통과한 경우에만 payload를 NULL로 만든다.
 * 검증 실패·비-conversation·디코드 실패 행은 payload를 절대 건드리지 않고 skip한다.
 *
 * 처리 순서(배치 트랜잭션 내, 행별):
 *   a. reconstructProxyPayloadText로 평문 복원(레거시 분기, decodeBlob 직접호출 금지 = SSoT).
 *   b. splitConversation → null이면 비-conversation skip.
 *   c. round-trip 검증(join 후 deepEqualJson). join throw도 mismatch로 흡수.
 *   d. system_hash 동시 백필(normalizeSystem 주입 시) — e '이전'(순서 트랩 해소).
 *   e. storeProxyPayloadChunks + payload=NULL 전환.
 * keyset 커서(timestamp,id)로 진행 — offset은 dryRun 무한루프/실전환 어긋남 위험이라 사용 안 함.
 * 멱등: WHERE(manifest NULL AND payload NOT NULL) + CONVERT의 이중 가드.
 *
 * @param db    bun:sqlite Database
 * @param opts  BackfillCasOptions
 * @returns BackfillCasResult
 */
export function backfillProxyPayloadToCas(
  db: Database,
  opts: BackfillCasOptions = {},
): BackfillCasResult {
  const batchSize = opts.batchSize ?? 100;
  const dryRun = opts.dryRun ?? false;
  const limit = opts.limit ?? null;
  const split = opts._split ?? splitConversation;
  const join = opts._join ?? joinConversation;

  const result: BackfillCasResult = {
    scanned: 0,
    converted: 0,
    skippedNonConversation: 0,
    skippedRoundtripMismatch: 0,
    skippedDecodeError: 0,
    systemBackfilled: 0,
  };

  // keyset 커서 — 스캔·skip 행 모두 넘어가 무한루프를 방지한다.
  let lastTs = -1;
  let lastId = '';

  for (;;) {
    if (limit !== null && result.scanned >= limit) break;
    const take = limit === null ? batchSize : Math.min(batchSize, limit - result.scanned);
    if (take <= 0) break;

    const rows = db.query(SQL_BACKFILL_SCAN).all(lastTs, lastTs, lastId, take) as BackfillScanRow[];
    if (rows.length === 0) break;

    db.transaction(() => {
      for (const row of rows) {
        // 커서는 전환/skip 여부와 무관하게 매 행 전진(skip 행 재조회 방지).
        lastTs = row.timestamp;
        lastId = row.id;

        // a. decode (레거시 분기)
        const { text, error } = reconstructProxyPayloadText(db, row);
        if (error || !text) {
          result.skippedDecodeError++;
          continue;
        }
        // b. split (throw 가능 — 주입 시 배치 롤백 유발점)
        const sp = split(text);
        if (!sp) {
          result.skippedNonConversation++;
          continue;
        }
        // c. round-trip 검증
        let joined: string;
        try {
          joined = join(sp.chunks);
        } catch {
          result.skippedRoundtripMismatch++;
          continue;
        }
        if (!deepEqualJson(joined, text)) {
          result.skippedRoundtripMismatch++;
          continue;
        }

        // dry-run: 검증까지만. system 백필 추정 카운트만 반영.
        if (dryRun) {
          result.converted++;
          if (opts.normalizeSystem && row.system_hash == null) {
            const body = JSON.parse(text) as { system?: unknown };
            if (opts.normalizeSystem(body.system)) result.systemBackfilled++;
          }
          continue;
        }

        // d. system_hash 동시 백필 (payload NULL 이전 — 순서 트랩 해소)
        if (opts.normalizeSystem && row.system_hash == null) {
          const body = JSON.parse(text) as { system?: unknown };
          const norm = opts.normalizeSystem(body.system);
          if (norm) {
            upsertSystemPrompt(db, {
              hash: norm.hash,
              content: norm.normalized,
              byteSize: norm.byteSize,
              segmentCount: norm.segmentCount,
              nowMs: row.timestamp,
            });
            db.run(SQL_BACKFILL_SYSHASH, [norm.hash, norm.byteSize, row.id]);
            result.systemBackfilled++;
          }
        }

        // e. CAS 전환
        storeProxyPayloadChunks(db, row.id, sp.chunks, row.timestamp);
        db.run(SQL_BACKFILL_CONVERT, [row.id]);
        result.converted++;
      }
    })();

    result.scanned += rows.length;
    opts.onBatch?.({ done: result.scanned, converted: result.converted });
  }

  return result;
}
