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

## 1. 바로 다음 할 일 — Phase 5-7 단계 2 마무리 (내일)

빌딩블록(FileArchiveStore·flush-gate·archive-index·partition-router)과 이주 코어(`archiveOldData`,
claude_events+requests)는 완료(progress 문서). **남은 3가지**를 이으면 단계 2 완성:

### (1) 조회/집계 병합 — `queryPartitioned`에 `loadArchive` 연결 (⚠️ 회귀 위험 큼)
Archive된 행이 UI에서 다시 보이도록 Hot+Archive를 투명 병합한다(ADR A8). **레거시 조회를 깨지 않도록 최우선 회귀 가드.**
- 전제: `getArchiveDir()` 헬퍼 신규(`connection.ts`, `DB_PATH` dirname + `/archive`) — 조회 시 `FileArchiveStore` 생성용.
- `queries/request/read.ts:getAllRequests`·`getRequestsByType`, `queries/request/conversation.ts:getConversationRows`를 `queryPartitioned` 경유로. `loadArchive(indexRows)` = 파일별 `FileArchiveStore.readDay` → `JSON.parse` → `__payload/__payload_algo` 제거(목록) 또는 `request_payloads` 재구성(대화, `decodeText` 복호). `tsOf`/`order`로 정렬·limit 재적용.
- 집계 `queries/request/aggregate-general.ts`·`queries/proxy-stats.ts`: `FROM stats_hourly`를 `stats_hourly UNION ALL archive_stats_hourly`로(가법성 exact, ADR A6). **P95**(`aggregate-latency.ts`)만 `archive_stats_hourly.duration_ms_sketch`(t-digest, 단계2에서 채움) 병합 — ε 근사.
- **회귀 가드**: 이주 전/후 `getAllRequests`·`getConversationRows` 결과 동일(정렬·limit·truncation) / 집계 exact / 레거시(archive 빈) 무변경.

### (2) maintenance 배선 — 이주를 일일 유지보수에 연결
- `server/src/runtime/maintenance.ts:runCleanupNow`에서 retention **앞에** 이주 스텝 추가: `getArchiveCutoffTs()`(null이면 skip) + `getOldestUnflushedTs(db, cursor)`(SyncCursor는 `storage-graph` `getSyncCursor().load()`로 조달) → `computeSafeArchiveTs` → `archiveOldData(db, {safeArchiveTs, store: new FileArchiveStore(getArchiveDir())})`.
- **회귀 가드**: `SPYGLASS_ARCHIVE_DAYS` 미설정 시 기존 retention 동작 동일 / 활성 시 이주 후 retention 정상.

### (3) sessions 이주 대상 추가 — `archiveOldData` SPECS
- `sessions`(started_at 기준)를 SPECS에 추가하되 **자식 관계 정합** 검토: retention은 "자식 없는 세션만 삭제". archive도 Hot 자식(requests/events)이 남은 세션은 메타를 남겨야 조회가 성립 → 이주 조건에 자식 부재(또는 세션 메타는 항상 Hot 유지) 결정 필요. proxy_requests는 CAS ref_count 때문에 계속 제외(ADR A7).

### 활성화(프로덕션) 조건
위 3가지 + 프로덕션 실측 후 `SPYGLASS_ARCHIVE_DAYS` 설정(0 < N < retention 30). dev 검증: 설정 → 일일 유지보수 1회 → archive_index/파일 확인 → 조회 병합 결과 = 이주 전 동일.

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
