# ADR — Archive/ELK 계층 (로드맵 Phase 5-7)

> 상위: [`storage-evolution-roadmap.md`](./storage-evolution-roadmap.md) §5-7 · 측정: [`storage-profiler-findings.md`](./storage-profiler-findings.md)
> 상태: 승인(2026-07-06, 서브에이전트 2인 설계 회의 종합) · 구현: 단계 1(골격)→2(이주+병합)

## Context

Hot SQLite(`~/.spyglass/spyglass.db`)는 retention 30일 삭제(`queries/session/retention.ts:deleteOldData`) 전까지 무한 성장한다. 로드맵은 Hot(0~N일) + **Warm Archive(N~retention, 날짜단위 압축파일)** + Query Layer(Hot/Archive 투명 병합, UI 무변경)를 도입해 Hot b-tree 압박을 줄인다. CAS(Phase 2/3)·zstd 확대(Phase 4)는 이미 반영됨. 이 ADR은 "틀리면 조용히 결과가 손상되는" 지점(병합 정렬/limit, 집계 재집계, CAS 상호작용, graph 정합)의 결정을 고정한다.

## 결정

### A1. Archive는 삭제 대체가 아니라 "삭제 앞단 이주"
retention 30일 삭제 정책은 불변. Archive는 그 앞의 선택적 중간 계층이며, retention 도달 시 archive 파일 + `archive_index` 행을 함께 삭제한다. 디스크 총량은 기본 불변(retention 연장 아님) — 목적은 Hot SQLite 압박 감소. 삭제 SSoT(`deleteOldData`)를 흔들지 않아 과거 freelist no-op 류 재발을 막는다.

### A2. 이주만 기본 OFF (게이트는 하나, 읽기는 항상 ON)
경계값 N은 로드맵상 프로덕션 실측 증가율로 정해야 하나 16GB 측정이 미완이다. 따라서 **파괴적(DELETE 동반)이고 경계값 미검증인 이주만** 기본 OFF(`SPYGLASS_ARCHIVE_DAYS` 미설정=이주 안 함, `runtime/retention.ts:getRetentionDays` 패턴 미러). archive_index 스키마·읽기 병합은 무해(additive)하므로 항상 ON. 새 플래그는 이 하나만 — "위험한 것만 게이트, 무해한 것은 기본 동작화".

### A3. 이주 대상 = graph flush cursor 통과분 (이주 고유의 신규 불변식)
`kuzu_outbox` + 200ms sync worker가 requests/sessions 변경을 Ladybug로 flush하며 `sync_state.json`에 cursor를 남긴다(`storage-graph/src/sync/cursor.ts`). worker는 flush 시 SQLite 원본을 JOIN 조회하므로, **cursor 미통과(미-flush) 행을 archive로 옮기면 graph 투영이 영구 누락**된다. 따라서 이주 상한 = `min(boundaryMs, oldestUnflushedTs)`. `oldestUnflushedTs` = `kuzu_outbox`에서 `id > cursor AND dead = 0` 최소 row의 source 행 timestamp. retention 삭제는 graph도 같은 cutoff로 지워 무관했지만, Archive는 "Hot에서 치우되 데이터 생존"이라 이 게이트가 필수.

### A4. 하드 timestamp 파티션
`boundaryMs = now - SPYGLASS_ARCHIVE_DAYS*86400000`, **UTC 일 경계로 floor**(파일=하루, 1h 버킷 미분할 — A6 정확성 전제). Hot = `timestamp >= boundaryMs`, Archive = `timestamp < boundaryMs`. 배타·완전 → 병합이 concat/linear-merge로 성립(A8). 불변식: `boundaryMs % 3600000 === 0`(hour 버킷 무분할).

### A5. `archive_index` 스키마 (마이그레이션 067)
```
archive_index(src_table, row_id, session_id, timestamp, type, archive_file, PRIMARY KEY(src_table,row_id))
  idx (src_table, timestamp DESC)          -- 목록 조회 파일 선택
  idx (src_table, session_id, timestamp)   -- 대화 조회
  idx (archive_file)                       -- retention 경계 GC
```
- `src_table`: 'requests'|'proxy_requests'|'claude_events'|'sessions' (다중 테이블 한 인덱스에 공존, 조회 파일 선택 로직 통일).
- `type` 비정규화: `getRequestsByType`가 파일 열지 않고 스킵 판단.
- **artifact_hash 컬럼 없음**: proxy 행은 manifest(다중 chunk_hash)라 단일 컬럼 부적합(A7).

### A6. 집계는 archive 파일을 절대 열지 않는다 (가법성 활용)
`stats_hourly`/`stats_proxy_hourly`는 sum/count 원시 누적만 저장하고 AVG는 쿼리레이어가 `SUM(sum)/SUM(count)`로 계산한다(migration 027 정책, `aggregate-general.ts`·`proxy-stats.ts`). 따라서 오래된 hour 버킷을 `archive_stats_hourly`/`archive_stats_proxy_hourly`(동일 컬럼)로 이동하고 집계 쿼리를 **두 테이블 UNION ALL 후 SUM**하면 원본 단일테이블 SUM과 정확히 일치한다 — 가중치 코드 불필요(구조적 정확). 파일 포맷:
- 파일: `~/.spyglass/archive/YYYY-MM-DD.<table>.jsonl.zst`(테이블별 분리, 라인=행 JSON, 파일단위 zstd).
- `requests`는 평문 body 인라인(비-CAS, `request_payloads` LEFT JOIN 디코드).
- **P95 예외**: `getP95DurationMs`/strip P95는 `duration_ms` 원행 정렬이라 비가법. hour별 스케치(t-digest/히스토그램)를 `archive_stats_hourly`에 저장하고 Hot 원행 P95 + archive 스케치를 병합(ε 근사, ±2% 가드). exact가 필요하면 `SPYGLASS_ARCHIVE_DAYS`를 넓혀 대시보드 기본창을 Hot에 유지.

### A7. proxy_requests CAS 행은 1차 이주 제외
proxy payload는 CAS(`payload_manifest_algo='chunks/v1'`, manifest=`proxy_request_chunks`, 본문=`artifacts` with `ref_count`, 청크 공유). archive가 manifest만 담고 `artifacts`를 Hot에 남기면, archived manifest를 `ref_count`가 세지 못해 GC가 살아있는 청크를 지운다. 1차 구현은 `requests`/`request_payloads`/`claude_events`/`sessions`만 이주하고 proxy CAS 행은 Hot 유지. proxy 이주는 ref_count를 archive까지 확장하는 후속으로 분리.

### A8. 이주 원자성 + Query Layer 병합
- **원자성**: 파일 write→fsync→rename → **같은 DB 트랜잭션**에서 archive_index INSERT + Hot DELETE. 파일 실패 시 트랜잭션 미시작(Hot 보존). 부분 실패 = 중복만(archive_index PK가 재INSERT·재DELETE 차단) → **안전측 실패, 손실 0**. `queries/proxy-payload.ts:backfillProxyPayloadToCas` 패턴(배치 트랜잭션·round-trip 검증·keyset 커서·멱등) 미러.
- **병합**(호출자 무변경, 시그니처 유지): 하드 파티션이라 DESC 목록은 `[Hot]++[Archive]` concat(교차 없음), **limit early-exit**(Hot이 limit 채우면 archive 파일 무접촉). 대화(session_id,timestamp ASC)는 pre-sorted linear merge + `limit+1` 절단 유지. archive_index 비면 병합 0행 = Hot-only 완전 동일. boundaryMs는 요청당 1회 계산해 Hot/Archive에 동일 값 전달(중간 이동 시 double-count/drop 방지).

## 위험과 완화
| 위험 | 완화 |
| --- | --- |
| graph flush 미통과 이주 → 투영 영구 누락 | A3 `oldestUnflushedTs` 게이트 + 전용 회귀 가드 |
| 이주 원자성 붕괴 | A8 파일 fsync→트랜잭션, 안전측 실패=중복(손실 0) |
| 경계값 N 미검증 조기 이주 | A2 기본 OFF, Phase 0 실측 전 활성화 금지 |
| proxy CAS ref_count 붕괴 | A7 1차 제외 |
| 집계 병합 부정확(AVG/P95) | A6 sum/count 가법성(exact) + P95 스케치(ε 가드) |
| 병합 정렬/limit 오류 | A8 하드 파티션 concat + `archive-query-merge` 불변식 가드 |

## 측정 없이 안전 한계선
- **완주 가능(측정 불요)**: 이 ADR + 단계 1 골격 + 단계 2 코드(이주 0건에서 회귀 0 증명 → 배포해도 동작 무변경).
- **측정 필요(활성화)**: `SPYGLASS_ARCHIVE_DAYS` 프로덕션 값 — Phase 0 실측(증가율·16GB) 후. 기본 ON 배포 금지.
- **측정 후로 미룸**: proxy CAS 행 이주, 역-이주 스크립트, S3/원격 ArchiveStore.

## 구현 참조 (SSoT 재사용)
원자성 `queries/proxy-payload.ts` · 추상화 `artifacts/artifact-store.ts` · flush cursor `storage-graph/src/sync/cursor.ts`·`migrations/049` · retention `queries/session/retention.ts`·`runtime/retention.ts` · CAS 재조립 `reconstructProxyPayloadText` · 조회 `queries/request/{read,conversation}.ts`·`queries/session/read.ts` · 집계 `queries/request/aggregate-*.ts`·`queries/proxy-stats.ts`.
