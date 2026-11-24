# Storage Evolution — 작업 핸드오프 (2026-07-06 갱신)

> 다른 노트북/세션에서 이어서 작업하기 위한 인계 문서. 세션 컨텍스트 없이 이 문서만 읽고
> **남은 할 일**을 파악할 수 있도록 작성했다. **완료된 작업 상세는 파생 문서로 분리**했다.
>
> 함께 읽을 문서:
> - [`storage-evolution-progress.md`](./storage-evolution-progress.md) — ✅ **완료 작업 아카이브**(Phase 0·CAS·Phase 4·Phase 5-7 진행분 + 커밋 해시)
> - [`storage-evolution-adr-archive.md`](./storage-evolution-adr-archive.md) — Phase 5-7 설계 ADR(A1~A8)
> - [`storage-evolution-roadmap.md`](./storage-evolution-roadmap.md) — 8-Phase 로드맵
> - [`storage-profiler-findings.md`](./storage-profiler-findings.md) — Phase 0 측정 결과

## 0. 한 줄 요약

저장소를 `SQLite(Hot Index) + Artifact Store(CAS) + Archive(ELK식)`로 진화 중. **원칙: 측정 → 결정 → 리팩토링.**
현재 **Phase 0·2·3(CAS)·4(TEXT zstd) 완료, Phase 5-7(Archive) 단계2 코드 완료**(이주·조회 병합·GC·retention 정합·배선 전부 — 상세 progress 문서).
모든 변경은 additive이고 **Archive 이주는 비활성**(`SPYGLASS_ARCHIVE_DAYS` 미설정 — 배선은 완료, env 미설정이라 무동작)이라 현재 동작 무변경. 활성화만 남음(prod 실측 후).

---

## 1. Phase 5-7 단계 2 — ✅ 코드 완료 (활성화 전 prod 프로파일링만 남음)

빌딩블록·이주 코어·조회 병합(list/conversation/events)·**집계 병합(stats UNION + raw-requests JS-merge 전부)**·**stats/row 이주**·**archive retention GC**·**sessions retention 정합**·**maintenance 배선** 모두 완료. 아래 (1)~(3),(1-잔여)는 모두 done. **남은 것은 활성화(§ 활성화 조건)와 §2 후속뿐.**

### (1) 집계 조회 병합 — stats 버킷 이주 + UNION ✅ 완료 (sum/count exact)
`archive/stats-bridge.ts`(컬럼 SSoT + `archiveOldStats` INSERT+DELETE·ON CONFLICT 가법 + `statsHourly/ProxyUnionSource`). 집계 4파일 6곳(`aggregate-general`·`aggregate-cache`·`proxy-stats`·`metrics/timeseries`) UNION 교체. maintenance에 `archiveOldStats` 배선(같은 safeTs). 회귀 `archive-stats-merge.test.ts`(이주 전/후 `toEqual` exact). **P95 스케치는 미착수(후순위)** — `duration_ms_sketch`는 NULL 방치.

#### (1-잔여) raw-`requests` 집계 readers ✅ 완료 (exact JS-merge, sketch 불요)
`read.ts:loadArchivedRequestRows(db,{fromTs,toTs,sessionId})` 공용 헬퍼(archive 원행 로드, archiveHasRowsInRange 게이트, toTs +1 inclusive)로 Hot 집계 + archive 원행을 JS 합산. 대상: `aggregate-latency`(getP95/getAvgPromptDurationMs, sum·count/duration 배열 병합) · `aggregate-strip`(p95 + error_rate JS 미러) · `aggregate-general`(getRequestStatsBySession, sum/count 재구성) · `metrics/timeseries`(getBurnRateBuckets hour 버킷 병합 · getAnomalyTimeSeriesInputs (ts,id) 결정화 병합). **모든 지표 exact** → `duration_ms_sketch`는 미사용(예약, sketch 경로 불필요해짐). 회귀 `archive-aggregate-raw-merge.test.ts`.

### (2) sessions retention 정합 ✅ 완료 (Option A — 세션 메타 Hot 유지)
결정: `sessions`(세션당 1행 저소용량)는 **이주하지 않고 Hot 유지**(archive로 옮겨도 Hot 압박 감소 미미 + 세션 목록 병합 복잡도만 증가). 대신 `retention.ts:deleteOldData` step4의 "살아있는 자식" UNION에 `archive_index.session_id` 추가 → archive에 자식이 남은 세션 메타 **오삭제 방지**(archive 자식 GC 후 다음 사이클에 세션 삭제, 1주기 지연). 회귀 `archive-session-retention.test.ts`. proxy_requests는 계속 제외(ADR A7).

### (3) archive retention GC ✅ 완료 (ADR A1)
`archive/archive-retention.ts:deleteExpiredArchive(db, beforeTs, store)` — **완전 만료 파일**(모든 행 ts<cutoff) 단위로 archive 본문 파일 remove + `deleteArchiveIndexByFile` + `archive_stats_hourly`/`archive_stats_proxy_hourly` `hour_ts<cutoff` DELETE. `retention.ts:deleteOldData` 7단계로 배선(`getArchiveDir(db)`로 store 구성, 이주 비활성 시 no-op). FS→DB 순서로 self-healing. 회귀 `archive-retention-gc.test.ts`. **proxy CAS 행 이주 시 artifact ref_count 차감은 proxy Archive 이주(ADR A7) 도입 시 이 함수에 추가.**

### 검증 명령 (매 단계)
```bash
cd packages/storage && bun test           # 단위/회귀 (현재 441 pass, 0 fail 기준)
cd packages/storage && bunx tsc --noEmit  # 타입체크
cd packages/server  && bun test && bunx tsc --noEmit
```
새 조회/이주는 반드시 `archive-*-merge.test.ts` 스타일 회귀 가드(이주 전/후 `toEqual`)부터 작성(TDD).

### 활성화(프로덕션) 조건
단계2 코드 완료 → 프로덕션 실측 후 `SPYGLASS_ARCHIVE_DAYS` 설정(0 < N < retention 30). dev 검증: 파일 기반 DB에 설정 → `runCleanupNow` 1회 → archive_index/파일 확인 → 모든 조회 병합 결과 = 이주 전 동일.

## 2. 그 밖에 남은 것 (선택/후속)
- **프로덕션 16GB 프로파일링 + CAS 대량 백필** — dev만 검증/전환됨. 절차는 progress 문서의 CAS 섹션 + CLI 헤더(`scripts/backfill-proxy-cas.ts` `--dry-run`→`--limit`→전체). 백필 후 CAS 행 읽기는 서버가 reconstruct 커밋 이상이어야.
- **Phase 4 기존 TEXT payload 백필**(선택) — 도구 완료(`queries/backfill-text-payloads.ts`, CLI `bun run backfill:text-payloads` `--dry-run`→`--limit`→전체), dev DB 2026-11-24 dry-run 결과 대상 0건(미압축 행은 전부 512B 미만, 512B 이상은 이미 압축). 다른 환경 DB는 `--dry-run`으로 먼저 확인.
- **proxy_requests CAS 행 Archive 이주** — ref_count를 archive까지 확장하는 후속(ADR A7).

## 3. 미해결 결정 / 주의사항
- **UTC 날짜 게이트**: cleanup이 UTC 기준 하루 1회 → 한국에선 정리 리셋이 09:00 KST. VACUUM 회수도 이 주기. 로컬 날짜 기준 전환 미정. (`scripts/daily-cleanup.ts`, `runtime/maintenance.ts`)
- **즉시 VACUUM 회수**: `bun run stop && bun run scripts/daily-cleanup.ts --force && bun run dev`
- **자동업데이트 경로**: `/api/update` → `git pull --ff-only → bun install → bun run dev`(ensure-deps → daily-cleanup → web:build → `index.ts restart`). 재기동 시 `runMigrations`.
- **배포 = origin/main push**. push는 사용자 명시 요청 시에만.
- 버전업 시 `chore(release): 버전 X.Y.Z` + lightweight 태그 `vX.Y.Z`.
- Archive 이주 정합 불변식(ADR A3): `kuzu_outbox` cursor 미통과(미-flush) 행은 이주 금지 — `getOldestUnflushedTs` 게이트 필수.
