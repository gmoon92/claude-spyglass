/**
 * log.ts — 정보성 콘솔 출력 게이트 단일 SSoT.
 *
 * 책임:
 *   서버·graph·meta-docs 가 찍는 *정보성* 라인(부팅 요약, 주기 체크 결과, 연결 카운트 등)을
 *   한 개의 스위치로 켜고 끈다. 기본값은 OFF — 콘솔에는 경고/에러와 부팅 엔드포인트 한 줄만
 *   남는다. 어떤 라인이 정보성인지의 판단은 호출자가 하되, *언제 출력하는가* 의 판단은
 *   본 모듈만 한다(호출자에 `if (flag)` 분기를 흩뿌리지 않는다).
 *
 * 정책:
 *   - 스위치는 `SPYGLASS_DIAG_ENABLED` 하나. 진단 파일 기록(diag-log)·[PROXY]/[RECV] 라인과
 *     같은 플래그를 공유해, 디버깅 시 "무엇을 켜야 하는지" 가 하나로 유지된다.
 *   - 모듈 로드 시점 1회 평가 — 호출마다 env lookup 하지 않는다. 플래그 변경은 재기동 필요.
 *   - `console.warn` / `console.error` 는 본 게이트의 대상이 아니다. 항상 출력된다.
 *   - 인자는 가공 없이 `console.log` 로 전달 — 접두어를 주입하지 않으므로 호출자의
 *     `[Scope] …` 문자열이 그대로 보존된다.
 *
 * 호출자: server(lifecycle·sse·version-checker·maintenance·proxy·hook), storage-graph(sync worker),
 *         meta-docs(synchronizer).
 */

/**
 * 스위치 평가 — '1' 또는 'true'(대소문자 무관)면 활성.
 * 모듈 로드 시점 1회 평가하므로 서버를 재기동해야 변경이 반영된다.
 */
const VERBOSE = (() => {
  const v = (process.env.SPYGLASS_DIAG_ENABLED || '').trim().toLowerCase();
  return v === '1' || v === 'true';
})();

/**
 * 정보성 출력이 켜져 있는지 조회.
 * 비싼 페이로드를 만들기 전에 호출자가 먼저 가드할 때 사용한다.
 */
export function isVerboseLogging(): boolean {
  return VERBOSE;
}

/**
 * 정보성 한 줄 출력 — 스위치가 꺼져 있으면 no-op.
 * 경고·에러는 이 함수를 거치지 않는다(항상 보여야 하므로 console.warn/error 직접 호출).
 */
export function logVerbose(...args: unknown[]): void {
  if (!VERBOSE) return;
  console.log(...args);
}
