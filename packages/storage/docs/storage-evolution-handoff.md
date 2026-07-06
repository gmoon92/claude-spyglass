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
현재 **Phase 0·2·3(CAS)·4(TEXT zstd) 완료, Phase 5-7(Archive) 진행 중**(→ 완료 상세는 progress 문서).
모든 변경은 additive이고 **Archive 이주는 비활성**(`SPYGLASS_ARCHIVE_DAYS` 미설정 + 배선 안 됨)이라 현재 동작 무변경.

---

## 1. 바로 다음 할 일 — Phase 5-7 단계 2 마무리

빌딩블록·이주 코어(claude_events+requests)·**getAllRequests/getRequestsByType 조회 병합**·**maintenance 배선**은 완료(progress 문서, 커밋 `2efda62`·`7ed2e52`·`058fe46`). **남은 것**을 이으면 단계 2 완성:

### (1) 나머지 조회 병합 (⚠️ 활성화 전 필수 — 미병합 조회는 archive 데이터 누락)
`getAllRequests`/`getRequestsByType` 병합 패턴(`queryPartitioned` + `loadArchive` + `loadRequestArchiveRows` + `isActiveRequest`, `read.ts`)을 나머지 조회에 확장:
- **`getConversationRows`**(`queries/request/conversation.ts`, ⚠️ 최난): payload 포함(대화 본문) → archive 라인 `__payload`를 `request_payloads` 형태로 재구성 + `decodeText` 복호. sessions JOIN(sessions 미이주라 Hot에 있음). 정렬 `session_id ASC, timestamp ASC` linear merge + `limit+1` truncation 유지.
- **`getRequestsBySession`**·**events**(`getEventsBySession`·`getRecentEvents`·`getEventsByType`, `queries/event.ts`): claude_events 이주 대상 → session/type 기반 병합(range 아님 → router 확장 or 전용 로더). archive_index의 `session_id`/`src_table='claude_events'` 인덱스 활용.
- **집계 UNION**(`aggregate-general.ts`·`proxy-stats.ts`): `FROM stats_hourly` → `stats_hourly UNION ALL archive_stats_hourly`(가법성 exact, ADR A6). **P95**(`aggregate-latency.ts`)만 `archive_stats_hourly.duration_ms_sketch`(t-digest) 병합 — 이주 시 스케치 생성도 함께 구현.
- **회귀 가드**: 각 조회 이주 전/후 동일(`archive-query-merge.test.ts` 패턴 확장) / 집계 exact / 레거시(archive 빈) 무변경.

### (2) sessions 이주 대상 추가 — `archiveOldData` SPECS
`sessions`(started_at)를 SPECS에 추가하되 **자식 관계 정합** 검토: retention은 "자식 없는 세션만 삭제". archive도 Hot 자식(requests/events)이 남은 세션 메타는 남겨야 조회 성립 → 이주 조건에 자식 부재 or 세션 메타 항상 Hot 유지 결정. proxy_requests는 CAS ref_count로 계속 제외(ADR A7).

### (3) archive retention GC — archive 파일/index도 retention 도달 시 삭제 (ADR A1)
현재 이주만 하고 archive 파일의 retention 삭제가 없어 **무한 축적** 위험. `retention.ts`(또는 maintenance)에서 `timestamp < retentionCutoff`인 archive_index 행 + 해당 archive 파일 삭제. proxy CAS 행 이주 시 artifact ref_count 차감도 여기서.

### 활성화(프로덕션) 조건
위 (1)~(3) + 프로덕션 실측 후 `SPYGLASS_ARCHIVE_DAYS` 설정(0 < N < retention 30). dev 검증: 파일 기반 DB에 설정 → `runCleanupNow` 1회 → archive_index/파일 확인 → 모든 조회 병합 결과 = 이주 전 동일.

## 2. 그 밖에 남은 것 (선택/후속)
- **프로덕션 16GB 프로파일링 + CAS 대량 백필** — dev만 검증/전환됨. 절차는 progress 문서의 CAS 섹션 + CLI 헤더(`scripts/backfill-proxy-cas.ts` `--dry-run`→`--limit`→전체). 백필 후 CAS 행 읽기는 서버가 reconstruct 커밋 이상이어야.
- **Phase 4 기존 TEXT payload 백필**(선택) — 코덱 완료, 기존분 압축은 미실행(신규만 압축됨).
- **proxy_requests CAS 행 Archive 이주** — ref_count를 archive까지 확장하는 후속(ADR A7).

## 3. 미해결 결정 / 주의사항
- **UTC 날짜 게이트**: cleanup이 UTC 기준 하루 1회 → 한국에선 정리 리셋이 09:00 KST. VACUUM 회수도 이 주기. 로컬 날짜 기준 전환 미정. (`scripts/daily-cleanup.ts`, `runtime/maintenance.ts`)
- **즉시 VACUUM 회수**: `bun run stop && bun run scripts/daily-cleanup.ts --force && bun run dev`
- **자동업데이트 경로**: `/api/update` → `git pull --ff-only → bun install → bun run dev`(ensure-deps → daily-cleanup → web:build → `index.ts restart`). 재기동 시 `runMigrations`.
- **배포 = origin/main push**. push는 사용자 명시 요청 시에만.
- 버전업 시 `chore(release): 버전 X.Y.Z` + lightweight 태그 `vX.Y.Z`.
- Archive 이주 정합 불변식(ADR A3): `kuzu_outbox` cursor 미통과(미-flush) 행은 이주 금지 — `getOldestUnflushedTs` 게이트 필수.
