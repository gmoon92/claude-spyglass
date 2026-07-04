/**
 * cas-stats — CAS(Content-Addressed Storage) 실현 절감 집계 (가시화)
 *
 * @description
 *   artifacts(고유 청크) + proxy_request_chunks(manifest 참조)로부터 "이미 실현된 CAS 절감"을
 *   산출한다. system_prompts realized dedup(profiler/collectors/dedup.ts:collectRealizedDedup)과
 *   대칭 구조 — logical = 참조별 평문 크기 합(dedup 안 했다면 저장했을 양), unique = 고유 청크
 *   평문 합, saved = logical - unique.
 *
 *   UI 저장소 패널(settings)이 이 수치로 CAS 효과를 노출한다.
 *
 * @dependencies bun:sqlite
 * @flow routes/settings.ts:collectSqliteInfo → getCasStats(db)
 */

import type { Database } from 'bun:sqlite';

/** CAS 실현 절감 요약. bytes는 모두 평문 기준(storedBytes만 실제 저장 = zstd 압축). */
export interface CasStats {
  /** 고유 청크 수 (artifacts 행 수). */
  artifactCount: number;
  /** 총 청크 참조 수 (proxy_request_chunks 행 수). */
  chunkRefCount: number;
  /** CAS로 저장된 proxy_requests 수 (payload_manifest_algo='chunks/v1'). */
  casRowCount: number;
  /** dedup 안 했다면 저장했을 평문 총량 (참조별 raw_size 합). */
  logicalBytes: number;
  /** 고유 청크 평문 합. */
  uniqueBytes: number;
  /** 실제 저장 바이트 (zstd 압축·선택적 암호화된 stored_bytes 합). */
  storedBytes: number;
  /** logical - unique (CAS dedup으로 아낀 평문 바이트). */
  savedBytes: number;
  /** savedBytes / logicalBytes × 100 (0 나눗셈은 0). */
  savedPct: number;
}

// 고유 청크 집계 — 평문(raw_size)·물리(stored_bytes) 합.
const SQL_ARTIFACTS = `
  SELECT COUNT(*) AS cnt,
         COALESCE(SUM(raw_size), 0) AS uniq,
         COALESCE(SUM(length(stored_bytes)), 0) AS stored
  FROM artifacts
`;
// 참조 집계 — manifest 각 행이 가리키는 청크의 평문 크기 합 = logical.
const SQL_REFS = `
  SELECT COUNT(*) AS refs,
         COALESCE(SUM(a.raw_size), 0) AS logical
  FROM proxy_request_chunks c
  JOIN artifacts a ON a.hash = c.chunk_hash
`;
const SQL_CAS_ROWS = `SELECT COUNT(*) AS n FROM proxy_requests WHERE payload_manifest_algo = 'chunks/v1'`;

/**
 * CAS 실현 절감을 집계한다. 읽기 전용(집계만) — DB 무변경.
 *
 * @param db bun:sqlite Database
 * @returns CasStats
 */
export function getCasStats(db: Database): CasStats {
  const art = db.query(SQL_ARTIFACTS).get() as { cnt: number; uniq: number; stored: number };
  const ref = db.query(SQL_REFS).get() as { refs: number; logical: number };
  const casRows = db.query(SQL_CAS_ROWS).get() as { n: number };

  const logicalBytes = ref.logical;
  const uniqueBytes = art.uniq;
  const savedBytes = logicalBytes - uniqueBytes;

  return {
    artifactCount: art.cnt,
    chunkRefCount: ref.refs,
    casRowCount: casRows.n,
    logicalBytes,
    uniqueBytes,
    storedBytes: art.stored,
    savedBytes,
    savedPct: logicalBytes > 0 ? (savedBytes / logicalBytes) * 100 : 0,
  };
}
