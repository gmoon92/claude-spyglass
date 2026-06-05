/**
 * boot-prereqs.ts — 서버 부팅 전제조건(Ladybug native binding·web 빌드) 내재화.
 *
 * 책임:
 *   `startServer()` 진입 직후 1회 실행되어, 셸 스크립트(dev/start)를 거치지 않은 진입점
 *   (`index.ts start/restart` 직접 호출, `/api/update` self-restart, Electron, Homebrew)으로
 *   부팅하더라도 Ladybug 미설치·web 빌드 누락으로 "실행조차 안 되는" 상황을 막는다.
 *   기존에 보장이 package.json 의 dev/start 셸 스크립트에만 외재화돼 있던 것을, 모든 부팅이
 *   수렴하는 startServer() 한 곳으로 끌어와 SSoT 로 만든다.
 *
 * 의도적 비대칭 (왜 install 은 여기서 안 하나):
 *   `ensure-deps`(bun install)는 본 모듈/lifecycle 이 import 되는 시점에 이미 늦다 —
 *   lifecycle.ts 가 @spyglass/* 를 import 하므로 node_modules 부재 시 파일 로드 자체가 실패한다.
 *   install 은 반드시 import 보다 먼저(=셸 prelude, package.json 의 ensure-deps.ts)에서 일어나야 한다.
 *   따라서 본 모듈은 import-time 과 무관한 ladybug(lazy native binding)·web(요청 시 동적 경로)만 보강한다.
 *
 * 비차단 원칙: 모든 보강 실패는 경고 후 계속 — 부팅을 막지 않는다(graph 비활성/stale 에셋이라도 기동).
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

/** runtime/ 기준 repo 루트 (dispatch.ts WEB_ROOT 패턴과 동축: runtime → src → server → packages → root). */
function resolveRepoRoot(): string {
  return fileURLToPath(new URL('../../../../', import.meta.url));
}

/**
 * source(git clone) 환경에서만 prereq 를 실행할지 판정 (순수 함수 — 테스트 대상).
 *
 * packaged(Electron DMG)/brew 배포본은 빌드 산출물이 이미 번들돼 있고 git/scripts 도 없으므로 skip.
 * `SPYGLASS_SKIP_BOOT_PREREQS` 로 강제 비활성(테스트·진단)도 허용.
 */
export function shouldRunPrereqs(
  repoRoot: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.SPYGLASS_SKIP_BOOT_PREREQS) return false;
  const channel = env.SPYGLASS_UPDATE_CHANNEL;
  if (channel === 'packaged' || channel === 'brew') return false;
  // source 환경 표지: 부팅 보강에 쓰는 스크립트/빌드 대상이 실제로 존재해야 한다.
  return (
    existsSync(join(repoRoot, 'scripts', 'ensure-ladybug.ts')) &&
    existsSync(join(repoRoot, 'packages', 'web', 'package.json'))
  );
}

/**
 * web 빌드 산출물이 없어 재빌드가 필요한지 판정 (순수 함수 — 테스트 대상).
 * 우선 존재 가드만 사용해 과빌드를 방지한다(dist/index.html 부재 = stale).
 */
export function isWebBuildStale(repoRoot: string): boolean {
  return !existsSync(join(repoRoot, 'packages', 'web', 'dist', 'index.html'));
}

/** 자식 스크립트를 repo 루트에서 동기 실행. 실패는 경고만(비차단). */
function runStep(label: string, args: string[], cwd: string): void {
  try {
    const proc = Bun.spawnSync(['bun', 'run', ...args], { cwd, stdout: 'inherit', stderr: 'inherit' });
    if (!proc.success) {
      console.warn(`[boot-prereqs] ${label} exited non-zero (code ${proc.exitCode}) — continuing`);
    }
  } catch (err) {
    console.warn(`[boot-prereqs] ${label} failed to run — continuing:`, err);
  }
}

/**
 * 부팅 전제조건 보강 — startServer() 진입부에서 1회 호출.
 *   1. Ladybug native binding 보강 (이미 present 면 ~0ms)
 *   2. web 빌드 산출물 부재 시 vite build (존재하면 skip)
 * source 환경이 아니면 전체 no-op.
 */
export function ensureBootPrerequisites(): void {
  const repoRoot = resolveRepoRoot();
  if (!shouldRunPrereqs(repoRoot)) return;

  // Ladybug: 이미 lbugjs.node 가 있으면 ensure-ladybug.ts 가 즉시 통과(0ms).
  runStep('ensure-ladybug', ['scripts/ensure-ladybug.ts'], repoRoot);

  // web build: dist 산출물이 없을 때만 빌드(과빌드 방지).
  if (isWebBuildStale(repoRoot)) {
    console.log('[boot-prereqs] web/dist missing — running web:build');
    runStep('web:build', ['web:build'], repoRoot);
  }
}
