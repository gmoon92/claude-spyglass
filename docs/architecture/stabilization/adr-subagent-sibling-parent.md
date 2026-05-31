# ADR — 동일 타입 형제 서브에이전트 자식 부모 오귀속 교정 (G5)

- **상태(Status)**: Accepted (구현 완료, 머지 대기 — 마지막 세션/메인 위임)
- **브랜치(Branch)**: `fix/subagent-sibling-parent` (워크트리 `../claude-spyglass-fix`)
- **범위(Scope)**: `packages/server/src/hook/persist.ts` (적재-코드 only, 마이그레이션 없음)
- **원칙(Principle)**: 서브에이전트 자식의 부모는 **그 인스턴스 sub-transcript** 가 ground truth. 라이브 훅 추측보다 transcript 파생값을 권위로 삼아 수렴시킨다.

## 배경 / 문제

같은 turn 에 동일 타입 서브에이전트(예: Explore 2개)가 있으면, 나중 에이전트(B)의 내부 도구 자식이 **먼저 끝난 형제(A)** 로 오귀속된다. 라이브 검증(세션 `19219e32`)에서 S5 Explore 의 `find .../.claude/agents` 호출이 S2 Explore 로 귀속 → 한 에이전트 자식 0, 다른 에이전트는 안 한 작업까지 집계. parent 가 NULL 이 아닌 **틀린 값**이라 기존 백필이 교정하지 못함. orchestration DAG·에이전트 깊이·flow graph 조상 분석을 오염시켜 "서브에이전트 가시성" 가치를 훼손.

## 확정 사실 (file:line 근거)

| # | 사실 | 근거 |
|---|------|------|
| 1 | 서브에이전트 내부 도구는 메인 훅(`source='claude-code-hook'`)으로 도착하나 payload 에 `parent_tool_use_id` 없음 | `packages/server/src/hook/persist.ts:340-353` (주석) |
| 2 | 라이브 rolling-parent 2순위 Agent 매칭이 `tool_detail=agent_type` + `ORDER BY timestamp DESC LIMIT 1` + `event_type IN (NULL,'tool')` → 자식 도착 시 미완(`pre_tool`)인 B 제외, 완료된 A 선택 | `packages/server/src/hook/persist.ts:255-268` |
| 3 | 기존 행 백필이 `parent NULL/empty` 일 때만 동작 → 틀린 non-NULL 영구 잔존 | `persist.ts` `persistSubagentChildren` (수정 전 `isEmpty` 분기) |
| 4 | `persistSubagentChildren` 는 그 Agent 인스턴스의 sub-transcript 자식 + 정확한 `context.parentToolUseId(=raw.tool_use_id)` 로 호출됨 | 호출부 `packages/server/src/hook/handlers/post-tool-use.handler.ts:143-147` |
| 5 | `agent_id` 는 인스턴스 고유이나 transcript 에는 부재 → 권위 근거는 transcript 멤버십 + context | `packages/server/src/hook/types.ts` (NormalizedHookPayload.agent_id / SubagentChildToolCall) |

## 결정 (Decision)

`persistSubagentChildren` 의 기존-행 처리 조건을 **NULL 전용 백필 → 권위적 교정**으로 확장한다.

```
- const isEmpty = !existingParent || existingParent === '';
- if (isEmpty && resolvedParentToolUseId) {
+ if (resolvedParentToolUseId && existingParent !== resolvedParentToolUseId) {
```

`resolvedParentToolUseId = child.parentToolUseId ?? context.parentToolUseId` (transcript 파생). 기존 parent 가 이와 다르면(NULL 이든 틀린 형제 Agent 든) 권위값으로 UPDATE + `kuzu_outbox(op='update')` 발행. 같으면 no-op(멱등). 깊이3 Skill/Task 정상 케이스는 `resolved == existing` 이라 불변 → 보존.

## 대안 (검토)

- **T4 — saveRequest 모호 시 추측 보류(채택 안 함/보류)**: 동일 타입 Agent 2개 이상이면 라이브 추측을 보류(NULL)해 일시적 오엣지/그래프 churn 감소. 그러나 correctness 를 더하지 않고(권위 백필이 어차피 수렴), 최고빈도 write 경로에 count 쿼리+분기를 추가해 회귀 표면을 넓힘 → over-engineering. churn 텔레메트리로 flicker 비용 확인 시 후속.
- **마이그레이션 백필(채택 안 함)**: 과거 non-NULL 오귀속 행은 인스턴스 정보가 DB 에 없어 SQL 로 안전 교정 불가. (NULL 잔존은 기존 052 류가 담당.)

## 한계 / 후속

- 과거 누적 오귀속(non-NULL)은 본 변경으로 소급 교정되지 않음 — transcript 재파싱 백필(`scripts/backfill-subagent-parents.ts` 재실행) 검토를 백로그로 남김.
- 라이브 재현 0 검증은 **패치 빌드로 서버 기동** 후 가능(머지 세션 권장).

## 검증 결과

- 신규 회귀 `packages/server/src/hook/__tests__/subagent-sibling-parent.regression.test.ts`: Red 3 fail → Green **5 pass**.
- `bun test packages/server`: **233 pass / 0 fail / 666 expect (30 files)**.
- `bun run typecheck`: 12 errors = baseline 동일(persist.ts/신규 테스트 신규 0) → 회귀 0.
