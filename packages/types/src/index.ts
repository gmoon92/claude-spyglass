/**
 * @spyglass/types — server/TUI/web 공통 데이터 contract.
 *
 * 런타임 코드 0줄. TS 타입 선언만 모은 패키지 (ADR-006, srp-redesign).
 *
 * 사용처:
 *   - packages/server: server/domain/request-normalizer.ts가 이 타입을 import + re-export
 *   - packages/tui: types.ts가 NormalizedRequest를 직접 import
 *   - packages/web: JSDoc `@typedef` import로 IDE 힌트 (런타임 비의존)
 *
 * 변경 정책:
 *   타입 추가/변경은 이 패키지에서만 한다 (SRP — 변경 이유 단일성).
 *   server·TUI는 import만 하므로 단일 변경에 자동 동기화.
 */

export type {
  RequestType,
  RequestRow,
  RequestSubType,
  TrustLevel,
  EventPhase,
  NormalizedRequest,
  BloatedSysField,
  AgentSpikeField,
  SpikeField,
  LoopField,
  SlowField,
} from './request';

export type { NormalizedTurnItem } from './turn';

export type { Session, SessionLiveState } from './session';

// i18n contract — server/tui/web가 공통으로 사용하는 언어 타입 + 상수.
// 런타임 함수(resolveLang/isLang)와 상수(LANG_META/SUPPORTED_LANGS/DEFAULT_LANG)를 포함하므로
// 'export type'이 아닌 일반 'export'를 사용한다.
export type { Lang, LangMeta } from './i18n';
export { SUPPORTED_LANGS, DEFAULT_LANG, LANG_META, isLang, resolveLang } from './i18n';

// CORS contract — origin 허용 판단 + 응답 헤더 생성 SSoT (metrics/server 공통 소비).
// i18n 과 동일하게 런타임 함수를 포함하므로 일반 'export'.
export {
  resolveAllowedOrigin,
  corsHeaders,
  corsHeadersForOrigin,
  withCorsHeaders,
  applyCorsHeaders,
  preflightResponse,
} from './cors';
