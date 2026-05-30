/**
 * 서버 런타임 설정 — 환경변수에서 PORT/HOST/DB_PATH/shutdown deadline 결정.
 *
 * 변경 이유: 환경변수 키·기본값·디폴트 설정 변경 시 한 곳만 수정.
 *
 * 사용처:
 *  - PORT/HOST/DB_PATH: lifecycle.startServer
 *  - SHUTDOWN_TIMEOUT_MS: daemon.gracefulShutdown(guard) + lifecycle.stopServer(awaitInFlight)
 */

import { getDefaultDbPath } from '@spyglass/storage';

/** 기본 포트 */
export const DEFAULT_PORT = 9999;

/**
 * 환경변수를 우선순위대로 읽어 첫 non-empty 값을 반환 (consistency-hardening P2.1).
 *
 * 배경: 구버전은 `SPGLASS_*` (오타 — Y 누락) 를 썼다. 정상 철자 `SPYGLASS_*` 로 옮기되,
 * 기존에 `SPGLASS_*` 를 설정해 둔 환경이 조용히 기본값으로 폴백하지 않도록 별칭으로
 * 함께 읽는다. 신철자(SPYGLASS_*)가 우선.
 */
function pickEnv(...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = process.env[k];
    if (v != null && v.length > 0) return v;
  }
  return undefined;
}

/** 환경변수에서 설정 — 신철자 SPYGLASS_* 우선, 구철자 SPGLASS_* 폴백(하위 호환). */
export const PORT = parseInt(
  pickEnv('SPYGLASS_PORT', 'SPGLASS_PORT') || `${DEFAULT_PORT}`,
  10,
);
export const HOST = pickEnv('SPYGLASS_HOST', 'SPGLASS_HOST') || '127.0.0.1';
export const DB_PATH = pickEnv('SPYGLASS_DB_PATH', 'SPGLASS_DB_PATH') || getDefaultDbPath();

/** loopback(루프백) 주소 집합 — 이 외의 바인딩은 외부 노출 경고 대상. */
export const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/** host 가 loopback 이 아니면 true — non-loopback 바인딩 경고 판정용. */
export function isNonLoopbackHost(host: string): boolean {
  return !LOOPBACK_HOSTS.has(host);
}

/**
 * graceful shutdown deadline (ms).
 *  - daemon: SIGTERM/SIGINT 핸들러의 guard timer
 *  - lifecycle: awaitInFlight() 최대 대기
 *  - 기본 10초 — proxy 응답 평균 + dev UX 절충. 환경변수로 override.
 */
export const SHUTDOWN_TIMEOUT_MS = Number(
  process.env.SPYGLASS_SHUTDOWN_TIMEOUT_MS ?? 10_000,
);
