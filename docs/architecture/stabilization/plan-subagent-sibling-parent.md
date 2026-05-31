# 계획 — 동일 타입 형제 서브에이전트 자식 부모 오귀속(G5) 수정

## 목표
같은 turn 에 동일 타입 서브에이전트가 2개 이상일 때 발생하는 자식 도구 부모 오귀속을 회귀 0 으로 교정한다. TDD(회귀 테스트 우선).

## 비목표
- 최종 머지(마지막 세션/메인 위임).
- 과거 누적 non-NULL 오귀속의 SQL 일괄 교정(인스턴스 정보 부재 — ADR 한계 참조).

## 방법론 / 사용 메타문서 (사용자 노하우)
- 거버넌스: `stabilization-cycle`(단일 약점 G5, 6단계 + over-eng 가드).
- 구현 위임: `safe-delegate` 사전검증 → `backend-agent`(Kent Beck TDD: Red→Green→Refactor + 회귀테스트).
- 커밋: Conventional Commits + Tidy First(fix 와 docs 분리). fix 브랜치에만, 머지 안 함.

## 단계
1. 격리 워크트리 `fix/subagent-sibling-parent` 생성, `bun install`. (완료)
2. [Red] `subagent-sibling-parent.regression.test.ts` 작성 — G5 재현 + 무회귀 4. (완료)
3. [Green] `persist.ts persistSubagentChildren` 권위적 교정(1라인). (완료)
4. [over-eng 게이트] T4(saveRequest 모호 추측 보류) — 보류 결정. (완료)
5. [Verify] `bun test packages/server` 233 pass, `bun run typecheck` baseline 12(신규 0). (완료)
6. 문서(ADR/계획/핸드오프) + fix 브랜치 커밋. 머지 위임. (진행)

## 변경 파일
- `packages/server/src/hook/persist.ts` — `persistSubagentChildren` 백필 조건 확장.
- `packages/server/src/hook/__tests__/subagent-sibling-parent.regression.test.ts` (신규).

## 검증 명령
- `cd ../claude-spyglass-fix && bun test packages/server`
- `bun run typecheck`
- (라이브) 패치 빌드 기동 후 동일 타입 Explore 2개 연속 호출 → `~/.spyglass/spyglass.db` 에서 두 번째 자식 parent = 두 번째 Agent tool_use_id 확인.
