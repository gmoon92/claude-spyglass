/**
 * ArtifactStore — content-addressed 청크 저장 추상화 + SQLite 구현 (roadmap Phase 2)
 *
 * @description
 *   청크(평문 bytes) 하나를 SHA-256 주소로 저장/조회하는 교체 가능한 저장 계층.
 *   로드맵(storage-evolution-roadmap.md Phase 2)이 정의한 인터페이스를 구현한다.
 *   첫 구현체는 SQLite 내부 테이블(artifacts, 066-artifacts.sql)이며, 향후 File/S3/Archive
 *   구현체로 교체할 수 있다.
 *
 *   불변식 (절대 위반 금지):
 *     hash = SHA-256(평문 content)  ← encodeBlob(압축·암호화) '이전'의 평문에 적용.
 *     압축/암호화 후 해시하면 zstd 사전상태·AES 랜덤 nonce 때문에 동일 평문도 다른 해시가
 *     되어 dedup이 깨진다. store()는 반드시 (해시 → encodeBlob → 저장) 순서를 지킨다.
 *
 *   dedup: system_prompts(022/ADR-005)와 동일하게 single-statement UPSERT로 원자적 처리.
 *     exists() 후 분기하면 TOCTOU race가 생기므로, store()는 존재 여부와 무관하게 UPSERT
 *     하나로 (신규 INSERT ref_count=1 / 기존 ref_count+1)를 수행한다.
 *
 *   ┌─ Promise가 아니라 sync인 이유 ─────────────────────────────────────────┐
 *   │ bun:sqlite는 동기 API이고, store/manifest INSERT는 persistProxyRequest의  │
 *   │ db.transaction(동기 클로저) 안에서 실행되어야 원자성이 성립한다. 로드맵    │
 *   │ 초안은 Promise였으나, 트랜잭션 원자성을 위해 sync로 확정한다. 향후 async   │
 *   │ 백엔드(S3 등)가 필요하면 그때 별도 async 인터페이스로 분기한다(YAGNI).      │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * @dependencies bun:sqlite, ../payload-codec(encodeBlob/decodeBlob), ../runtime/encryption, ./chunker
 * @flow
 *   write: proxy/handler/persist.ts → db.transaction → store(각 청크)
 *   read : queries/proxy-payload.ts → load(각 청크) → chunker.joinConversation
 */

import type { Database } from 'bun:sqlite';
import { encodeBlob, decodeBlob, type PayloadAlgo } from '../payload-codec';
import { getActiveKey, shouldEncrypt } from '../runtime/encryption';
import { sha256HexBytes } from './chunker';

/** 저장된 청크의 참조. manifest(proxy_request_chunks)는 hash만 보관한다. */
export interface ArtifactRef {
  /** SHA-256(평문 content) hex 64자 — content address. */
  hash: string;
  /** 저장 인코딩 마커(payload_codec): 'zstd' | 'zstd+aes256gcm'. */
  algo: PayloadAlgo;
  /** 평문 content byte 길이. */
  size: number;
}

/**
 * 교체 가능한 artifact 저장 계약 (roadmap Phase 2).
 * 모든 메서드는 sync — 트랜잭션 원자성 참조(파일 헤더).
 */
export interface ArtifactStore {
  /** 평문 content를 저장(또는 기존 참조 +1)하고 참조를 반환. */
  store(content: Uint8Array): ArtifactRef;
  /** hash로 평문 content를 복원. 미존재 시 throw. */
  load(hash: string): Uint8Array;
  /** hash 존재 여부. */
  exists(hash: string): boolean;
}

// single-statement UPSERT (system-prompt.ts:90-96 미러). 동일 hash=동일 평문이므로
// ON CONFLICT는 stored_bytes/algo/raw_size를 갱신하지 않고 최초 저장값을 보존한다.
const SQL_UPSERT = `
  INSERT INTO artifacts (hash, stored_bytes, algo, raw_size, first_seen_at, last_seen_at, ref_count)
  VALUES (?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT(hash) DO UPDATE SET
    last_seen_at = excluded.last_seen_at,
    ref_count    = ref_count + 1
`;

const SQL_LOAD = `SELECT stored_bytes, algo FROM artifacts WHERE hash = ?`;
const SQL_EXISTS = `SELECT 1 FROM artifacts WHERE hash = ?`;

/**
 * SQLite 백엔드 ArtifactStore.
 *
 * @param db     bun:sqlite Database (persist 트랜잭션과 같은 connection이어야 원자적)
 * @param nowMs  first_seen_at/last_seen_at에 기록할 요청 timestamp(ms). 호출자가 ctx.startMs 전달.
 * @param opts.key  암호화 키를 명시 주입(주로 테스트). 미지정 시 shouldEncrypt()?getActiveKey():null로
 *                  런타임 해석(system-prompt.ts와 동일). 생성 시 1회 해석해 인스턴스 수명 동안 일관 유지.
 */
export class SqliteArtifactStore implements ArtifactStore {
  private readonly key: Buffer | null;

  constructor(
    private readonly db: Database,
    private readonly nowMs: number,
    opts?: { key?: Buffer | null },
  ) {
    this.key = opts && 'key' in opts ? (opts.key ?? null) : shouldEncrypt() ? getActiveKey() : null;
  }

  store(content: Uint8Array): ArtifactRef {
    // 1) 평문 기준 해시 (불변식 — encodeBlob 이전).
    const hash = sha256HexBytes(content);
    // 2) 압축(±암호화). 동일 hash가 이미 있으면 UPSERT가 stored_bytes를 덮지 않으므로,
    //    encode 비용은 최초 저장 때만 실질적 의미가 있지만 계약 단순화를 위해 항상 encode한다.
    const { value, algo } = encodeBlob(content, this.key);
    this.db.run(SQL_UPSERT, [hash, value, algo ?? null, content.byteLength, this.nowMs, this.nowMs]);
    return { hash, algo, size: content.byteLength };
  }

  load(hash: string): Uint8Array {
    const row = this.db.query(SQL_LOAD).get(hash) as { stored_bytes: Uint8Array; algo: string | null } | null;
    if (!row) throw new Error(`SqliteArtifactStore.load: artifact not found for hash ${hash}`);
    const raw = decodeBlob(row.stored_bytes, row.algo, this.key);
    if (raw == null) throw new Error(`SqliteArtifactStore.load: decode returned null for hash ${hash}`);
    return raw;
  }

  exists(hash: string): boolean {
    return this.db.query(SQL_EXISTS).get(hash) != null;
  }
}
