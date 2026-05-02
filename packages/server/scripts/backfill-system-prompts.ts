#!/usr/bin/env bun
/**
 * backfill-system-prompts.ts — v22 system_prompts 1회성 백필 (ADR-006)
 *
 * 책임:
 *  - proxy_requests.system_hash IS NULL AND payload IS NOT NULL 행을 순회
 *  - payload(zstd) 디코드 → JSON.parse → normalizeSystem(body.system) → upsertSystemPrompt
 *  - proxy_requests.system_hash, system_byte_size를 UPDATE
 *  - 처리 결과(처리 행 수, 디코드 실패, dedup 적중률 추정)를 stdout에 출력
 *
 * 사용:
 *   bun run packages/server/scripts/backfill-system-prompts.ts --dry-run    # 변경 없이 처리 가능 행 수만 보고
 *   bun run packages/server/scripts/backfill-system-prompts.ts --limit 100  # 한 번에 100건 처리
 *   bun run packages/server/scripts/backfill-system-prompts.ts              # 전체 처리 (배치 100건씩)
 *
 * 안전:
 *  - 마이그 SQL과 분리 — 사용자 명시 호출 게이트.
 *  - 디코드 실패 행은 skip + 통계 출력 (graceful).
 *  - row 100건씩 트랜잭션 — 중간 실패 시 직전 batch는 보존.
 *  - 이미 system_hash 채워진 행은 절대 재처리 안 함.
 *
 * 호출자: 사용자 직접 (npm/bun script). v21 이전 행은 payload BLOB 자체가 없어 backfill 불가능 — 의도된 한계.
 */

import { getDatabase, upsertSystemPrompt } from '@spyglass/storage';
import { normalizeSystem } from '../src/proxy/system-hash';

interface BackfillRow {
  id: string;
  timestamp: number;
  payload: Uint8Array;
}

const BATCH_SIZE = 100;

function parseArgs(): { dryRun: boolean; limit: number | null } {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  let limit: number | null = null;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx >= 0 && args[limitIdx + 1]) {
    const n = parseInt(args[limitIdx + 1], 10);
    if (Number.isFinite(n) && n > 0) limit = n;
  }
  return { dryRun, limit };
}

function main(): void {
  const { dryRun, limit } = parseArgs();
  const wrapper = getDatabase();
  const db = wrapper.instance;

  // 백필 대상 카운트 — 진행도 가늠용
  const totalRow = db.query(
    "SELECT COUNT(*) AS cnt FROM proxy_requests WHERE system_hash IS NULL AND payload IS NOT NULL"
  ).get() as { cnt: number };
  const eligibleTotal = totalRow.cnt;

  console.log(`[backfill] eligible rows (system_hash NULL AND payload NOT NULL): ${eligibleTotal}`);
  if (eligibleTotal === 0) {
    console.log(`[backfill] nothing to do.`);
    return;
  }
  if (limit !== null) {
    console.log(`[backfill] --limit ${limit} 적용 — 처음 ${Math.min(limit, eligibleTotal)}건만 처리`);
  }
  if (dryRun) {
    console.log(`[backfill] --dry-run — 실제 INSERT/UPDATE 미수행, 추정만 보고`);
  }

  // 통계
  let processed = 0;
  let updated = 0;
  let nullSystem = 0;
  let decodeError = 0;
  const distinctHashes = new Set<string>();

  // 배치 단위 처리 — bun:sqlite는 LIMIT/OFFSET 보단 cursor가 안전하지만,
  // payload BLOB이 크므로 메모리 압박 회피 위해 batch loop.
  const remaining = limit !== null ? Math.min(limit, eligibleTotal) : eligibleTotal;
  let offset = 0;

  const updateStmt = db.prepare(
    "UPDATE proxy_requests SET system_hash = ?, system_byte_size = ? WHERE id = ? AND system_hash IS NULL"
  );

  while (offset < remaining) {
    const batchSize = Math.min(BATCH_SIZE, remaining - offset);
    const rows = db.query(
      `SELECT id, timestamp, payload FROM proxy_requests
       WHERE system_hash IS NULL AND payload IS NOT NULL
       ORDER BY timestamp ASC LIMIT ?`
    ).all(batchSize) as BackfillRow[];

    if (rows.length === 0) break;

    // 트랜잭션으로 batch 단위 적용 — 중간 실패 시 batch 롤백
    const trx = db.transaction((batch: BackfillRow[]) => {
      for (const row of batch) {
        processed++;
        let body: { system?: unknown };
        try {
          const raw = Bun.zstdDecompressSync(row.payload);
          const text = new TextDecoder().decode(raw);
          body = JSON.parse(text);
        } catch {
          decodeError++;
          continue;
        }
        const norm = normalizeSystem(body.system);
        if (!norm) {
          nullSystem++;
          continue;
        }
        distinctHashes.add(norm.hash);
        if (!dryRun) {
          upsertSystemPrompt(db, {
            hash: norm.hash,
            content: norm.normalized,
            byteSize: norm.byteSize,
            segmentCount: norm.segmentCount,
            nowMs: row.timestamp,
          });
          const result = updateStmt.run(norm.hash, norm.byteSize, row.id);
          if (result.changes > 0) updated++;
        } else {
          updated++; // dry-run에서도 추정 카운트
        }
      }
    });
    trx(rows);

    offset += rows.length;
    console.log(`[backfill] batch done: ${offset}/${remaining} (decoded=${processed - decodeError}, decode_err=${decodeError}, null_system=${nullSystem}, distinct_hash=${distinctHashes.size})`);
  }

  // 최종 보고
  const dedupRatio = processed > 0 ? (processed / Math.max(distinctHashes.size, 1)).toFixed(2) : '-';
  console.log(`\n=== backfill summary ${dryRun ? '(DRY RUN)' : ''} ===`);
  console.log(`processed:        ${processed}`);
  console.log(`updated:          ${updated}`);
  console.log(`distinct hashes:  ${distinctHashes.size}`);
  console.log(`dedup ratio:      ${dedupRatio}:1 (rows / distinct hash)`);
  console.log(`null system:      ${nullSystem}  (body.system 미존재 또는 정규화 결과 없음)`);
  console.log(`decode errors:    ${decodeError}`);
  if (dryRun) {
    console.log(`\nactual changes were NOT written. Re-run without --dry-run to apply.`);
  } else {
    console.log(`\n검증: sqlite3 ~/.spyglass/spyglass.db 'SELECT COUNT(*) FROM system_prompts; SELECT ref_count, COUNT(*) FROM system_prompts GROUP BY ref_count ORDER BY ref_count;'`);
  }
}

main();
