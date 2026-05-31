# 핸드오프 — G5 서브에이전트 부모 오귀속 수정 (머지 위임)

> 대상: 최종 머지를 담당할 마지막 세션/메인. 이 문서만으로 머지·검증 가능하도록 작성.

## 브랜치 / 워크트리
- 브랜치: `fix/subagent-sibling-parent` (베이스 main `e1f8266`)
- 워크트리 루트는 머지 담당자의 로컬 체크아웃 경로(머신별 상이 — 절대경로 미기재).
- 기존 3 워크트리(main / `feat/distribution-brew` / `feat/react-migration`)와 독립.

## 변경 요지
- **핵심(1라인)**: `packages/server/src/hook/persist.ts` `persistSubagentChildren` — 기존 행 처리 조건을 `NULL일 때만 백필` → `resolved와 다르면 교정`.
  - `if (resolvedParentToolUseId && existingParent !== resolvedParentToolUseId)` + 기존 `kuzu_outbox(op='update')` 발행 재사용.
  - `resolvedParentToolUseId = child.parentToolUseId ?? context.parentToolUseId` (그 Agent 인스턴스 transcript 기반 ground truth).
- **신규 테스트**: `packages/server/src/hook/__tests__/subagent-sibling-parent.regression.test.ts` (메인 1 + 무회귀 4: 단일/깊이3 Skill 보존/NULL 백필/멱등).
- **그래프 완결 보완(`ff23519`)**: `packages/storage-graph/src/sync/merge.ts` `mergeRel`이 `PARENT_OF(parent→child)` CREATE 전 같은 child의 *다른* 부모 PARENT_OF 엣지를 DELETE(single-parent 불변식). 교정 시 구 엣지 잔존을 self-healing·idempotent로 제거. best-effort라 DLQ/HoL 무영향.
- **Prevention 가드(`cfd7d07`)**: `persist.ts` 라이브 rolling-parent에서 같은 (session,turn)에 동일 `tool_detail` Agent 인스턴스 2+면 추측 보류(NULL)→권위 백필 위임. 틀린 parent를 *애초에 안 씀* → 그래프 stale 엣지 생성도 방지.
- **Transcript 권위 마이그레이션(`bc83c41`)**: `packages/server/scripts/backfill-subagent-parents.ts`를 SQL 휴리스틱 → `agent_id`-scoped sub-transcript 재파싱으로 격상. 과거 NULL+오귀속 행을 권위값으로 교정, 누락 transcript graceful skip, `--dry-run`/`--limit`, idempotent. **라이브 DB 실행은 배포 단계로 분리(코드만).**
- 마이그레이션(.sql) 신규 없음. T4(saveRequest 별도 방어)는 prevention 가드로 흡수.

## 검증 결과 (전체)
- `bun test packages/server packages/storage-graph`: **387 pass / 0 fail (47 files, 1411 expect)** — 기존 parent-of-recovery·dangling-node 포함 회귀 0.
- 신규 테스트: hook 회귀(10) + prevention 가드(7) + graph 교정(6) + migration(7) — 전부 합성/마스킹(실 경로·세션UUID·장문 toolu·프롬프트 0).
- `bun run typecheck`: 12 errors = main baseline 동일(신규 파일 오류 0) → **회귀 0**.

## 머지 전 재현 체크리스트
1. 워크트리 루트에서 `bun install`(필요 시) → `bun test packages/server packages/storage-graph` green 확인.
2. `bun run typecheck` 가 main 과 동일 12개인지(신규 0) 확인.
3. main 머지 후 충돌 없는지(persist.ts 는 다른 워크트리 미수정 파일).

## 라이브 재현 0 검증 (권장, 패치 빌드 필요)
1. 이 브랜치로 SG 서버 재기동(라이브 훅이 패치 코드 사용).
2. 한 세션에서 동일 타입 서브에이전트(예: Explore) 2개를 같은 turn 에 연속 호출, 각자 내부 도구 1회 이상.
3. `~/.spyglass/spyglass.db`:
   ```sql
   SELECT tool_detail, tool_use_id, parent_tool_use_id, agent_type
   FROM requests WHERE session_id LIKE '<new>%' AND (tool_name='Agent' OR agent_type IS NOT NULL)
   ORDER BY timestamp;
   ```
   → 두 번째 에이전트 자식의 `parent_tool_use_id` 가 **두 번째 Agent 의 tool_use_id** 인지(첫 번째로 새지 않는지) 확인.

## 잔여 / 백로그
- 과거 누적 non-NULL 오귀속 소급 교정: `scripts/backfill-subagent-parents.ts` transcript 재파싱 재실행 검토.
- T4(라이브 추측 보류)는 그래프 flicker 텔레메트리 확인 후 재검토.
