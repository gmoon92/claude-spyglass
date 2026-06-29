#!/usr/bin/env bun
/**
 * Storage Profiler CLI — 읽기 전용 저장소 분석 (Phase 0)
 *
 * @description
 *   현재 Spyglass DB를 read-only로 분석해 Markdown 리포트 4종을 출력한다.
 *   DB를 절대 수정하지 않는다. CAS/Archive 전략 결정의 근거 데이터를 만든다.
 *
 * 사용:
 *   bun run packages/storage/src/scripts/profile-storage.ts
 *   bun run packages/storage/src/scripts/profile-storage.ts --db=/path/spyglass.db --out=./reports
 *   bun run packages/storage/src/scripts/profile-storage.ts --sample=5000   # 대용량 시 dedup 추정
 *
 * @flow profileStorage() → renderReports() → 파일 4종 + 콘솔 요약
 */

import fs from 'node:fs';
import { profileStorage, renderReports } from '../profiler';

interface Opts {
  dbPath?: string;
  outDir: string;
  sampleLimit: number | null;
  topN: number;
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    outDir: `${process.env.HOME || process.env.USERPROFILE}/.spyglass/reports`,
    sampleLimit: null,
    topN: 100,
  };
  for (const a of argv) {
    if (a.startsWith('--db=')) o.dbPath = a.slice(5);
    else if (a.startsWith('--out=')) o.outDir = a.slice(6);
    else if (a.startsWith('--sample=')) o.sampleLimit = parseInt(a.slice(9), 10) || null;
    else if (a.startsWith('--top=')) o.topN = parseInt(a.slice(6), 10) || 100;
  }
  return o;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  const result = profileStorage({
    dbPath: opts.dbPath,
    sampleLimit: opts.sampleLimit,
    topN: opts.topN,
    nowMs: Date.now(),
  });

  const reports = renderReports(result);
  fs.mkdirSync(opts.outDir, { recursive: true });
  for (const [name, content] of Object.entries(reports)) {
    fs.writeFileSync(`${opts.outDir}/${name}`, content, 'utf8');
  }

  // 콘솔 요약 — 파일 안 열어도 핵심이 보이게.
  const p = result.physical;
  const fmt = (n: number) => (n / 1024 / 1024).toFixed(1) + ' MB';
  console.log(`\n=== Storage Profiler ===`);
  console.log(`db        : ${result.meta.dbPath}`);
  console.log(`file size : ${fmt(p.fileBytes)}`);
  console.log(`freelist  : ${fmt(p.freelistBytes)} (${p.freelistCount} pages) — VACUUM 회수 가능`);
  console.log(`enc key   : ${result.meta.hasEncryptionKey ? 'loaded' : 'none'}`);
  console.log(`\npayload columns (logical):`);
  for (const c of result.logical) {
    console.log(`  ${(c.table + '.' + c.column).padEnd(28)} ${fmt(c.storedBytes).padStart(10)}  (${c.rows} rows)`);
  }
  console.log(`\ndedup (Axis A, plaintext):`);
  for (const d of result.dedup) {
    const tag = d.sampled ? ' [sampled]' : '';
    console.log(
      `  ${(d.table + '.' + d.column).padEnd(28)} saved ${d.savedPct.toFixed(1).padStart(5)}%  ` +
        `(${fmt(d.savedBytes)})${tag}  enc-skip=${d.encryptedRowsSkipped}`,
    );
  }
  for (const d of result.realizedDedup) {
    console.log(`  ${(d.table + ' [realized]').padEnd(28)} saved ${d.savedPct.toFixed(1).padStart(5)}%  (${fmt(d.savedBytes)})`);
  }
  console.log(`\ndedup (Axis A', chunk/block — CAS 잠재력):`);
  for (const c of result.chunkDedup) {
    const tag = c.sampled ? ' [sampled]' : '';
    console.log(
      `  ${(c.table + '.' + c.column).padEnd(28)} saved ${c.savedPct.toFixed(1).padStart(5)}%  ` +
        `(${fmt(c.savedBytes)})  chunks=${c.chunkCount} uniq=${c.uniqueChunkCount}${tag}`,
    );
  }
  console.log(`\nreports → ${opts.outDir}/`);
  for (const name of Object.keys(reports)) console.log(`  - ${name}`);
  console.log('');
}

if (import.meta.main) {
  main();
}
