/**
 * spyglass CLI — 진입점 (srp-redesign Phase 6).
 *
 * 569줄짜리 단일 파일을 변경 이유별로 cli/* 6파일로 분해한 결과,
 * 이 파일은 main() 디스패처만 남는다. 외부 호출 경로(`bun run packages/server/src/cli.ts doctor`)는
 * 그대로 유지.
 *
 * @usage
 *   bun run packages/server/src/cli.ts doctor
 *   bun run packages/server/src/cli.ts doctor --fix
 */

import { doctor } from './cli/doctor';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const hasFixFlag = args.includes('--fix');

  if (command === 'doctor') {
    await doctor(hasFixFlag);
  } else {
    console.error('사용법: bun run packages/server/src/cli.ts doctor [--fix]');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('오류:', err.message);
  process.exit(1);
});
