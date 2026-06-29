/**
 * Report — ProfileResult → Markdown 4종 렌더러
 *
 * @description
 *   수집기 결과를 사람이 읽는 의사결정 문서로 변환한다. 4종:
 *     1) storage-analysis        물리(dbstat)·논리(payload) 크기
 *     2) deduplication-analysis  Axis A 평문 dedup + 이미 실현된 dedup + 암호화 분리
 *     3) top-100-largest-records 개별 대형 레코드
 *     4) optimization-recommendation 측정 기반 CAS/Archive/압축 우선순위
 *   추정(샘플)·측정 불가(암호화) 구간은 숨기지 않고 명시한다(silent cap 금지).
 *
 * @flow profiler/index.ts → renderReports(result) → { filename: content }
 */

import type { ProfileResult } from '../types';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(2)} ${u[i]}`;
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function isoFromMs(ms: number): string {
  // Date 생성은 스크립트(런타임)에서 호출되므로 안전. (워크플로 제약과 무관)
  return new Date(ms).toISOString();
}

function header(result: ProfileResult, title: string): string {
  return [
    `# ${title}`,
    '',
    `- DB: \`${result.meta.dbPath}\``,
    `- 생성: ${isoFromMs(result.meta.generatedAtMs)}`,
    `- 암호화 키: ${result.meta.hasEncryptionKey ? '로드됨(암호문 측정 가능)' : '없음(암호문은 측정 불가로 분리)'}`,
    result.meta.sampleLimit != null
      ? `- 샘플 한도: 컬럼당 최대 ${result.meta.sampleLimit.toLocaleString()}행 (초과 시 추정)`
      : '- 샘플 한도: 없음 (전수 측정)',
    '',
  ].join('\n');
}

// ── 1. Storage Analysis ──────────────────────────────────────────────────────
function renderStorageAnalysis(r: ProfileResult): string {
  const p = r.physical;
  const lines: string[] = [header(r, 'Storage Analysis Report')];

  lines.push('## 전체 물리 현황');
  lines.push('');
  lines.push('| 항목 | 값 |');
  lines.push('| --- | --- |');
  lines.push(`| DB 파일 크기 | ${fmtBytes(p.fileBytes)} |`);
  lines.push(`| WAL 파일 크기 | ${fmtBytes(p.walBytes)} |`);
  lines.push(`| 페이지 크기 | ${p.pageSize} B |`);
  lines.push(`| 페이지 수 | ${p.pageCount.toLocaleString()} |`);
  lines.push(
    `| **freelist (회수 가능)** | **${fmtBytes(p.freelistBytes)}** (${p.freelistCount.toLocaleString()} pages) |`,
  );
  const usedBytes = (p.pageCount - p.freelistCount) * p.pageSize;
  lines.push(`| 사용 중 페이지 | ${fmtBytes(usedBytes)} |`);
  lines.push('');
  if (p.freelistBytes > p.fileBytes * 0.15) {
    lines.push(
      `> ⚠️ freelist가 파일의 ${pct((p.freelistBytes / p.fileBytes) * 100)}를 차지한다. ` +
        `**VACUUM만으로 ~${fmtBytes(p.freelistBytes)} 즉시 회수 가능** — CAS/Archive보다 우선 검토.`,
    );
    lines.push('');
  }

  lines.push('## 테이블/인덱스 물리 크기 (dbstat 실측)');
  lines.push('');
  lines.push('| 객체 | 종류 | 물리 크기 | 페이지 |');
  lines.push('| --- | --- | ---: | ---: |');
  for (const e of p.entries) {
    lines.push(`| ${e.name} | ${e.kind} | ${fmtBytes(e.bytes)} | ${e.pages.toLocaleString()} |`);
  }
  lines.push('');

  lines.push('## payload 컬럼 논리 크기');
  lines.push('');
  lines.push('| 테이블.컬럼 | 행수 | 저장 바이트 | 원본(raw) | 최대 1건 |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const c of r.logical) {
    lines.push(
      `| ${c.table}.${c.column} | ${c.rows.toLocaleString()} | ${fmtBytes(c.storedBytes)} | ` +
        `${c.rawBytes != null ? fmtBytes(c.rawBytes) : '—'} | ${fmtBytes(c.maxStoredBytes)} |`,
    );
  }
  lines.push('');

  for (const c of r.logical) {
    lines.push(`### ${c.table}.${c.column} — 분해`);
    lines.push('');
    lines.push('| algo | 행수 | 저장 바이트 |');
    lines.push('| --- | ---: | ---: |');
    for (const a of c.byAlgo) {
      lines.push(`| ${a.algo} | ${a.rows.toLocaleString()} | ${fmtBytes(a.storedBytes)} |`);
    }
    lines.push('');
    if (c.byCategory && c.byCategory.length) {
      lines.push('| 카테고리 | 행수 | 저장 바이트 |');
      lines.push('| --- | ---: | ---: |');
      for (const cat of c.byCategory) {
        lines.push(
          `| ${cat.category} | ${cat.rows.toLocaleString()} | ${fmtBytes(cat.storedBytes)} |`,
        );
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── 2. Deduplication Analysis ────────────────────────────────────────────────
function renderDedup(r: ProfileResult): string {
  const lines: string[] = [header(r, 'Deduplication Analysis Report')];

  lines.push('## Axis A — 평문 기준 content dedup (이론적 CAS 상한)');
  lines.push('');
  lines.push(
    '> 각 payload를 평문으로 디코드한 뒤 SHA-256로 중복을 측정. 암호화 행(키 없음)은 분모에서 제외.',
  );
  lines.push('');
  lines.push('| 테이블.컬럼 | 측정/전체 행 | 평문 합 | 고유 합 | 절감 | 절감률 | 고유율 | 암호/오류 제외 |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const d of r.dedup) {
    const measured = d.sampled ? `${d.measuredRows}/${d.totalRows} *(샘플)*` : `${d.measuredRows}/${d.totalRows}`;
    lines.push(
      `| ${d.table}.${d.column} | ${measured} | ${fmtBytes(d.plaintextBytes)} | ${fmtBytes(d.uniqueBytes)} | ` +
        `${fmtBytes(d.savedBytes)} | **${pct(d.savedPct)}** | ${pct(d.uniqueRatio * 100)} | ` +
        `${d.encryptedRowsSkipped}/${d.errorRowsSkipped} |`,
    );
  }
  lines.push('');
  if (r.dedup.some((d) => d.encryptedRowsSkipped > 0)) {
    lines.push(
      '> ⚠️ 암호화 행이 제외됐다. AES-256-GCM은 랜덤 nonce로 동일 평문도 암호문이 달라 dedup이 0으로 ' +
        '오측정되므로, 키를 주입(`SPYGLASS_ENCRYPTION_KEY`)해야 정확한 측정이 가능하다.',
    );
    lines.push('');
  }

  lines.push("## Axis A' — 청크(블록) 단위 dedup (CAS at Git-blob granularity)");
  lines.push('');
  lines.push(
    '> payload를 system/message/tool 블록으로 쪼개 측정. **append 구조 때문에 document 단위(위)는 ' +
      '0%여도 청크 단위는 매우 높을 수 있다** — 이것이 CAS의 실제 절감 잠재력이다.',
  );
  lines.push('');
  lines.push('| 테이블.컬럼 | 측정/전체 행 | 청크 수 | 고유 청크 | 청크 평문 합 | 고유 합 | 절감 | **절감률** |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const c of r.chunkDedup) {
    const measured = c.sampled ? `${c.measuredRows}/${c.totalRows} *(샘플)*` : `${c.measuredRows}/${c.totalRows}`;
    lines.push(
      `| ${c.table}.${c.column} | ${measured} | ${c.chunkCount.toLocaleString()} | ${c.uniqueChunkCount.toLocaleString()} | ` +
        `${fmtBytes(c.totalChunkBytes)} | ${fmtBytes(c.uniqueChunkBytes)} | ${fmtBytes(c.savedBytes)} | **${pct(c.savedPct)}** |`,
    );
  }
  lines.push('');
  lines.push(
    '> document 단위(Axis A)와 청크 단위(Axis A\')의 격차가 크면 → **CAS는 레코드가 아니라 청크 단위로 ' +
      '설계**해야 효과가 난다는 신호.',
  );
  lines.push('');

  lines.push('## 이미 실현된 dedup (기존 CAS 영역)');
  lines.push('');
  lines.push(
    '> 아래는 **이미 dedup이 적용된** 테이블. 추가 CAS 효과 ≈ 0이므로 신규 CAS 대상에서 제외한다.',
  );
  lines.push('');
  lines.push('| 테이블 | 행수 | 논리(참조 전개) | 고유 | 절감 | 절감률 | 최대 ref |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const d of r.realizedDedup) {
    lines.push(
      `| ${d.table} | ${d.rows.toLocaleString()} | ${fmtBytes(d.logicalBytes)} | ${fmtBytes(d.uniqueBytes)} | ` +
        `${fmtBytes(d.savedBytes)} | ${pct(d.savedPct)} | ${d.refCountMax} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

// ── 3. Top-100 Largest Records ───────────────────────────────────────────────
function renderLargest(r: ProfileResult): string {
  const lines: string[] = [header(r, 'Top-100 Largest Records')];
  lines.push('| # | 출처 | id | 저장 크기 | algo | 카테고리 | preview |');
  lines.push('| ---: | --- | --- | ---: | --- | --- | --- |');
  r.largest.forEach((rec, i) => {
    const prev = (rec.preview ?? '').replace(/\s+/g, ' ').slice(0, 60).replace(/\|/g, '\\|');
    lines.push(
      `| ${i + 1} | ${rec.source} | \`${rec.id.slice(0, 16)}\` | ${fmtBytes(rec.storedBytes)} | ` +
        `${rec.algo} | ${rec.category ?? '—'} | ${prev} |`,
    );
  });
  lines.push('');
  return lines.join('\n');
}

// ── 4. Optimization Recommendation ───────────────────────────────────────────
function renderRecommendation(r: ProfileResult): string {
  const lines: string[] = [header(r, 'Storage Optimization Recommendation')];
  const p = r.physical;

  lines.push('## 측정 요약');
  lines.push('');
  const usedBytes = (p.pageCount - p.freelistCount) * p.pageSize;
  lines.push(`- DB 파일: **${fmtBytes(p.fileBytes)}**, 사용 중: ${fmtBytes(usedBytes)}, freelist: ${fmtBytes(p.freelistBytes)}`);
  const topLogical = [...r.logical].sort((a, b) => b.storedBytes - a.storedBytes)[0];
  if (topLogical) {
    lines.push(`- 최대 payload 컬럼: \`${topLogical.table}.${topLogical.column}\` = ${fmtBytes(topLogical.storedBytes)}`);
  }
  lines.push('');

  lines.push('## 권장 우선순위 (측정 근거 기반)');
  lines.push('');
  const recs: string[] = [];
  let order = 1;

  // (1) freelist가 크면 VACUUM 최우선
  if (p.freelistBytes > p.fileBytes * 0.15) {
    recs.push(
      `${order++}. **VACUUM 먼저.** freelist ${fmtBytes(p.freelistBytes)} ` +
        `(${pct((p.freelistBytes / p.fileBytes) * 100)})가 회수 대기 중. 구조 변경 없이 즉시 절감.`,
    );
  }

  // (2) CAS 신호는 청크 단위 dedup이 진짜다 (document 단위는 append 구조에서 과소평가).
  const chunkCas = r.chunkDedup
    .filter((c) => c.savedPct >= 30 && c.totalChunkBytes > 0)
    .sort((a, b) => b.savedBytes - a.savedBytes);
  const docCas = r.dedup
    .filter((d) => d.savedPct >= 30 && d.plaintextBytes > 0)
    .sort((a, b) => b.savedBytes - a.savedBytes);

  if (chunkCas.length) {
    for (const c of chunkCas) {
      const docPct = r.dedup.find((d) => d.table === c.table)?.savedPct ?? 0;
      recs.push(
        `${order++}. **청크 CAS 후보: \`${c.table}.${c.column}\`** — 청크 dedup **${pct(c.savedPct)}** ` +
          `(절감 ${fmtBytes(c.savedBytes)}${c.sampled ? ', 샘플 추정' : ''}) vs document ${pct(docPct)}. ` +
          `→ CAS는 **레코드가 아니라 블록(message/tool/system) 단위**로 설계할 것 (Git blob 모델).`,
      );
    }
  } else if (docCas.length) {
    for (const d of docCas) {
      recs.push(
        `${order++}. **CAS 후보: \`${d.table}.${d.column}\`** — document dedup ${pct(d.savedPct)} ` +
          `(절감 ${fmtBytes(d.savedBytes)}). Phase 3 대상.`,
      );
    }
  } else {
    recs.push(
      `${order++}. **CAS 우선순위 낮음.** document·청크 dedup 모두 30% 미만 — 이 환경 데이터로는 효과 제한적. ` +
        `(주의: dev 소표본일 수 있음 — 프로덕션 환경 재측정 필요.)`,
    );
  }

  // (3) 압축 미적용 TEXT 컬럼 → 압축 확대 후보
  const compressTargets = r.logical.filter(
    (c) => c.byAlgo.some((a) => a.algo === 'plain' && a.storedBytes > 0) && c.column === 'payload',
  );
  for (const c of compressTargets) {
    const plainBytes = c.byAlgo.filter((a) => a.algo === 'plain').reduce((s, a) => s + a.storedBytes, 0);
    if (plainBytes > 1024 * 1024) {
      recs.push(
        `${order++}. **압축 확대 후보: \`${c.table}.${c.column}\`** — 평문 ${fmtBytes(plainBytes)}가 ` +
          `미압축. zstd 적용 시(proxy 기준) 통상 50~70% 절감 기대. Phase 4 대상.`,
      );
    }
  }

  // (4) 이미 dedup된 영역 제외 명시
  for (const d of r.realizedDedup) {
    if (d.savedPct > 50) {
      recs.push(
        `${order++}. \`${d.table}\`는 이미 dedup ${pct(d.savedPct)} 실현 — **신규 CAS 대상에서 제외**.`,
      );
    }
  }

  lines.push(...recs);
  lines.push('');
  lines.push('## 주의');
  lines.push('');
  lines.push('- 위 수치는 단일 시점 스냅샷. retention(기본 30일) 주기에서 재측정 권장.');
  if (r.dedup.some((d) => d.sampled)) {
    lines.push('- 일부 컬럼은 샘플 추정치 — 전수 재측정으로 검증 필요.');
  }
  if (!r.meta.hasEncryptionKey && r.dedup.some((d) => d.encryptedRowsSkipped > 0)) {
    lines.push('- 암호화 행이 측정에서 제외됨 — 키 주입 후 재측정해야 전체 그림 확보.');
  }
  lines.push('');
  return lines.join('\n');
}

export function renderReports(result: ProfileResult): Record<string, string> {
  return {
    'storage-analysis.md': renderStorageAnalysis(result),
    'deduplication-analysis.md': renderDedup(result),
    'top-100-largest-records.md': renderLargest(result),
    'optimization-recommendation.md': renderRecommendation(result),
  };
}
