/**
 * proxy 모듈 — 외부 노출 barrel
 *
 * 책임:
 *  - 외부에서 사용하는 public API만 re-export.
 *  - proxy/* 내부 모듈은 외부에서 직접 import 금지 (이 파일만 통해 접근).
 *
 * 외부 사용처 (현재):
 *  - server/src/index.ts : handleProxy (HTTP 라우팅)
 *
 * 모듈 내부 구조:
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │ handler.ts (HTTP entry, /v1/*)                               │
 *  │     ├─ uses upstream         (URL 라우팅 + forward 헤더)     │
 *  │     ├─ uses request-parser   (RequestMeta 추출)              │
 *  │     ├─ uses sse-state        (스트리밍 SSE 누적 파서)        │
 *  │     ├─ uses audit-headers    (v20 클라이언트/응답 헤더)      │
 *  │     ├─ uses log-result       (stdout 디버그 출력)            │
 *  │     ├─ uses backfill         (v19 hook 측 model NULL 채움)   │
 *  │     └─ uses ../hook.getLastTurnId (v19 turn 매칭)            │
 *  │ types.ts (RequestMeta, StreamState, AnthropicUsage)          │
 *  └──────────────────────────────────────────────────────────────┘
 */

export { handleProxy } from './handler';
