/**
 * payload off-row 분리(Migration 061~063) 정적 가드 — 회귀 방지 SSoT.
 *
 * 배경:
 *   requests.payload / payload_algo 는 063 에서 DROP 되어 request_payloads off-row 테이블이
 *   단일 소스다. 누군가 requests 본체에 payload 를 다시 직접 INSERT/UPDATE/SELECT(request_payloads
 *   JOIN 없이) 하면 두 가지 회귀가 발생한다:
 *     1) 런타임 "no such column: payload" (write/read 양쪽) — 실제로 이번에 persist.merge,
 *        persistAssistantTextResponses, turn orphan, session-status, backfill 등에서 연쇄 발생했다.
 *     2) 피드/목록 SELECT 가 BLOB 을 다시 끌어와 전송 병목 재생성.
 *
 *   이 테스트는 storage·server 소스를 정적 스캔해 그런 직접 SQL 을 CI 에서 즉시 잡는다.
 *   "다음번에도 놓치지 않기 위한" 안전망(사용자 요구 2026-06-07).
 *
 * 허용 패턴(위반 아님):
 *   - request_payloads 를 JOIN/INSERT/UPDATE 하는 SQL (off-row 정식 경로)
 *   - p.payload / r.payload 같은 alias 참조는 JOIN 동반 시 허용(블록에 request_payloads 존재)
 *   - 주석, claude_events.payload, proxy_requests.payload (다른 테이블)
 */
import { test, expect } from 'bun:test';
import { Glob } from 'bun';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = [
  join(import.meta.dir, '..'),                  // packages/storage/src
  join(import.meta.dir, '../../../server/src'), // packages/server/src
];

/** 라인 주석(`// ...`)을 제거해 주석 속 예시 SQL 오탐을 막는다. */
function stripLineComments(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
}

interface Violation { file: string; kind: string; snippet: string; }

function scanViolations(): Violation[] {
  const violations: Violation[] = [];
  for (const root of ROOTS) {
    const glob = new Glob('**/*.ts');
    for (const rel of glob.scanSync(root)) {
      if (rel.includes('__tests__')) continue;
      const src = stripLineComments(readFileSync(join(root, rel), 'utf8'));

      // (1) INSERT [OR ...] INTO requests ( ...컬럼... ) — 컬럼 목록에 payload 가 있으면 위반.
      for (const m of src.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+requests\s*\(([^)]*)\)/gis)) {
        if (/\bpayload(_algo)?\b/i.test(m[1])) {
          violations.push({ file: rel, kind: 'INSERT INTO requests(payload)', snippet: m[1].replace(/\s+/g, ' ').trim().slice(0, 80) });
        }
      }

      // (2) UPDATE requests SET ... payload = ... — payload 컬럼 직접 갱신이면 위반.
      for (const m of src.matchAll(/UPDATE\s+requests\s+SET\s+([\s\S]*?)\bWHERE\b/gi)) {
        if (/\bpayload(_algo)?\s*=/i.test(m[1])) {
          violations.push({ file: rel, kind: 'UPDATE requests SET payload', snippet: m[1].replace(/\s+/g, ' ').trim().slice(0, 80) });
        }
      }

      // (3) 백틱 SQL 블록에 `FROM requests` 가 있는데 request_payloads JOIN 이 없고
      //     bare payload/payload_algo 컬럼(별칭 prefix 없는)이 SELECT 되면 위반.
      for (const m of src.matchAll(/`([^`]*\bFROM\s+requests\b[^`]*)`/gis)) {
        const sql = m[1];
        if (/request_payloads/i.test(sql)) continue; // 정식 JOIN 경로
        // payload 가 컬럼으로 등장(., _ 등 식별자 일부가 아닌) + algo 마커. preview/payload_ref 는 제외.
        const bare = /(^|[\s,(])payload(_algo)?(\s|,|\)|$)/i.test(sql);
        if (bare) {
          violations.push({ file: rel, kind: 'SELECT payload FROM requests (JOIN 없음)', snippet: sql.replace(/\s+/g, ' ').trim().slice(0, 80) });
        }
      }
    }
  }
  return violations;
}

test('payload off-row 불변식: requests 본체에 payload 직접 SQL 금지 (request_payloads 경유 강제)', () => {
  const violations = scanViolations();
  if (violations.length > 0) {
    const report = violations.map((v) => `  - ${v.file} [${v.kind}]: ${v.snippet}`).join('\n');
    throw new Error(
      `payload off-row 분리(063) 위반 ${violations.length}건 — requests 본체에 payload 직접 접근.\n` +
      `request_payloads 테이블 + upsertRequestPayload / LEFT JOIN request_payloads 를 사용하세요.\n${report}`,
    );
  }
  expect(violations).toEqual([]);
});
