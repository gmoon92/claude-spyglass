/**
 * hook 모듈 — 외부 노출 barrel
 *
 * 책임:
 *  - 다른 패키지/파일이 사용하는 public API만 골라 re-export.
 *  - hook/* 내부 구현 모듈은 외부에서 직접 import 금지 (이 파일만 통해 접근).
 *
 * 외부 사용처 (현재):
 *  - server/src/index.ts     : rawCollectHandler (HTTP 라우팅, /collect 엔드포인트)
 *  - server/src/events.ts    : parseTranscript, getLastTurnId
 *  - server/src/proxy/       : getLastTurnId (proxy 측 turn_id 매칭)
 *  - server/src/__tests__/   : handleCollect, collectHandler, CollectPayload (deprecated alias)
 *
 * 모듈 내부 구조 — Strategy Pattern 적용 (v21):
 *  ┌─────────────────────────────────────────────────────────────────┐
 *  │ http-entry.ts (HTTP entry, /collect)                            │
 *  │     ↓ raw 페이로드 받아 진단 로그 기록 후 dispatcher에 위임     │
 *  │ dispatcher.ts (Strategy Registry + Dispatch)                    │
 *  │     ↓ hook_event_name → REGISTRY.get() → 매칭 핸들러            │
 *  │ handlers/                                                        │
 *  │   ├─ pre-tool-use.handler.ts                                    │
 *  │   ├─ post-tool-use.handler.ts (Agent 자식 INSERT 포함)          │
 *  │   ├─ user-prompt-submit.handler.ts                              │
 *  │   ├─ system-event.handler.ts (fallback)                         │
 *  │   └─ _shared.ts (makeRequestId, deriveTokensConfidence)         │
 *  │ event-handler.ts (interface HookEventHandler + HookContext)     │
 *  │     ↓ 모든 핸들러가 구현                                        │
 *  │ processor.ts (processHookEvent — 정제된 payload 처리)           │
 *  │     ↓ uses session, persist                                     │
 *  │ persist.ts (saveRequest + persistSubagentChildren)              │
 *  │     ↓ uses turn, preview, tool-detail                           │
 *  │ transcript-context.ts → transcript.ts                           │
 *  │ types.ts (모든 모듈이 타입만 의존)                              │
 *  └─────────────────────────────────────────────────────────────────┘
 *
 * 새 hook event 추가 절차 (자바 비유: @Component 추가):
 *  1. handlers/<new-event>.handler.ts 작성 (HookEventHandler 구현)
 *  2. dispatcher.ts의 HANDLERS 배열에 인스턴스 1줄 추가
 *  3. 끝 — 다른 파일 수정 불필요 (OCP 준수)
 */

// 외부 노출되는 public API
export {
  handleHookHttpRequest,
  rawCollectHandler, // @deprecated handleHookHttpRequest 사용
  collectHandler,    // @deprecated 정제된 payload 직접 수신 (테스트용)
} from './http-entry';
export { processHookEvent } from './processor';
export { parseTranscript } from './transcript';
export { getLastTurnId } from './turn';
export { dispatchHookEvent, listRegisteredEventTypes } from './dispatcher';
export type { HookEventHandler, HookContext } from './event-handler';

// 외부에서 타입으로 사용
export type {
  ClaudeHookPayload,
  NormalizedHookPayload,
  HookProcessResult,
  CollectPayload, // @deprecated NormalizedHookPayload 사용
  CollectResult,  // @deprecated HookProcessResult 사용
} from './types';

// @deprecated processHookEvent 사용 — 외부 호환을 위해 alias로 유지
export { processHookEvent as handleCollect } from './processor';
