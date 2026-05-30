# 잔여 안정화 작업 최종 보고 (R6 · R7 · R9)

- 일자: 2026-05-31
- 범위: R1·R2·R4·R5·R8(선행 세션) + R3·R10(at-rest 암호화 세션) **이후 남은** P2/P3 잔여 항목 — R7·R6·R9.
- 방식: 항목별 ADR 작성 → 서브에이전트 전문가 회의(소스 직접 검증) → 권장사항 반영 → TDD/엣지 테스트 → 회귀 0 확인.
- 원칙: 모든 사실에 `파일:라인` 근거(doc-source-ref), 모든 소스 수정에 테스트 동반, 모호/최종 결정은 ADR 로 문서화.

## 결과 요약

| 항목 | 분류 | 결과 | 산출물 |
|------|------|------|--------|
| **R7** 그래프 batch atomicity (lost-edge) | 데이터 정합성 P2 | ✅ **해결** | enrich 양방향 PARENT_OF 발행 + 엣지 테스트 7건. `adr-r7-graph-batch-atomicity.md` |
| **R6** 멀티플랫폼 릴리스 | 배포 P2 | ✅ **구현 완료(선행 `0107ce7`) + 검증** | 크로스컴파일 smoke 통과. 잔여: 태그 push OS-runner 검증(로컬 불가) |
| **R9** 단일 인스턴스 → HA | 아키텍처 P3 | ⏸️ **Deferred(설계 ADR)** | `adr-r9-team-sharing-ha.md`. 단일 세션 구현 부적합 — over-engineering 가드 |

검증: 전체 **1150 pass / 0 fail**(103 파일), 루트 typecheck **12**(사전 베이스라인 불변, 신규 0건).

## R7 — 그래프 lost-edge (양방향 PARENT_OF 발행)

**전문가 회의(3렌즈) 핵심 발견**:
- dangling-node(엣지 op 실제 throw)는 worker 재시도(idempotent)+dead+resurrect 로 복구되나, **lost-edge**(끝 노드 부재 → `mergeRel` MATCH 0 → CREATE no-op, 에러 아님)는 **silent success** 라 모든 복구 벡터를 우회하는 영구 유실.
- cross-row 유실 표면 = **PARENT_OF + CONTAINS** 2종(ADR 최초 식별은 PARENT_OF 뿐).
- agent flow 에서 **상시 발생**: 부모 Agent ToolCall 노드는 PostToolUse 재enrich 시 생성 → sub-agent 자식 활동 이후 → 자식 측 PARENT_OF 가 부모 부재로 유실.
- **랜드마인(실측)**: missing-endpoint 를 throw 로 승격하면 worker `anySuccess`(행 단위) 분류상 단독 실패 행이 Phase 2a(systemic) → cursor 동결·회로 = **그래프 sync 정지**. + pre_tool 영구부재 부모는 정상인데 dead-letter.

**결정**: throw 없는 **enrich 양방향 발행** — 부모 ToolCall enrich 가 기존 자식들의 PARENT_OF(parent→child)도 발행. child-side 와 합쳐 순서 무관 최종 일관성(C→P 순서면 부모 재enrich 가 엣지 생성). 전부 idempotent MERGE → 중복 무해, **throw 0 → Phase 2a/dead-letter 위험 0**. 영구부재(pre_tool) 부모는 phantom 없이 엣지 없음(정확).
- 기각: A(Ladybug 실 트랜잭션 — native segfault 위험), B-throw(sync-halt 위험), C(엣지 재발행 큐 — outbox 재시도 인프라 중복).
- 소스: `packages/storage-graph/src/sync/enrich.ts`(parent-side). 테스트: `parent-of-recovery.test.ts`(enrich 레벨 6 + worker tick 통합 1).

## R6 — 멀티플랫폼 릴리스

- 구현은 선행 커밋 `0107ce7`로 완료: `release.yml` 5-타겟 matrix(darwin arm64/x64, linux x64/arm64, win x64), `build-release-tarball.sh --os/--arch`(codesign darwin 전용, windows .zip), Formula 4플랫폼 + homebrew 단일 bump 한계 문서화.
- **본 세션 검증**: darwin 호스트에서 linux-x64 크로스컴파일 → 유효한 **ELF 64-bit x86-64** 바이너리 + tar.gz + sha256 생성 확인.
- **잔여(범위 밖)**: 5개 OS runner 실제 빌드·install smoke 는 태그 push 에서만 검증 가능. brew 채널은 `SPYGLASS_GRAPH_MODE=off`(Formula)로 graph-native 미동봉 안전(§N3). 비-brew tarball 은 graph-native 부재 시 graceful degrade.

## R9 — 팀 공유 / HA (Deferred)

- **Deferred 결정 정당**(전문가 검토): 현재 단일사용자 로컬 도구 수요만 존재 → HA/팀공유 선제 구축은 정체성(buildless·zero-config·loopback) 훼손 over-engineering. 전 계층 변경 + 제품 결정 동반 P3 에픽 → 단일 세션 부적합.
- **사실 정정**: 경로/포트/홈/키는 이미 env 파라미터화 완료(`SPYGLASS_DB_PATH`·`SPYGLASS_HOME`·`SPYGLASS_PORT`·`SPYGLASS_ENCRYPTION_KEY` 등) — 단일성의 본질은 경로가 아니라 **SQLite WAL 단일 writer**. 옵션 C 1단계(env 파라미터화)는 이미 끝나 신규 작업 없음(YAGNI).
- 설계 옵션(A Postgres / B 중앙데몬+원격 / C 단계화)과 트레이드오프(마이그레이션 비대칭, 단일 writer 처리량 상한, R3 키↔§N4 전송 충돌)를 `adr-r9-team-sharing-ha.md`에 기록 — 미래 착수 출발점.

## 최종 상태 — 잔여 P0~P2 실행 항목 없음

R1·R2·R3·R4·R5·R8·R10 해결, R6 구현 완료(태그검증 대기), R7 해결. **R9 만 의도된 deferred epic**으로 남으며, R7 보류 시 거론됐던 atomicity 는 lost-edge 해소로 실질 완화 + 한계 문서화 완료. 추가 즉시 실행 잔여 없음.
