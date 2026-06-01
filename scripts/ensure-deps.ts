/**
 * ensure-deps.ts — 선언된 런타임 의존성 설치 보장 (ensure-ladybug 패턴의 의존성 판)
 *
 * 책임:
 *   `bun run start` / `bun run dev` 진입 시, 워크스페이스 package.json 에 **선언됐지만 node_modules 에
 *   아직 설치되지 않은** 의존성이 있으면 `bun install` 로 자동 보강한다. 모두 존재하면 거의 0ms 로
 *   통과(`present ✓`). 새 의존성이 추가된 브랜치를 pull 한 뒤 `bun install` 을 깜빡하고 start/dev 한 경우,
 *   web:build 단계에서 "Cannot find module" 로 죽는 대신 자동 복구한다.
 *
 * 설계(하드코딩 목록 금지 — 선언이 SSoT):
 *   고정 패키지 목록을 들고 있지 않는다. 루트 + packages/* 의 package.json `dependencies` 를 읽어,
 *   각 의존성이 node_modules 에 실재하는지 검사한다. 따라서 앞으로 어떤 의존성이 추가돼도(예: i18next)
 *   별도 수정 없이 자동으로 "선언됐지만 누락" 을 감지한다(전수 설치는 bun install 이 수행).
 *
 * 호출 흐름:
 *   - 입력: 워크스페이스 루트(process.cwd()) + 각 package.json 의 dependencies.
 *   - 판정: 의존성별로 루트 node_modules 또는 소유 패키지 node_modules 에 디렉토리 존재 여부.
 *   - 복구: 하나라도 누락이면 `bun install`(루트) 실행 — 선언적 deps 전체 설치.
 *   - 호출처: 루트 package.json 의 start / dev 스크립트 선두(ensure-ladybug 앞).
 *
 * 주의(재귀 방지): postinstall 에는 결선하지 않는다. postinstall 은 이미 `bun install` 직후 실행되며,
 *   여기서 다시 `bun install` 을 호출하면 postinstall → bun install → postinstall 무한 재귀가 된다.
 */

import { readdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

const cwd = process.cwd();

/** package.json 의 dependencies 키 목록(런타임 의존성). 실패 시 빈 배열. */
function readDeps(pkgJsonPath: string): string[] {
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { dependencies?: Record<string, string> };
    return Object.keys(pkg.dependencies ?? {});
  } catch {
    return [];
  }
}

// 검사 대상 package.json — 루트 + packages/*.
const pkgJsons: string[] = [join(cwd, 'package.json')];
const pkgsDir = join(cwd, 'packages');
if (existsSync(pkgsDir)) {
  for (const entry of readdirSync(pkgsDir)) {
    const p = join(pkgsDir, entry, 'package.json');
    if (existsSync(p)) pkgJsons.push(p);
  }
}

/** 의존성이 루트 또는 소유 패키지 node_modules 에 실재하면 설치됨. */
function isInstalled(pkg: string, ownerDir: string): boolean {
  return existsSync(join(cwd, 'node_modules', pkg)) || existsSync(join(ownerDir, 'node_modules', pkg));
}

const missing = new Set<string>();
for (const pkgJson of pkgJsons) {
  const ownerDir = dirname(pkgJson);
  for (const dep of readDeps(pkgJson)) {
    // 워크스페이스 내부 패키지(@spyglass/*)는 심볼릭 링크라 별도 설치 대상 아님 — 제외.
    if (dep.startsWith('@spyglass/')) continue;
    if (!isInstalled(dep, ownerDir)) missing.add(dep);
  }
}

if (missing.size === 0) {
  console.log('[ensure-deps] all declared dependencies present ✓');
  process.exit(0);
}

console.log(`[ensure-deps] missing: ${[...missing].join(', ')} — running bun install`);
const proc = Bun.spawnSync(['bun', 'install'], { cwd, stdout: 'inherit', stderr: 'inherit' });
if (!proc.success) {
  console.error('[ensure-deps] bun install failed');
  process.exit(proc.exitCode ?? 1);
}
console.log('[ensure-deps] dependencies installed ✓');
process.exit(0);
