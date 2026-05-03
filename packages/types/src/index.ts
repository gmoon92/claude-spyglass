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
} from './request';

export type { NormalizedTurnItem } from './turn';

export type { Session } from './session';
