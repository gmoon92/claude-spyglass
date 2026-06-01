/**
 * ensure-ladybug.ts — @ladybugdb/core 네이티브 바이너리(lbugjs.node) 설치 보장
 *
 * 왜 필요한가:
 *   bun install 은 trustedDependencies 에 등록돼 있어도 @ladybugdb/core 의 post-install
 *   스크립트(install.js)를 실행하지 않는 경우가 있다. install.js 는 플랫폼별 서브패키지
 *   (@ladybugdb/core-darwin-arm64 등) 에서 lbugjs.node 를 메인 패키지 디렉토리로 복사하는데,
 *   이 복사가 누락되면 서버 시작 시 LadybugUnavailableError 가 반복된다.
 *
 * 동작:
 *   1) lbugjs.node 가 이미 있으면 즉시 종료 (0ms 오버헤드).
 *   2) .bun 캐시에서 플랫폼 서브패키지(lbugjs.node)를 찾아 메인 패키지로 복사.
 *   3) 서브패키지도 없으면 경고만 출력하고 정상 종료 — 시작 흐름을 막지 않는다.
 */

import { existsSync, copyFileSync, readdirSync } from 'fs';
import { join } from 'path';

const cwd = process.cwd();
const platform = process.platform; // darwin | linux | win32
const arch = process.arch;          // arm64 | x64

const bunDir = join(cwd, 'node_modules', '.bun');

// ── 메인 패키지 디렉토리 탐색 ─────────────────────────────────────────────────
// 패턴: @ladybugdb+core@X.Y.Z (서브패키지 @ladybugdb+core-darwin-arm64@... 와 구분)
function findMainPkgDir(): string | null {
  if (!existsSync(bunDir)) return null;
  const entry = readdirSync(bunDir).find(
    (e) => e.startsWith('@ladybugdb+core@'),
  );
  if (!entry) return null;
  return join(bunDir, entry, 'node_modules', '@ladybugdb', 'core');
}

const mainPkgDir = findMainPkgDir();
if (!mainPkgDir || !existsSync(mainPkgDir)) {
  console.log('[ensure-ladybug] @ladybugdb/core not installed — skipping');
  process.exit(0);
}

const targetNodeFile = join(mainPkgDir, 'lbugjs.node');
if (existsSync(targetNodeFile)) {
  console.log('[ensure-ladybug] lbugjs.node already present ✓');
  process.exit(0);
}

// ── 서브패키지(플랫폼 바이너리)에서 복사 ────────────────────────────────────
// 패턴: @ladybugdb+core-darwin-arm64@X.Y.Z
const subPkgPrefix = `@ladybugdb+core-${platform}-${arch}@`;
const subPkgEntry = existsSync(bunDir)
  ? readdirSync(bunDir).find((e) => e.startsWith(subPkgPrefix))
  : undefined;

if (!subPkgEntry) {
  console.warn(
    `[ensure-ladybug] sub-package ${subPkgPrefix}* not found in .bun cache — graph features disabled`,
  );
  process.exit(0);
}

const subPkgNodeFile = join(
  bunDir,
  subPkgEntry,
  'node_modules',
  '@ladybugdb',
  `core-${platform}-${arch}`,
  'lbugjs.node',
);

if (!existsSync(subPkgNodeFile)) {
  console.warn(
    `[ensure-ladybug] lbugjs.node not found in ${subPkgEntry} — graph features disabled`,
  );
  process.exit(0);
}

copyFileSync(subPkgNodeFile, targetNodeFile);
console.log(`[ensure-ladybug] lbugjs.node installed from ${subPkgEntry} ✓`);
