/**
 * runtime/in-flight — fire-and-forget 백그라운드 Promise 추적기.
 *
 * 책임:
 *  - proxy/handler/stream.ts 등에서 응답을 client에 즉시 반환한 뒤
 *    fire-and-forget IIFE로 수행하는 DB persist / SSE broadcast 작업의 Promise를 등록.
 *  - graceful shutdown 시점에 lifecycle.stopServer()가 모든 등록 작업의 완료를
 *    deadline 내에서 대기할 수 있도록 awaitInFlight()를 제공.
 *
 * 변경 이유:
 *  - 종료 race(SQLITE_CANTOPEN / 손실 persist)를 한 곳에서 조정하기 위해
 *    "lifecycle ↔ stream" 사이 SRP 분리. 신규 fire-and-forget 분기가 늘어나도
 *    이 모듈만 register만 부착하면 자동으로 graceful 대기 대상이 된다.
 *
 * 의존성:
 *  - 없음 (순수 모듈). lifecycle, stream 양쪽에서 import.
 *
 * 호출 흐름:
 *  - stream.ts handleStreamResponse(IIFE): registerInFlight(promise)
 *  - lifecycle.ts stopServer(): await awaitInFlight(timeoutMs)
 *
 * 주의:
 *  - register는 Promise 자체를 받아 자동으로 settled 시 Set에서 제거한다.
 *    호출 측이 finally 정리를 신경 쓸 필요 없음.
 *  - awaitInFlight는 timeoutMs를 초과하면 미완료 작업이 남아도 resolve 한다.
 *    deadline guard가 별도(daemon.ts)에 존재하므로 여기서 hang을 방지.
 */

const inFlight = new Set<Promise<void>>();

/**
 * fire-and-forget Promise를 추적 집합에 등록한다.
 *
 * - 등록 즉시 then으로 settled 핸들러를 부착해 자동 제거를 보장한다.
 * - 예외는 swallow하지 않는다 — 호출 측 IIFE의 try/catch에서 이미 처리한다는 전제.
 *   여기서는 추적 목적이므로 reject도 "완료"로 간주해 집합에서 제거만 한다.
 */
export function registerInFlight(promise: Promise<void>): void {
  inFlight.add(promise);
  // settled 시 자동 제거 — Promise<void> 계약상 reject도 graceful 추적 관점에서는 종료.
  promise.finally(() => {
    inFlight.delete(promise);
  });
}

/**
 * 등록된 모든 in-flight 작업의 완료를 deadline 내에서 대기한다.
 *
 * @param timeoutMs deadline. 초과 시 미완료 작업이 남아도 resolve.
 * @returns 모두 완료되면 true, timeout이면 false (호출 측 로깅용).
 */
export async function awaitInFlight(timeoutMs: number): Promise<boolean> {
  if (inFlight.size === 0) return true;  // fast-path: 노는 시간 0

  const all = Promise.allSettled(Array.from(inFlight));
  const timeout = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), timeoutMs),
  );
  const result = await Promise.race([all, timeout]);
  return result !== 'timeout';
}

/**
 * 현재 추적 중인 in-flight 작업 개수.
 *
 * - 진행도 표시(daemon drain progress) 및 진단용.
 */
export function getInFlightCount(): number {
  return inFlight.size;
}
