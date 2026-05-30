# ADR — R9: 단일 인스턴스 → 팀 공유 / HA (Deferred Epic)

- 상태: **Deferred (단계적 설계 기록, 단일 세션 구현 부적합) — 전문가 검토 사실정정 반영 2026-05-31**
- 우선순위: **P3** (대형 별도 과제)
- 원칙: 사실 주장에 `파일:라인` 근거(doc-source-ref). 현 시점 구현 변경 없음 — 미래 착수 시 출발점 설계.

## 컨텍스트 (현재 = 의도된 단일 인스턴스)

claude-spyglass는 **호스트당 단일 사용자·단일 인스턴스 로컬 도구**로 설계됐다. 이는 결함이 아니라
정체성(buildless·zero-config·loopback)의 일부다.

**정정(전문가 검토)**: 경로·포트·홈은 이미 env 로 파라미터화돼 있다 — "홈 고정/하드코딩"이 아니다.
단일성을 만드는 본질은 경로가 아니라 **데이터 동시성 모델(SQLite WAL 단일 writer)** + 식별 SSoT.

| 차원 | 현재 동작 | 근거 |
|------|-----------|------|
| RDB 경로 | 기본 `~/.spyglass/spyglass.db`, **`SPYGLASS_DB_PATH` env / `dbPath` 옵션으로 override 가능** | `connection.ts:18,29`, `config.ts:36` |
| 그래프 홈 | 기본 `~/.spyglass`, **`SPYGLASS_HOME` env 로 재배치 가능** | `paths.ts:20,63-64`, 파일명 상수 `:31-33` |
| 포트/호스트 | 기본 9999/127.0.0.1, **`SPYGLASS_PORT`·`SPYGLASS_HOST` env 가변** | `config.ts:32,35` |
| 데몬 식별 | PID 파일(`SPYGLASS_PID_FILE` 가변) + **포트 LISTEN 이 식별 SSoT** → 호스트·포트당 1 인스턴스 | `daemon.ts:28,57,152-156` |
| 훅 fan-out | `${SPYGLASS_HOST:-localhost}:${SPYGLASS_PORT:-9999}` — env 가변, 단 **단일 엔드포인트(fan-out 라우팅 부재)** | `hooks/spyglass-collect.sh:18-19` |
| 쓰기 모델 | **SQLite WAL 단일 writer**(본질적 단일성) + loopback 바인딩 기본 | `schema.ts:73-84`, `config.ts:35,39` |

**강제 다중 인스턴스 위험**: 같은 DB 파일을 다중 프로세스가 열면 WAL 단일 writer 가정 위반 +
sync cursor 경쟁 → cursor/WAL 손상. **이것이 단일성의 진짜 근원이며, 경로 env 가변과 무관하다.**

## R9 를 트리거하는 요구 (현재 미존재)

- 팀이 한 대시보드에서 여러 개발자의 세션을 공유.
- 다중 호스트의 hook/proxy 데이터를 중앙 수집.
- 고가용성(데몬 다운 시 failover).

이 중 어느 것도 현재 제품 요구로 존재하지 않는다. R9 는 "요구가 생기면" 착수할 에픽이다.

## 설계 옵션 (미래 착수 시)

### 옵션 A — 서버형 DB 전환 (SQLite → PostgreSQL)
- connection/queries 계층을 SQL 방언 추상화 뒤로 + 다중 writer 동시성(트랜잭션/락)으로 전환.
- sync worker 의 cursor·outbox 를 다중 인스턴스 안전하게(행 잠금/SKIP LOCKED) 재설계.
- 장점: 표준 HA(복제·failover) 경로. 단점: zero-config·buildless 정체성 상실(외부 DB 운영), 전 계층 영향.

- **마이그레이션 비대칭(A의 핵심 비용)**: SQLite→Postgres 는 스키마 + BLOB(zstd payload `schema.ts:80-81`) 이관 + **R3 암호화 컬럼 재암호화**가 동반 — 일회성 비용이 옵션 B보다 현저히 크다. 이 비대칭이 A vs B 선택의 핵심 입력.

### 옵션 B — 중앙 daemon + thin remote client
- 단일 중앙 데몬이 DB 소유, 다른 호스트는 hook/proxy 데이터를 네트워크로 전송(현 loopback → 인증된 원격 엔드포인트).
- 클라이언트(웹/TUI)는 중앙 데몬 API 소비.
- 장점: SQLite·단일 writer 유지(중앙 1개). 단점: 인증/전송 보안(현 loopback 무인증, §N4)·네트워크 신뢰경계 신규 도입, 데몬이 SPOF(HA 아님, 공유만).
- **단일 writer 처리량 상한**: 다중 호스트가 중앙 1 writer 로 수렴 → 팀 규모 확장 시 B 가 다시 A 로 떠밀리는 구조적 압력(C 단계화가 이를 흡수).
- **R3 키 ↔ §N4 전송 충돌**: R3 는 KDF 없는 고엔트로피 단일 키(`adr-r3-at-rest-encryption.md:48`). B 에서 중앙 데몬만 키를 갖고 클라이언트가 평문 전송하면 R3 위협모델("DB 단독 유출")과 §N4(전송 무인증)가 충돌 — 원격 전송 암호화/인증이 선결.

### 옵션 C — 하이브리드(B → A 단계화)
- 1단계: 경로/포트 env 파라미터화(낮은 위험, 단일성 유지) — 이미 일부 가능 여부 점검.
- 2단계: 옵션 B(중앙 데몬 + 원격 수집 + 인증).
- 3단계: 수요가 HA 로 확대되면 옵션 A(서버 DB).

## 결정 — Deferred (구현 보류, 설계만 기록)

- **단일 세션 자율 구현 부적합**: 전 계층(connection/paths/daemon/worker/hooks/보안) 변경 + 제품·운영 결정 동반 → 회귀 위험 높음(P3, 매우 큼).
- **over-engineering 가드**: 현재 단일사용자 수요만 존재. HA/팀공유를 선제 구축하면 정체성(buildless·zero-config·loopback)을 해치는 과잉.
- **선결 조건(착수 전 확정)**: 옵션 B 채택 시 §N4(로컬 API 인증 부재 — `routes/*` 미들웨어 grep 0건 확인)와 R3 at-rest 암호화의 키 공유 모델이 신뢰경계 재설계의 입력이 된다.
- **저위험 준비 작업 — 이미 완료(전문가 검토)**: 경로/포트/홈 env 파라미터화(`SPYGLASS_DB_PATH`·`SPYGLASS_HOME`·`SPYGLASS_PORT`·`SPYGLASS_PID_FILE`·`SPYGLASS_ENCRYPTION_KEY`)는 **이미 전부 구현돼 있다**. 옵션 C 1단계는 신규 실행 항목 없음. 남은 본질 작업은 **데이터 동시성 모델 전환**(WAL 단일 writer 탈피)이며 이는 P3 에픽 본체다. → YAGNI: 현 요구 부재 시 추가 코드 변경 없음.

## 미해소 항목 (착수 시 전문가 회의 입력)

- 옵션 A vs B 중 제품 방향(HA 필요 여부 vs 공유만).
- 다중 writer 동시성 모델(Postgres) 또는 원격 수집 인증/전송 보안(중앙 데몬).
- 마이그레이션 경로: 기존 `~/.spyglass` 단일 인스턴스 데이터 이전.
- hook fan-out 다중 엔드포인트 라우팅(`spyglass-collect.sh`).
