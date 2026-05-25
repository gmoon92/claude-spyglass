/**
 * flag.ts — 운영 모드 feature flag (SPYGLASS_GRAPH_MODE)
 *
 * 책임:
 *   환경변수 `SPYGLASS_GRAPH_MODE` 를 파싱하여 그래프 projection 사용 모드를
 *   결정한다. 이 모듈은 *부팅 시점 1회* 만 값을 읽고 캐시하며, 실행 중 변경은
 *   재시작 없이 반영되지 않는다 (사용자 메모리: `feedback_no_server_restart`).
 *
 * 의존성:
 *   - process.env.SPYGLASS_GRAPH_MODE — 사용자 또는 launchctl/dmg 설정으로 주입.
 *
 * 호출 흐름:
 *   1) Server bootstrap 시 `startGraphSyncWorker()` 또는 graph router가
 *      `getGraphMode()` 호출 → 캐시되지 않았으면 파싱.
 *   2) 이후 모든 호출은 캐시된 값을 반환.
 *   3) 테스트는 `resetGraphModeCache()` 로 초기화.
 *
 * 모드 정의 (SSoT — 다른 곳에서 모드 값을 직접 비교하지 말고 본 enum/함수 사용):
 *   - `off`     : 그래프 코드 완전 dormant. sync worker no-op, API는 SQLite only.
 *   - `shadow`  : SQLite를 사용자에게 응답, 백그라운드에서 Ladybug 결과를 비교 로그만.
 *                 가장 안전한 기본값. 회로 차단기로 보호되며 사용자 영향 0.
 *   - `primary` : Ladybug 결과를 응답에 사용. 실패 시 자동 SQLite fallback.
 *                 회로 OPEN 상태에서는 자동으로 shadow처럼 동작.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/.tmp/plans/spyglass/graph-db-research/05-migration-strategy.md
 *   §1.3 P1 — Single Query Pilot, mode 3-state flag.
 */

// =============================================================================
// 타입
// =============================================================================

export type GraphMode = 'off' | 'shadow' | 'primary';

/**
 * 본 파일이 SSoT — 다른 모듈은 이 상수를 import 하지 말고 `getGraphMode()` 결과로
 * 분기. 직접 비교가 필요하면 `=== 'off'` 처럼 리터럴로 비교한다 (코드 grep 용이).
 */
const ALL_MODES: readonly GraphMode[] = ['off', 'shadow', 'primary'] as const;

/**
 * 기본 모드. P1 Single Query Pilot 권고에 따라 shadow 로 시작:
 *  - 사용자에게 보이는 응답은 SQLite (영향 0)
 *  - Ladybug 결과는 백그라운드 비교 로그로만 활용
 *  - 회로 차단기가 자동 fallback 보장
 */
const DEFAULT_MODE: GraphMode = 'shadow';

// =============================================================================
// 캐시 + 파싱
// =============================================================================

let cachedMode: GraphMode | null = null;

/**
 * 캐시된 모드를 반환. 없으면 환경변수에서 1회 읽고 캐싱.
 *
 * 파싱 규칙:
 *   - 환경변수가 없거나 빈 문자열이면 DEFAULT_MODE.
 *   - 대소문자 무시 (`OFF`, `Off`, `off` 모두 동등).
 *   - 알 수 없는 값은 console.warn 후 DEFAULT_MODE 폴백 — typo로 dormant되는 사고 방지.
 */
export function getGraphMode(): GraphMode {
  if (cachedMode !== null) return cachedMode;

  const raw = (process.env.SPYGLASS_GRAPH_MODE ?? '').trim().toLowerCase();
  if (raw.length === 0) {
    cachedMode = DEFAULT_MODE;
    return cachedMode;
  }

  if ((ALL_MODES as readonly string[]).includes(raw)) {
    cachedMode = raw as GraphMode;
    return cachedMode;
  }

  console.warn(
    `[graph-flag] Unknown SPYGLASS_GRAPH_MODE="${raw}" — falling back to "${DEFAULT_MODE}". ` +
      `Allowed values: ${ALL_MODES.join(' | ')}`,
  );
  cachedMode = DEFAULT_MODE;
  return cachedMode;
}

/**
 * "Ladybug 코드 경로를 한 번이라도 시도하는가?" 의 단일 조건. dormant 모드를 분기마다
 * 명시적으로 비교해야 하는 보일러플레이트를 줄이기 위한 작은 헬퍼.
 */
export function isGraphEnabled(): boolean {
  return getGraphMode() !== 'off';
}

/**
 * 테스트 전용 — 환경변수 변경 후 캐시 무효화. 프로덕션 코드는 호출하지 않는다.
 * 본 함수가 export 되는 이유는 단위 테스트가 mode 전이를 검증하기 위해서다.
 */
export function resetGraphModeCache(): void {
  cachedMode = null;
}
