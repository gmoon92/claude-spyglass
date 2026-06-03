/**
 * 정보성 [PROXY] stdout 로그의 DIAG 게이트 방향 검증.
 *
 * @description
 *   운영 기본값(SPYGLASS_DIAG_ENABLED off)에서는 [PROXY] 정보성 라인이 stdout에
 *   찍히지 않아야 한다 — hook [RECV] 게이트(d94bc5c)와 동일 방향.
 *   (과거 626777e는 방향이 반대여서 운영 중 프록시 요청마다 노이즈가 발생했음.)
 *
 *   isDiagEnabled()의 ENABLED는 모듈 로드 시 1회 평가되므로 같은 프로세스에서
 *   양 분기를 검증할 수 없다 → env를 달리한 서브프로세스(Bun.spawnSync)로 격리.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const LOG_RESULT_PATH = resolve(import.meta.dir, '../log-result.ts');

/** log-result의 세 외부 노출 함수를 모두 호출하는 probe를 서브프로세스로 실행. */
function runProbe(diagEnv: string | undefined): { stdout: string; exitCode: number } {
  const dir = mkdtempSync(join(tmpdir(), 'spyglass-log-gate-'));
  const probe = join(dir, 'probe.ts');
  writeFileSync(
    probe,
    `
import { proxyInfoLog, logInbound, logResult } from ${JSON.stringify(LOG_RESULT_PATH)};
proxyInfoLog('[PROXY] probe-info-line');
logInbound({ method: 'POST', pathname: '/v1/messages', model: 'claude-opus-4-8' });
logResult({
  method: 'POST', path: '/v1/messages', statusCode: 200, ms: 123, isStream: true,
  model: 'claude-opus-4-8', usage: { input_tokens: 10, output_tokens: 5 },
  tps: 35.5, stopReason: 'end_turn', ttft: 50, errorType: null, requestPreview: 'hello',
});
`,
  );
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  delete env.SPYGLASS_DIAG_ENABLED;
  if (diagEnv !== undefined) env.SPYGLASS_DIAG_ENABLED = diagEnv;
  const r = Bun.spawnSync(['bun', probe], { env });
  rmSync(dir, { recursive: true, force: true });
  return { stdout: r.stdout.toString(), exitCode: r.exitCode };
}

describe('proxyInfoLog DIAG 게이트 방향 ([RECV]와 일치)', () => {
  test('DIAG 미설정(운영 기본) — [PROXY] 정보성 라인 출력 0건', () => {
    const { stdout, exitCode } = runProbe(undefined);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('[PROXY]');
  });

  test('DIAG=0 (명시 비활성) — [PROXY] 정보성 라인 출력 0건', () => {
    const { stdout, exitCode } = runProbe('0');
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('[PROXY]');
  });

  test('DIAG=1 — 진입/응답/커스텀 라인 모두 출력', () => {
    const { stdout, exitCode } = runProbe('1');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('[PROXY] probe-info-line');
    expect(stdout).toContain('[PROXY] → POST /v1/messages [claude-opus-4-8]');
    expect(stdout).toContain('[PROXY] ✓ POST /v1/messages → 200 123ms (stream)');
    expect(stdout).toContain('[PROXY]   tokens   : in=10 out=5 cache_create=0 cache_read=0');
  });
});
