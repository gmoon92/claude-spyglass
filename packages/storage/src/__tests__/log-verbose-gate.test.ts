/**
 * 정보성 콘솔 출력 게이트(runtime/log.ts) 동작 명세.
 *
 * @description
 *   기본값(SPYGLASS_DIAG_ENABLED 미설정)에서 logVerbose 는 아무것도 출력하지 않는다.
 *   플래그를 켜면 인자를 가공 없이 그대로 출력한다 — 호출자의 `[Scope] …` 접두어가 보존되어야
 *   [PROXY]/[RECV] 같은 기존 grep 워크플로가 깨지지 않는다.
 *
 *   VERBOSE 는 모듈 로드 시 1회 평가되므로 같은 프로세스에서 양 분기를 검증할 수 없다
 *   → env 를 달리한 서브프로세스(Bun.spawnSync)로 격리. (log-result-diag-gate.test.ts 와 동일 패턴)
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const LOG_MODULE_PATH = resolve(import.meta.dir, '../runtime/log.ts');

function runProbe(diagEnv: string | undefined): { stdout: string; exitCode: number } {
  const dir = mkdtempSync(join(tmpdir(), 'spyglass-verbose-gate-'));
  const probe = join(dir, 'probe.ts');
  writeFileSync(
    probe,
    `
import { isVerboseLogging, logVerbose } from ${JSON.stringify(LOG_MODULE_PATH)};
logVerbose('[Probe] info line', { n: 1 });
console.log('[Probe] isVerboseLogging=' + isVerboseLogging());
`,
  );
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  delete env.SPYGLASS_DIAG_ENABLED;
  if (diagEnv !== undefined) env.SPYGLASS_DIAG_ENABLED = diagEnv;
  const r = Bun.spawnSync(['bun', probe], { env });
  rmSync(dir, { recursive: true, force: true });
  return { stdout: r.stdout.toString(), exitCode: r.exitCode };
}

describe('logVerbose 게이트', () => {
  describe('플래그가 꺼져 있으면 (운영 기본)', () => {
    test('미설정 — 정보성 라인을 출력하지 않는다', () => {
      const { stdout, exitCode } = runProbe(undefined);
      expect(exitCode).toBe(0);
      expect(stdout).not.toContain('[Probe] info line');
      expect(stdout).toContain('[Probe] isVerboseLogging=false');
    });

    test('SPYGLASS_DIAG_ENABLED=0 — 정보성 라인을 출력하지 않는다', () => {
      const { stdout } = runProbe('0');
      expect(stdout).not.toContain('[Probe] info line');
    });
  });

  describe('플래그가 켜져 있으면', () => {
    test('SPYGLASS_DIAG_ENABLED=1 — 인자를 접두어 주입 없이 그대로 출력한다', () => {
      const { stdout } = runProbe('1');
      expect(stdout).toContain('[Probe] info line');
      expect(stdout).toContain('[Probe] isVerboseLogging=true');
    });

    test('SPYGLASS_DIAG_ENABLED=true — 대소문자·문자열 표기도 활성으로 인정한다', () => {
      const { stdout } = runProbe('TRUE');
      expect(stdout)
        .toContain('[Probe] isVerboseLogging=true');
    });
  });
});
