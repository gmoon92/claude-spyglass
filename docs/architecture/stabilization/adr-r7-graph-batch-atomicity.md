# ADR — R7: 그래프 batch atomicity / dangling-node·lost-edge

- 상태: **Accepted (전문가 회의 3렌즈 반영, 2026-05-31)**
- 브랜치: `residual-r6-r7-r9`
- 범위: `packages/storage-graph/src/{client.ts, sync/merge.ts, sync/enrich.ts, sync/worker.ts}`
- 원칙: 사실 주장에 `파일:라인` 근거(doc-source-ref). 회귀 0. 모든 소스 수정에 엣지 테스트 동반.

## 컨텍스트 (위협/결함 모델)

SQLite(SoT) → outbox → sync worker → Ladybug 그래프(투영) 파이프라인에서 batch 중간 실패 시
롤백이 없어 부분 적용이 잔존한다. 두 결함:
1. **dangling-node**: 노드는 적재됐는데 엣지 op가 실패 → 엣지 없는 노드 잔존(재시도/dead 의존).
2. **lost-edge(신규 식별)**: 엣지의 끝 노드가 *다른 outbox row* 소관이라 아직 미적재면 `mergeRel`의
   MATCH가 0건 → CREATE가 조용히 no-op → 엣지 영구 유실 + 행은 성공 처리되어 재시도조차 없음.

## 확정된 사실 (소스 대조)

| # | 사실 | 근거 |
|---|------|------|
| 1 | `client.transaction()`은 실 트랜잭션 아님 — connHandle.transaction이 함수일 때만 위임, 아니면 `work()` 직접 실행(롤백 없음). Ladybug 0.16.x transaction API 없음(코드 자인) | `client.ts:232-244` |
| 2 | `@ladybugdb/core`는 optional native dep, `await import()` lazy 로드. 미설치 환경에선 graph unavailable 모드 | `client.ts:120` |
| 3 | `mergeOps`는 op 단위 try/catch, 실패만 수집하고 계속 — batch 롤백 없음 | `merge.ts:62-71` |
| 4 | enrich는 한 row 내에서 **노드 op를 rel op보다 먼저** 배열에 넣음 → row 내 노드-우선 순서 보장 | `enrich.ts:264-321` (event→tool_call→PRODUCED→PARENT_OF) |
| 5 | `PARENT_OF` 엣지는 `parent_tool_use_id`로 식별되는 **다른 row 소관 부모 ToolCall**을 from으로 참조 | `enrich.ts:312-320` |
| 6 | `mergeRel`은 MATCH 두 노드 + CREATE + duplicate 흡수. 끝 노드 부재 시 MATCH 0 → CREATE no-op(에러 아님) → 엣지 미생성, 실패로 잡히지 않음 | `merge.ts:196-225` |
| 7 | worker: 실패 row는 attempts++/dead(MAX=5), cursor는 미해결 실패 row 직전 동결(HoL ≤MAX tick), dead row는 통과 | `worker.ts:182-223`, `MAX_OUTBOX_ATTEMPTS=5` |
| 8 | 노드는 PK 기준 idempotent MERGE → 재시도/부분적용 무해(노드 한정) | `merge.ts:23-24`, enrich 주석 |
| 9 | R1 `resurrectDeadLetters`로 dead row 수동 복구 가능(유일 복구 경로) | `worker.ts`(R1), residual §N1 |

## 핵심 질문 (전문가 회의 대상)

- **Q1**: lost-edge(사실 #5·#6) 실제 발생 빈도/조건. PARENT_OF 외 cross-row 끝점을 갖는 rel이 또 있는가? (USES→MetaDocument, NEXT 등 enrich 전수)
- **Q2**: `mergeRel`이 끝 노드 부재를 **retryable 실패로 승격**(throw)해야 하는가? 트레이드오프: 엣지 유실 제거 vs 부모가 영영 안 오는 경우 과도한 dead-letter. 부분 적용(한쪽만) 잔존 가능성?
- **Q3**: dangling-node(사실 #1)는 노드-우선 순서(#4)+idempotent 재시도(#8)로 다음 tick에 자연 복구되는가, 아니면 dead 격리 시 영구 잔존인가? resurrect(#9)로 충분한가?
- **Q4**: "엣지 재발행 큐"(잔여문서 해결방향) vs "mergeRel retryable 승격" vs "현행 유지+문서화" 중 over-engineering 가드 하 최선은? Ladybug 실 트랜잭션 도입은 native segfault 위험(#1·#2)으로 기각이 타당한가?
- **Q5**: 회귀 0 + 결함 재현을 보장할 엣지 테스트 set은? (끝 노드 부재 rel, 부모-자식 cross-row, dead→resurrect 후 엣지 복구)

## 설계 옵션 (검토용)

- **A. 실 트랜잭션**: Ladybug 미지원 + native 회귀 위험 → 기각 후보.
- **B. mergeRel 끝점 검증 + retryable 승격**: 끝 노드 부재 시 throw → 행 재시도(부모 도착까지, MAX 후 dead+resurrect). 저위험·테스트 가능. lost-edge 제거.
- **C. 엣지 재발행 큐**: 실패 엣지를 별도 큐로 분리 재시도. 복잡·native 위험·ROI 낮음.
- **D. 현행 유지 + 안전성 증명 테스트 + 한계 문서화**: node-first + idempotent + resurrect로 실질 완화됐다는 입장.

## 전문가 회의 결론 (3렌즈 수렴 + 정정)

### 정정·신규 발견
- **lost-edge 표면 = 2종**(ADR 사실 #5는 PARENT_OF만 식별): **PARENT_OF**(from=다른 row의 부모 ToolCall, `enrich.ts:312-320`) + **CONTAINS**(from=Session, sessions outbox row 소관, `enrich.ts:374-381`). PRODUCED/USES/CALLED는 같은 row 내 노드-우선이라 안전.
- **dangling-node vs lost-edge 구분**: dangling-node(엣지 op가 *실제 throw*)는 loud-failure라 worker 재시도(idempotent)+dead+resurrect로 복구된다(D 입장 유효). **lost-edge(끝 노드 부재 → `mergeRel` MATCH 0 → CREATE no-op, 에러 아님)는 silent-success**라 `failed`에 안 잡히고 cursor가 전진 → 모든 복구 벡터를 우회하는 **영구 유실**(`merge.ts:218,227`).
- **worker Phase 2a 랜드마인(실측)**: `anySuccess`는 **행 단위**(`worker.ts:189` — rowError===null인 행). 끝점 부재를 throw로 승격하면 그 행은 항상 실패 → 배치에 healthy 행이 없으면 Phase 2a(systemic)로 분류돼 **cursor 동결 + 회로 보고 = 그래프 sync 정지**(`worker.ts:194-198`). 단독 orphan 행에서 실현.
- **PARENT_OF 영구 부재 정상 케이스**: 부모가 `event_type='pre_tool'`로 끝나면 enrich가 빈 배열 → 부모 ToolCall 영구 미생성(`enrich.ts:260-262`). throw 승격 시 정상 데이터가 dead-letter.
- **agent flow 상시 발생**: 부모 Agent ToolCall 노드는 PostToolUse(event_type='tool') 재enrich 시 생성되는데, 이는 sub-agent 자식 활동 **이후**다(`enrich.ts:255-256`). 즉 자식의 child-side PARENT_OF는 부모 노드 생성 전에 실행돼 **상시 유실** → 본 결함은 이론이 아니라 agent 서브트랜스크립트 시각화의 실질 누락.

### 채택 — 양방향 PARENT_OF 발행 (throw 없는 안전 수정)
- `enrichRequest`가 ToolCall(`r.tool_use_id`)을 발행할 때, **이 ToolCall을 parent로 갖는 기존 자식 행들**을 조회해 PARENT_OF(parent→child)도 함께 발행한다. child-side 기존 발행(`enrich.ts:312-320`)과 합쳐 **순서 무관 최종 일관성**: P→C 순서면 child-side가, C→P 순서면 parent-side가 엣지를 만든다(부모 PostToolUse 재enrich 시점에 자식 존재).
- 전부 idempotent MERGE(중복 흡수 `merge.ts:218,227`) → 양측 발행 충돌 없음. **throw 없음 → Phase 2a 위험 0, dead-letter 없음.** 영구 부재(pre_tool) 부모는 phantom 없이 엣지가 자연히 없음(정확).
- worker/client 무변경. enrich에 자식 조회 1쿼리 추가(background tick, hot path 아님).

### 기각
- **A. Ladybug 실 트랜잭션**: 0.16.x 미지원 + native segfault 위험(`client.ts:236-239,120`). 기각.
- **B-throw. mergeRel 끝점 부재 → retryable throw**: Phase 2a sync-halt + pre_tool 영구부재 dead-letter 위험. 기각(양방향 발행이 동일 목표를 무위험 달성).
- **C. 엣지 재발행 큐**: 기존 outbox 재시도 인프라 중복 + 복잡도. 기각.

### CONTAINS(Session) 처리
- Session outbox row는 PK 순서상 같은 세션의 request보다 **항상 선행**(세션 INSERT가 request INSERT보다 먼저) → 정상 운영에서 CONTAINS lost-edge는 발생하지 않음. 사실로 문서화하고 코드 변경 없음. (Session row가 dead 격리된 예외는 R1 resurrect 경로로 회수.)

### 한계 (문서화)
- 부모가 `pre_tool`로 영구 종료된 경우 PARENT_OF는 의도적으로 생성되지 않음(phantom 방지 — 올바른 동작).
- 그래프는 SQLite SoT의 투영(캐시). 본 수정은 silent lost-edge를 제거하나 실 트랜잭션 atomicity는 도입하지 않음(idempotent MERGE 모델 유지).

## 회귀 테스트 (필수, 구현 단계에서 확정)

- 끝 노드 부재 rel 처리(현행 no-op vs 승격 후 retry) 특성/회귀 테스트.
- 부모-자식 cross-row(PARENT_OF) 순서 뒤바뀐 적재 → 최종 일관성 도달.
- dangling-node: 엣지 op 실패 → 다음 tick 재시도로 복구 / dead 후 resurrect로 복구.
- 기존 storage-graph 테스트 전량 통과(회귀 0).
