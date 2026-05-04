# ADR-001: Turn ID 무결성 — proxy fallback 윈도우와 orphan 행 처리

- 상태: Accepted (P0 부분만 채택, P1은 follow-up)
- 작성일: 2026-05-04
- 결정 범위: `packages/server/src/events.ts`, `packages/storage/src/queries/proxy.ts`

## Context

claude-spyglass의 "턴(turn)" 개념은 사용자 프롬프트 입력을 시작점으로 하는 컨텍스트 단위로, Claude Code의 multi-turn 누적 모델과 일치한다. 한 턴 안에 prompt + 후속 어시스턴트 응답·tool_call·서브에이전트·스킬·MCP가 모두 동일 `turn_id`로 묶여야 한다.

설계상 일관성은 충족되어 있으나(참조: `hook/persist.ts:131-135`, `hook/turn.ts:33-39`), 운영 데이터(481MB DB, 38 turns / 1,872 requests / 974 proxy_requests)를 검증한 결과 다음 두 가지 실재 이슈가 확인됐다.

### 검증 결과 (실제 DB 기준, 2026-05-04)

| # | 이슈 | 검증 결과 | 심각도 |
|---|---|---|---|
| 1 | `turn_id` 채번 충돌 (`COUNT(*) + 1` 방식의 레이스) | 미발생 (38/38 1:1) | 이론만 |
| 2 | `turn_id IS NULL`인 tool_call/response | **88건 (전체 4.7%)** — 한 세션에 집중. 모두 첫 prompt 등록 이전 시각. | 중 |
| 3 | response 0개인 turn (Stop의 last_assistant_message 누락) | 3건 — 정상 tool-only 2건 + 완전 공 1건 | 낮음 |
| 4 | 서브에이전트 자식 행 무결성 (`parent_tool_use_id` 매핑) | 정상 (11건 모두 매핑) | - |
| 5 | proxy ↔ hook fallback 30초 윈도우 부족 | **30초 초과 proxy 응답 100건** — 평균 60.7s, 최대 223.7s | **높음** |

#1, #3, #4는 운영 영향 미미(또는 정상)로 확인됐다. 본 ADR은 #5(P0)와 #2(P1)에 한정한다.

### 이슈 #5 — 추가 발견: session_id 필터 누락

`storage/queries/proxy.ts:285-295`의 `SQL_LATEST_RESPONSE_PREVIEW_BEFORE`에는 `session_id` 필터가 없다. 한편 같은 파일의 다른 cross-link 쿼리(`events.ts:194-199`의 `api_request_id` 매칭)는 명시적으로 session_id로 필터한다 — 즉 fallback 함수의 미필터는 누락된 제약이다. 윈도우만 확대하면 다른 세션의 proxy 응답을 잘못 매칭할 위험이 새로 생긴다.

## Decision

### P0 — 이번 워크트리에서 즉시 적용 (이슈 #5)

1. `getLatestProxyResponseBefore`의 시그니처에 **`sessionId: string` 필수 파라미터 추가**.
2. 쿼리에 `AND session_id = ?` 조건 추가.
3. 기본 윈도우 `30_000` → **`120_000`** 으로 확대.
4. `events.ts`에서 호출 시 `payload.session_id` 전달.

윈도우 120초의 근거: 운영 데이터 평균 60.7s, 최대 223.7s. 95%ile은 추정 ~120s. 100% cover는 못 하지만 30초 대비 실 누락 비율이 한 자릿수로 떨어질 것으로 예상.

### P1 — 후속 작업 진행 결과

#### P1-A: 응답 행 중복 + turn 잘못 태깅 — 완료

운영 데이터에서 같은 어시스턴트 메시지가 두 행으로 저장되고, 그 중 하나는 다음 turn에 잘못 태깅되는 회귀가 추가로 확인되었다. 원인:

- Stop 훅 `saveAssistantResponse`가 `resp-${ts}-${uuid}` ID로 INSERT.
- PostToolUse 시 transcript 백필이 `resp-msg-${messageId}` ID로 INSERT.
- 두 경로의 ID 스킴이 달라 INSERT OR IGNORE 멱등성이 작동하지 않음.
- transcript 백필이 entry의 자체 timestamp를 무시하고 `getLastTurnId`만 사용해, turn 종료 후 다음 turn의 PostToolUse가 발생하면 이전 turn의 마지막 메시지가 새 turn에 잘못 부착됨.

수정:
- `getTurnIdAt(db, sessionId, beforeMs)` 신설 — 메시지 시각 기준 turn_id 결정.
- `persistAssistantTextResponses`가 entry별로 `getTurnIdAt`을 호출하도록 변경.
- `saveAssistantResponse`가 transcript 백필을 먼저 실행하고, 마지막 메시지가 백필 행으로 이미 저장됐으면 자체 INSERT를 생략. 백필 행이 토큰/모델 메타를 더 정확히 보유하므로 SSoT로 채택.
- Stop 자체 INSERT 경로의 turn_id도 `getTurnIdAt(timestamp)`을 우선 적용하도록 변경.

상세 구현: `packages/server/src/hook/turn.ts`, `packages/server/src/hook/persist.ts`, `packages/server/src/events.ts` 참조.

#### P1-B: 일부 도구의 펼침 텍스트가 행 미리보기와 동일 — 완료

`TaskCreate`, `TaskUpdate`, `SendMessage`, `WebFetch`, `WebSearch` 등은 서버에서 `tool_detail`로 짧은 요약 한 줄만 저장된다. 클라이언트의 `getDetailText`가 이들에 대한 별도 핸들러 없이 `r.tool_detail`로 폴백해, 행 클릭 시 펼침 박스가 미리보기와 동일한 텍스트만 노출했다.

수정: `packages/web/assets/js/render/extract.js`의 `getDetailText`에 위 도구별 핸들러 추가 — `payload.tool_input`의 풍부한 필드(description, message, prompt 등)를 합쳐서 보여줌.

#### P1-C: orphan UI 노출 (session-prologue) — 완료

`turn_id IS NULL`인 행을 `getOrphanRowsBySession`으로 조회해 turns API 응답에 `prologue` 필드로 별도 노출. turn-view 상단에 "세션 프롤로그" 카드를 그려 prompt 등록 이전 활동을 시각적으로 보존. 빈 배열이면 카드 미렌더 (일반 세션은 노이즈 없음). 사용자가 정의한 "사용자 프롬프트 = 턴" 원칙은 그대로 유지.

상세 구현: `packages/storage/src/queries/request/turn.ts (getOrphanRowsBySession)`, `packages/server/src/routes/sessions.ts`, `packages/web/assets/js/session-detail/{turn-views,index,state}.js`, `packages/web/assets/css/turn-view.css` 참조.

#### P1-D: 무결성 모니터링 + 데이터 정합성 자동 보정 — 완료

`bun run packages/server/src/cli.ts doctor`에 5개 무결성 체크 추가:

1. orphan 행 (turn_id NULL) 카운트 — warn
2. response 0개 turn 카운트 — warn
3. 120s 초과 proxy 응답 카운트 — warn
4. 중복 response 행 쌍 (preview 동일 + 1초 이내) — fail
5. mismatched turn_id (timestamp 기준 prompt와 불일치) — fail

`doctor --fix`에서 4·5번을 자동 보정:
- 중복 response: claude-code-hook 행 삭제 + transcript-assistant-text 행 보존 (후자가 토큰·모델 메타 더 정확).
- mismatched turn_id: 자기 timestamp 이전의 가장 최근 prompt turn_id로 UPDATE.

운영 데이터(481MB DB) 적용 결과: 중복 29쌍 제거, mismatched 75건 교정. 신규 데이터는 코드 수정으로 발생 차단.

상세 구현: `packages/server/src/cli/checks/integrity.ts`, `packages/server/src/cli/fix.ts`, `packages/server/src/cli/doctor.ts` 참조.

#### P1-E: api_request_id 기반 정확 매칭 — 완료 (v23 schema 변경)

**재합의 배경.** 디버그 로그(SPYGLASS_DIAG_ENABLED=1)로 운영 페이로드를 직접 분석한 결과, hook payload에는 `tool_use_id`가, proxy SSE에는 `content_block_start` 이벤트의 `tool_use` 블록 안에 같은 `id`가 포함됨을 확인. 두 경로가 동일 ID를 공유하므로, 별도 매핑 테이블 하나만 추가하면 시간 윈도우 의존을 완전히 제거할 수 있다. 초기에 ROI 낮다고 판단했던 결론을 뒤집고 진행.

**스키마 변경 (v23 migration):** `proxy_tool_uses(tool_use_id PK, api_request_id, tool_name, block_index, created_at)` 신설. proxy 응답 종료 시 SSE에서 캡처한 tool_use 블록을 일괄 INSERT. hook PostToolUse 시점에 `tool_use_id`로 PK 조회하여 정확한 `api_request_id`를 즉시 채움.

**Stop 훅 처리 갱신.** 기존 `events.ts:197-202`의 시간 기반 cross-link도 transcript 마지막 entry의 `message_id`(=Anthropic의 api_request_id 그 자체)로 직접 채우도록 수정. 미스 시 기존 시간 기반으로 폴백하여 v23 이전 데이터 호환.

**상세 구현:**
- `packages/storage/migrations/023-proxy-tool-uses.sql`
- `packages/storage/src/queries/proxy.ts` — `persistProxyToolUses`, `getProxyToolUseById`, `getProxyResponseByApiRequestId`
- `packages/server/src/proxy/sse-state.ts` — `content_block_start`의 tool_use 캡처
- `packages/server/src/proxy/handler/non-stream.ts` — JSON 응답 분기에서도 동일 캡처
- `packages/server/src/proxy/handler/persist.ts` — 트랜잭션 안에서 `persistProxyToolUses` 호출
- `packages/server/src/hook/persist.ts` — `resolveApiRequestId`로 PostToolUse 시점에 정확한 api_request_id 채움 (UPDATE/INSERT 양쪽)
- `packages/server/src/events.ts` — Stop 훅에서 transcript 마지막 msg_id를 직접 사용
- `packages/server/src/cli/checks/integrity.ts` — 신규 체크 2개: `checkUnlinkedToolCalls`(매칭률 모니터), `checkOrphanProxyToolUses`(정보성)

**효과.** 시간 윈도우 의존이 hook ↔ proxy cross-link 경로에서 0초로 사라짐. 224초+ 응답도 정확 매칭. v23 이전 데이터는 fallback 경로로 그대로 처리(호환).

#### P1-E polish: backfill·subagent에도 정확 매칭 일관 적용

재시작 후 신규 데이터 검증(매칭 1/1) 결과 추가 다관점 회의에서 도출된 미세 개선 2건:

- `persistAssistantTextResponses`의 INSERT가 `api_request_id`를 hard-coded NULL로 보내던 문제. id 컬럼은 이미 `resp-msg-${entry.messageId}` 패턴으로 msg_id를 포함하지만, 컬럼을 채워두면 응답 행 단독 SELECT만으로 cross-link이 즉시 가능. `entry.messageId`를 그대로 `api_request_id`에 INSERT.
- `persistSubagentChildren`도 자식 도구의 `tool_use_id`가 부모 Agent 응답에서 발행된 ID이므로, 같은 `resolveApiRequestId` 패턴으로 proxy_tool_uses에서 직접 매칭 가능. 미스 시 NULL 유지(fallback).

### 채택하지 않는 옵션

- "윈도우만 확대 (session_id 필터 없이)": 다른 세션 응답을 잘못 매칭할 가능성으로 기각.
- "이슈 #2를 prompt 도착 시 backfill": hook 순서 통제가 어려워 일관된 backfill 시점이 불명확. P1로 분리해 더 면밀한 설계 필요.

## Consequences

### 긍정

- 평균 60s 응답에서도 토큰/모델 메타가 보존되어 비용/속도 메트릭 신뢰도 상승.
- session_id 필터로 cross-session 오매칭 가능성 제거.

### 주의

- 윈도우 120초 내에 같은 세션에서 여러 LLM 호출이 있을 경우 가장 최근 것이 채택됨 — 기존 `LIMIT 1 ORDER BY timestamp DESC` 동작과 동일.
- 223초 응답은 여전히 누락 가능. P1의 api_request_id 매칭에서 해결.

### 모니터링 (운영)

P1-D에서 `doctor` CLI에 5개 무결성 체크가 자동 등록됨. 상세 쿼리는 `packages/server/src/cli/checks/integrity.ts` 참조. `doctor --fix`로 중복 response·mismatched turn_id 자동 보정.
```

## Implementation

- 변경 파일:
  - `packages/storage/src/queries/proxy.ts` (시그니처·쿼리 수정)
  - `packages/server/src/events.ts` (호출자 인자 추가)
- 테스트: 기존 단위 테스트 회귀 확인. 새 케이스 추가는 P1 작업에서.
