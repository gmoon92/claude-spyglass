/**
 * flag.ts — 운영 모드 feature flag (`SPYGLASS_GRAPH_MODE` + server-config.json)
 *
 * 책임:
 *   그래프 projection 사용 모드를 *3-tier 우선순위* 로 결정한다 (PR 1 영속화).
 *
 *     1) `process.env.SPYGLASS_GRAPH_MODE`  — CLI 강제 오버라이드 (가장 우선)
 *     2) `~/.spyglass/server-config.json#graphMode`  — 대시보드 GUI 저장값
 *     3) `'shadow'`  — 기본값
 *
 *   이 모듈은 *부팅 시점 1회* 만 값을 읽고 캐시하며, 실행 중 변경은 재시작 없이
 *   반영되지 않는다 (사용자 메모리: `feedback_no_server_restart`). 단, 웹 대시보드의
 *   런타임 setter `setGraphMode()` 가 호출되면 즉시 캐시 갱신.
 *
 * 의존성:
 *   - process.env.SPYGLASS_GRAPH_MODE  — 사용자 셸/launchctl/Electron env.
 *   - config-file.ts::loadServerConfig — file source 평가에 사용 (async I/O).
 *
 * 호출 흐름:
 *   1) Server bootstrap 시 `startGraphSyncWorker()` 또는 graph router가
 *      `getGraphMode()` 호출 → 캐시되지 않았으면 *env 만 동기적으로 평가* 후 캐시.
 *   2) 부팅 직후 `await refreshGraphModeFromFile()` 가 호출되어 env 미지정 시 file
 *      값을 반영 (async — 부팅 lifecycle 가 명시적으로 호출).
 *   3) 이후 모든 동기 호출은 캐시된 값 반환. 테스트는 `resetGraphModeCache()` 로 초기화.
 *
 * Source 추적:
 *   `getGraphModeSource()` 가 현재 캐시된 값의 *출처* 를 반환 — UI 가 사용자에게
 *   "env override 가 있어 GUI 변경이 영구화되지 않는다" 같은 경고를 노출할 수 있도록.
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

import { loadServerConfig } from './config-file';

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
 * 기본 모드. migration-plan §F: SQLite ego flow 제거로 인해 'primary' 로 cutover.
 *  - 사용자 응답은 Ladybug. 회로 OPEN / Ladybug 미설치 시 빈 응답 + 안내.
 *  - SQLite fallback 0 (이전 fallback 자산은 §B 에서 제거됨).
 *  - 'shadow' 는 호환성을 위해 enum 에 유지하되 실제 응답 동작은 'primary' 와 동일.
 *  - 설치 확인 + 자동 설치 UI 는 설정 페이지의 "Ladybug 의존성" 카드가 책임.
 */
const DEFAULT_MODE: GraphMode = 'primary';

// =============================================================================
// 타입 — 출처 추적
// =============================================================================

/**
 * 현재 graph mode 의 *출처*. UI 가 사용자에게 "왜 이 값이 적용됐는지" 를 명확히 노출.
 *
 *   - `env`    : `process.env.SPYGLASS_GRAPH_MODE` 가 우선 적용. GUI 변경은 file 에만
 *                저장될 뿐 *현재 세션에는 반영되지 않음* — UI 가 경고 배너로 안내.
 *   - `file`   : server-config.json 의 graphMode 가 적용. 가장 일반적인 케이스.
 *   - `default`: env/file 모두 미지정 → 기본값 'shadow'. 사용자가 GUI 에서 한 번도
 *                토글하지 않은 fresh install.
 */
export type GraphModeSource = 'env' | 'file' | 'default';

// =============================================================================
// 캐시 + 파싱
// =============================================================================

let cachedMode: GraphMode | null = null;
let cachedSource: GraphModeSource = 'default';

/** env 값을 파싱해 GraphMode 또는 null 반환. 알 수 없는 값은 경고 + null. */
function parseEnvMode(): GraphMode | null {
  const raw = (process.env.SPYGLASS_GRAPH_MODE ?? '').trim().toLowerCase();
  if (raw.length === 0) return null;
  if ((ALL_MODES as readonly string[]).includes(raw)) return raw as GraphMode;
  console.warn(
    `[graph-flag] Unknown SPYGLASS_GRAPH_MODE="${raw}" — ignored. ` +
      `Allowed values: ${ALL_MODES.join(' | ')}`,
  );
  return null;
}

/**
 * 캐시된 모드를 반환. 없으면 env 만 *동기적으로* 평가 후 캐싱.
 *
 *   - file source 는 async I/O 라 본 동기 함수에선 *읽지 않는다*. 부팅 lifecycle 에서
 *     `await refreshGraphModeFromFile()` 가 호출되어 env 미지정 시 file 값이 반영.
 *   - 이 분리 덕에 *최초 호출이 sync* 인 호출자(graph router 등) 가 await 없이 안전하게
 *     동작한다. 영속 값 반영 지연은 부팅 직후 수십 ms.
 *
 * 출처 결정:
 *   env 값이 있으면 source='env'. 없으면 source='default' (file refresh 전).
 *   refreshGraphModeFromFile() 이후 env 가 여전히 없으면 'file' 또는 'default'.
 */
export function getGraphMode(): GraphMode {
  if (cachedMode !== null) return cachedMode;

  const envMode = parseEnvMode();
  if (envMode !== null) {
    cachedMode = envMode;
    cachedSource = 'env';
    return cachedMode;
  }
  cachedMode = DEFAULT_MODE;
  cachedSource = 'default';
  return cachedMode;
}

/**
 * 현재 캐시된 mode 의 출처.
 *
 *   getGraphMode() 가 한 번도 호출되지 않은 상태에서 호출하면 'default'. 즉 항상 안전.
 *   호출자가 사용자에게 "env override 가 있어 GUI 토글이 영구화되지 않습니다" 같은
 *   경고를 띄우려면 본 헬퍼의 반환을 확인하면 됨.
 */
export function getGraphModeSource(): GraphModeSource {
  if (cachedMode === null) {
    // 캐시 미초기화 — getGraphMode() 한 번 호출해 평가 트리거.
    getGraphMode();
  }
  return cachedSource;
}

/**
 * 부팅 lifecycle 에서 *한 번* 호출되어 file source 를 평가하고 캐시를 갱신.
 *
 *   - env 가 우선이면 file 은 무시 (source='env' 유지).
 *   - env 가 없고 file 에 graphMode 가 있으면 그 값 + source='file'.
 *   - 둘 다 없으면 'default'.
 *
 *   본 함수는 *idempotent* — 여러 번 호출해도 결과 동일. 다만 의도된 호출은 부팅
 *   직후 1회 (lifecycle.ts::startServer 에서 await).
 */
export async function refreshGraphModeFromFile(): Promise<void> {
  // 1) env 평가 — 있으면 무조건 env 우선.
  const envMode = parseEnvMode();
  if (envMode !== null) {
    cachedMode = envMode;
    cachedSource = 'env';
    return;
  }
  // 2) file 평가 — 깨진 파일/없는 파일은 loadServerConfig 가 안전 폴백.
  try {
    const cfg = await loadServerConfig();
    if (cfg.graphMode !== undefined) {
      cachedMode = cfg.graphMode;
      cachedSource = 'file';
      return;
    }
  } catch (err) {
    // loadServerConfig 자체는 throw 하지 않지만 방어적 catch.
    console.warn('[graph-flag] refreshGraphModeFromFile failed (using default):', err);
  }
  // 3) 둘 다 없음 — default.
  cachedMode = DEFAULT_MODE;
  cachedSource = 'default';
}

/**
 * "Ladybug 코드 경로를 한 번이라도 시도하는가?" 의 단일 조건. dormant 모드를 분기마다
 * 명시적으로 비교해야 하는 보일러플레이트를 줄이기 위한 작은 헬퍼.
 */
export function isGraphEnabled(): boolean {
  return getGraphMode() !== 'off';
}

/**
 * 테스트 전용 — 환경변수 / file 캐시 무효화. 프로덕션 코드는 호출하지 않는다.
 * 단위 테스트가 mode 전이를 검증하기 위해 export.
 */
export function resetGraphModeCache(): void {
  cachedMode = null;
  cachedSource = 'default';
}

/**
 * 런타임 모드 setter — 본 세션 안에서 모드를 즉시 전환한다.
 *
 *   사용처: 웹 대시보드 *설정 패널* 의 graph mode segmented control.
 *   영속성: 본 함수는 *런타임 캐시만* 변경. 파일 저장은 호출 측 (routes/settings.ts) 이
 *          `saveServerConfig({graphMode})` 로 별도 처리 — SRP.
 *
 *   source: 본 호출의 의도는 "사용자가 GUI 에서 명시적 변경" 이므로 'file' 로 표시.
 *           env override 가 있는 경우에는 *적용은 env 가 계속 우선* 이지만 GUI 가
 *           원하는 *영구 값* 은 'file' 로 표시되어 UI 가 정확히 안내 가능.
 *           만약 env override 와 GUI 가 충돌하면 *호출 측이* env 우선을 사용자에게 경고.
 *
 *   동시성: cachedMode/Source 는 단순 변수. JS 단일 스레드라 atomic — 별도 lock 불필요.
 *
 *   유의: 모드 변경 직후 sync worker / circuit breaker 가 자동으로 새 모드를 따른다.
 *   (둘 다 호출 시점에 getGraphMode() 로 분기하는 구조라 polling 불필요)
 */
export function setGraphMode(mode: GraphMode): void {
  cachedMode = mode;
  // env source 였다면 그대로 유지 (env override 의 의미를 잃지 않도록).
  // 그 외에는 사용자 명시 변경이므로 file 로 표시.
  if (cachedSource !== 'env') cachedSource = 'file';
}
