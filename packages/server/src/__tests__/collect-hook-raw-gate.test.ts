/**
 * collect-hook-raw-gate.test.ts — hooks/spyglass-collect.sh 의 raw 원장 게이트 통합 검증.
 *
 * record_raw_payload() 단일 진입점이:
 *   1. SPYGLASS_DIAG_ENABLED 미설정 → raw 기록 안 함 (디렉토리도 안 생김, 운영 기본 디스크 0).
 *   2. SPYGLASS_DIAG_ENABLED=1 / true → 일자별 버킷에 payload 기록.
 *   3. DIAG 활성이어도 디스크 critical(SPYGLASS_DISK_MIN_FREE_MB 가 가용량 초과) → 기록 skip.
 *
 * bash 스크립트를 실제 spawn 해 stdin 으로 payload 를 흘려넣고 파일시스템 결과를 확인한다.
 */

import { describe, test, expect, afterEach } from 'bun:test';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';

const SCRIPT = resolve(import.meta.dir, '../../../../hooks/spyglass-collect.sh');

const createdHomes: string[] = [];

async function runCollect(
  extraEnv: Record<string, string>,
  payload = '{"t":"x"}'
): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), 'sg-hook-'));
  createdHomes.push(home);
  const proc = Bun.spawn({
    cmd: ['bash', SCRIPT],
    stdin: new TextEncoder().encode(payload),
    env: {
      HOME: home,
      PATH: process.env.PATH ?? '',
      SPYGLASS_TIMEOUT: '1',
      ...extraEnv,
    },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  await proc.exited;
  return home;
}

function hookRawDir(home: string): string {
  return join(home, '.spyglass', 'logs', 'hook-raw');
}

/**
 * hook-raw 디렉토리의 일자 버킷(`YYYY-MM-DD.jsonl`) 파일 목록.
 *   날짜명을 JS 로 계산해 비교하지 않는다 — `bun test` 는 UTC(getTimezoneOffset=0)로 실행되는
 *   반면 collect.sh 는 OS 로컬타임(`date '+%Y-%m-%d'`)으로 버킷을 만들어, UTC 자정~로컬 자정
 *   구간에서 날짜가 어긋나기 때문(TZ flake). 디렉토리 내용으로 검증해 TZ 비의존화한다.
 */
function rawBucketFiles(home: string): string[] {
  const dir = hookRawDir(home);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n));
}

afterEach(() => {
  while (createdHomes.length) {
    const h = createdHomes.pop()!;
    try {
      rmSync(h, { recursive: true, force: true });
    } catch {
      // 청소 실패는 테스트 결과에 영향 없음
    }
  }
});

describe('spyglass-collect.sh raw 원장 게이트', () => {
  test('DIAG 미설정 → raw 기록 안 함 (디렉토리도 없음)', async () => {
    const home = await runCollect({});
    expect(existsSync(hookRawDir(home))).toBe(false);
    expect(rawBucketFiles(home).length).toBe(0);
  });

  test('SPYGLASS_DIAG_ENABLED=1 → 일자별 버킷에 payload 기록', async () => {
    const home = await runCollect({ SPYGLASS_DIAG_ENABLED: '1' });
    const files = rawBucketFiles(home);
    expect(files.length).toBe(1);
    expect(readFileSync(join(hookRawDir(home), files[0]), 'utf8')).toContain('"t":"x"');
  });

  test('SPYGLASS_DIAG_ENABLED=true (대소문자 무관) → 기록', async () => {
    const home = await runCollect({ SPYGLASS_DIAG_ENABLED: 'TRUE' });
    expect(rawBucketFiles(home).length).toBe(1);
  });

  test('DIAG 활성이어도 디스크 critical 이면 skip', async () => {
    // 가용량보다 큰 critical 임계 → df 가드가 기록을 막는다
    const home = await runCollect({
      SPYGLASS_DIAG_ENABLED: '1',
      SPYGLASS_DISK_MIN_FREE_MB: String(1024 * 1024 * 1024), // 1PB
    });
    expect(rawBucketFiles(home).length).toBe(0);
  });
});
