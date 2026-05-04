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

#### P1 — 잔여 항목 (이번 워크트리 미포함)

- **이슈 #2 (orphan UI)**: `turn_id NULL` 행을 "session-prologue"로 명시 분류 + turn-view UI 노출. 한 세션(88건)에 집중되어 있고 P1-A로 신규 발생을 차단했지만, 과거 데이터의 시각화는 별도 작업.
- **api_request_id 기반 정확 매칭**: 시간 윈도우 의존을 점진적으로 제거. hook 페이로드에 api_request_id가 들어오는지부터 조사 필요.
- **모니터링 메트릭 자동 노출**: 위 모니터링 쿼리들을 `/api/integrity` 같은 엔드포인트에 노출.

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

다음 쿼리로 정기 점검 권장 (이번 변경에 코드 추가는 안 함, 운영자가 수동 확인):

```sql
-- orphan 행 (이슈 #2)
SELECT COUNT(*) FROM requests WHERE turn_id IS NULL;

-- response 0개 turn (이슈 #3)
SELECT p.turn_id FROM requests p
LEFT JOIN requests r ON r.turn_id=p.turn_id AND r.type='response'
WHERE p.type='prompt' GROUP BY p.turn_id HAVING COUNT(r.id)=0;

-- 30초 초과 proxy 응답 (이슈 #5 잔여 위험)
SELECT COUNT(*) FROM proxy_requests WHERE response_time_ms > 120000;
```

## Implementation

- 변경 파일:
  - `packages/storage/src/queries/proxy.ts` (시그니처·쿼리 수정)
  - `packages/server/src/events.ts` (호출자 인자 추가)
- 테스트: 기존 단위 테스트 회귀 확인. 새 케이스 추가는 P1 작업에서.
