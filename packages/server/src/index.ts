/**
 * spyglass Server — 진입점 (srp-redesign Phase 7).
 *
 * 556줄짜리 단일 파일을 변경 이유별로 runtime/* 6파일로 분해한 결과,
 * 이 파일은 외부 공개 API re-export + import.meta.main 디스패처만 남는다.
 *
 * @description Bun HTTP 서버 - API + SSE 스트리밍
 * @see docs/planning/03-adr.md - ADR-001 (글로벌 데몬)
 */

import { dispatchDaemonCommand } from './runtime/daemon';

// 외부 공개 API — 테스트 등에서 사용 (`packages/server/src/__tests__/server.test.ts`).
export { startServer, stopServer, isServerRunning } from './runtime/lifecycle';

if (import.meta.main) {
  await dispatchDaemonCommand(process.argv[2]);
}
