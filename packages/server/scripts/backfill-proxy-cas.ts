#!/usr/bin/env bun
/**
 * backfill-proxy-cas.ts — 레거시 proxy_requests.payload → CAS 청크 저장 1회성 백필 (정공법 C)
 *
 * 책임:
 *  - payload_manifest_algo IS NULL AND payload IS NOT NULL 행을 순회
 *  - payload 복원 → splitConversation → round-trip 검증 통과 시에만 청크 CAS 저장 + payload NULL 전환
 *  - system_hash IS NULL 행은 같은 트랜잭션에서 normalizeSystem 백필(payload NULL 이전 — 순서 트랩 해소)
 *  - 처리 결과(전환/skip 사유별 카운트)를 stdout에 출력
 *
 * 사용:
 *   bun run packages/server/scripts/backfill-proxy-cas.ts --dry-run        # 변경 없이 전환 가능 수만 보고
 *   bun run packages/server/scripts/backfill-proxy-cas.ts --limit 5        # 처음 5건만 실전환(소량 검증)
 *   bun run packages/server/scripts/backfill-proxy-cas.ts --batch 100      # 배치 100건씩 전체
 *   bun run packages/server/scripts/backfill-proxy-cas.ts --db /path/to.db # DB 경로 지정
 *
 * 안전(비가역 작업):
 *  - 행별 round-trip 검증(재조립==원본) 통과 행만 payload를 NULL로 만든다 — 실패 행은 payload 보존.
 *  - 배치 트랜잭션 — 중간 실패 시 그 배치 롤백. 멱등(전환된 행은 WHERE에서 자동 제외).
 *  - 사용자 명시 호출 게이트. dry-run 선행 권장.
 *
 * VACUUM: payload NULL화로 늘어난 freelist는 기존 runVacuumMaintenance(daily-cleanup 주기)가 회수한다.
 *  이 스크립트는 VACUUM을 직접 실행하지 않는다(vacuum.ts가 SSoT).
 *
 * 호출자: 사용자 직접 (bun script).
 */

import { getDatabase, backfillProxyPayloadToCas } from '@spyglass/storage';
import { normalizeSystem } from '../src/proxy/system-hash';

function parseArgs(): { dryRun: boolean; limit: number | null; batch: number; dbPath: string | null } {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const num = (flag: string): number | null => {
    const i = args.indexOf(flag);
    if (i >= 0 && args[i + 1]) {
      const n = parseInt(args[i + 1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  };
  const dbIdx = args.indexOf('--db');
  const dbPath = dbIdx >= 0 && args[dbIdx + 1] ? args[dbIdx + 1] : null;
  return { dryRun, limit: num('--limit'), batch: num('--batch') ?? 100, dbPath };
}

function main(): void {
  const { dryRun, limit, batch, dbPath } = parseArgs();
  const wrapper = getDatabase(dbPath ? { dbPath } : undefined);
  const db = wrapper.instance;

  const totalRow = db
    .query("SELECT COUNT(*) AS cnt FROM proxy_requests WHERE payload_manifest_algo IS NULL AND payload IS NOT NULL")
    .get() as { cnt: number };
  console.log(`[cas-backfill] 대상 rows (manifest NULL AND payload NOT NULL): ${totalRow.cnt}`);
  if (totalRow.cnt === 0) {
    console.log('[cas-backfill] nothing to do.');
    return;
  }
  if (dryRun) console.log('[cas-backfill] --dry-run — 실제 전환 없이 round-trip 검증만 수행');
  if (limit !== null) console.log(`[cas-backfill] --limit ${limit} 적용`);

  const r = backfillProxyPayloadToCas(db, {
    batchSize: batch,
    dryRun,
    limit,
    normalizeSystem, // system_hash 동시 백필(server → storage 주입)
    onBatch: ({ done, converted }) => console.log(`[cas-backfill] progress: scanned ${done}, converted ${converted}`),
  });

  console.log('[cas-backfill] 완료:');
  console.log(`  scanned=${r.scanned} converted=${r.converted} systemBackfilled=${r.systemBackfilled}`);
  console.log(`  skipped: nonConversation=${r.skippedNonConversation} roundtripMismatch=${r.skippedRoundtripMismatch} decodeError=${r.skippedDecodeError}`);
  if (dryRun) {
    console.log('[cas-backfill] dry-run이었습니다. 실제 전환은 --dry-run 없이 재실행하세요.');
  } else {
    console.log('[cas-backfill] payload NULL화로 늘어난 freelist는 daily-cleanup의 VACUUM 주기에 회수됩니다.');
    console.log('[cas-backfill] 검증: sqlite3 <db> "SELECT COUNT(*) FROM proxy_requests WHERE payload_manifest_algo=\'chunks/v1\'; SELECT COUNT(*) FROM artifacts;"');
  }
}

main();
