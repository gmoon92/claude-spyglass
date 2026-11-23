#!/usr/bin/env bun
/**
 * backfill-text-payloads.ts — 기존 TEXT payload zstd 압축 1회성 백필 (storage roadmap Phase 4 후속)
 *
 * 책임:
 *  - request_payloads.payload · claude_events.payload · system_prompts.content 중 코덱 도입 이전에 쓰인
 *    미압축 행(평문/암호화만)을 decode → encodeText 재인코딩해 zstd-b64[/+aes256gcm] 로 전환
 *  - 테이블별 처리 결과(압축/skip 사유별 카운트)를 stdout 에 출력
 *
 * 사용:
 *   bun run backfill:text-payloads --dry-run          # 변경 없이 압축 가능 수만 보고
 *   bun run backfill:text-payloads --limit 5          # 테이블별 처음 5건만 실전환(소량 검증)
 *   bun run backfill:text-payloads --batch 500        # 배치 500건씩 전체
 *   bun run backfill:text-payloads --db /path/to.db   # DB 경로 지정
 *
 * 안전:
 *  - 행별 round-trip 검증(재디코드 == 원본 평문) 통과 행만 UPDATE — 실패 행은 원본 보존.
 *  - 배치 트랜잭션, 멱등(이미 압축된 행은 후보에서 제외).
 *  - 암호화 ON 이면 활성 키로 암호문 행도 재인코딩한다. 키 파일을 새로 만들지 않는다(autoCreate=false).
 *
 * VACUUM: 압축으로 늘어난 freelist 는 daily-cleanup 의 VACUUM 주기가 회수한다(직접 실행하지 않음).
 *
 * 호출자: 사용자 직접 (bun script).
 */

import { getDatabase, backfillTextPayloads, resolveEncryptionKey } from '@spyglass/storage';

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
  return { dryRun, limit: num('--limit'), batch: num('--batch') ?? 200, dbPath };
}

function main(): void {
  const { dryRun, limit, batch, dbPath } = parseArgs();
  const db = getDatabase(dbPath ? { dbPath } : undefined).instance;
  const key = resolveEncryptionKey({ autoCreate: false });

  console.log(`[text-backfill] encryption key: ${key ? 'present (암호문 행 포함)' : 'absent (평문 행만)'}`);
  if (dryRun) console.log('[text-backfill] --dry-run — UPDATE 없이 압축 가능 수만 계측');
  if (limit !== null) console.log(`[text-backfill] --limit ${limit} (테이블별) 적용`);

  const r = backfillTextPayloads(db, { key, batchSize: batch, limit, dryRun });

  console.log('[text-backfill] 완료:');
  for (const [table, t] of Object.entries(r.byTable)) {
    console.log(
      `  ${table}: scanned=${t.scanned} compressed=${t.compressed} ` +
        `skippedNoGain=${t.skippedNoGain} skippedRoundtrip=${t.skippedRoundtrip}`,
    );
  }
  if (dryRun) console.log('[text-backfill] dry-run이었습니다. 실제 전환은 --dry-run 없이 재실행하세요.');
}

main();
