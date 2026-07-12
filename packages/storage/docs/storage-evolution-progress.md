# Storage Evolution — 완료 진행 기록

> 저장소 진화(로드맵) 중 **완료된 작업의 아카이브**. 남은 작업·다음 할 일은
> [`storage-evolution-handoff.md`](./storage-evolution-handoff.md)를 본다.
>
> 함께 읽을 문서: [`storage-evolution-roadmap.md`](./storage-evolution-roadmap.md)(8-Phase 로드맵) ·
> [`storage-profiler-findings.md`](./storage-profiler-findings.md)(Phase 0 측정) ·
> [`storage-evolution-adr-archive.md`](./storage-evolution-adr-archive.md)(Phase 5-7 ADR)

## Phase 0 — Storage Profiler + VACUUM 버그 수정 (배포 v4.11.7)
커밋 `23ad243`·`c2d5e3d`(태그 `v4.11.7`).
- Storage Profiler(read-only) — `packages/storage/src/profiler/`, CLI `scripts/profile-storage.ts`.
- VACUUM 회수 버그 수정: `runtime/vacuum.ts`(전략 SSoT) + `migrations/065`(auto_vacuum=INCREMENTAL).

## Phase 2·3 — CAS (Content-Addressed Storage) 완료
커밋 `fa36c0b`(도입 + 정공법 A/B/C) · `0325eb6`(기본화) · `e7941e7`(가시화).
- **artifacts(066)** + `SqliteArtifactStore` + `chunker`(splitConversation/joinConversation, envelope+`$spyref` 재조립) — `src/artifacts/`.
- **재조립 SSoT** `reconstructProxyPayloadText`(`queries/proxy-payload.ts`): `payload_manifest_algo`로 CAS/레거시 분기(역호환). 읽기 3곳(routes/proxy·backfill-system-prompts·cli/analyze) 경유.
- **쓰기 = 기본 CAS**(옵션/게이트 없음): `inbound.ts` conversation → 청크 저장(payload NULL), 비-conversation만 통짜 fallback. `persist.ts` 트랜잭션 원자.
- **retention artifact GC**: ref_count 차감 → 고아 회수(`session/retention.ts`).
- **정공법 A**: profiler 청킹을 CAS 실제 단위(splitConversation)로 통합 → 측정 hash 집합 = `artifacts.hash`. 재측정 **94.7%**.
- **정공법 B**: backfill/analyze WHERE에 `payload_manifest_algo` 추가(CAS 행 system_hash 백필 포함).
- **대량 백필** `backfillProxyPayloadToCas` + CLI `scripts/backfill-proxy-cas.ts`: round-trip 검증·keyset·멱등. **dev 397행 전량 전환**(논리 52.4MB→고유 8MB). 프로덕션 미실행.
- **가시화** `getCasStats`(`queries/cas-stats.ts`) → 저장소 패널 "CAS 청크 절감"(ko/en/ja/zh).

## Phase 4 — TEXT payload zstd 압축 확대 완료
커밋 `61ca52b`. `payload-codec.ts` `encodeText`/`decodeText`에 512B+ zstd(`zstd-b64`/`zstd-b64+aes256gcm`). 마이그레이션 불필요(algo 재사용), 역호환 passthrough. `claude_events.payload`·`request_payloads.payload`·`system_prompts.content` 신규 쓰기부터 압축. dev 압축 여지 request_payloads 61.2%/claude_events 50.1%.

## Phase 5-7 — Archive/ELK (진행 중)
설계 ADR: [`storage-evolution-adr-archive.md`](./storage-evolution-adr-archive.md)(A1~A8).

- **단계 3 ADR** `96b0c77` — 서브에이전트 2인 회의 확정.
- **단계 1 인프라** `e44f912` — `migrations/067`(archive_index + archive_stats_hourly/proxy) + `src/archive/{archive-index, partition-router}` + `runtime/retention.ts:getArchiveDays/getArchiveCutoffTs`(미설정=비활성).
- **단계 2 빌딩블록** `773bdaa` — `archive/{archive-store(FileArchiveStore), flush-gate(getOldestUnflushedTs/computeSafeArchiveTs)}`.
- **단계 2 이주 코어** `91e4693`(claude_events) · `9b046b5`(requests +request_payloads off-row body) — `archive/migrate-to-archive.ts:archiveOldData`(SPECS 배열, keyset·round-trip·파일→DB 트랜잭션 원자).
- **단계 2 조회 병합** `2efda62`(getAllRequests) · `7ed2e52`(getRequestsByType) — `partition-router`에 `loadArchive` 연결. `load-archive-rows.ts`(getArchiveDir + loadArchiveRows), read.ts `isActiveRequest`(필터 JS 미러). 이주 전/후 결과 동일(정렬·limit·offset·필터) 회귀 가드.
- **단계 2 배선** `058fe46` — `server/runtime/maintenance.ts:runCleanupNow`에 이주 스텝(retention 앞). `getSyncCursor().current` flush 게이트 → `computeSafeArchiveTs` → `archiveOldData`. best-effort, env 미설정 시 무동작.
- **단계 2 조회 병합 (requests/events 계열 완료)** `22b5732`(getConversationRows, payload/JOIN/복합정렬) · `9875263`(events: bySession/byType/recent, mergeEventArchive) · `6bf49a1`(getRequestsBySession, payload 매핑). getAllRequests/byType(전일)까지 포함 — 이주된 requests/claude_events가 모든 주요 조회에서 투명 병합. `load-archive-rows.ts`(getArchiveDir/loadArchiveRows) 공용.
- **단계 2 sessions retention 정합 (Option A)** — `sessions`는 이주 안 함(저소용량 Hot 유지). `retention.ts:deleteOldData` step4 세션 삭제의 "살아있는 자식" UNION에 `archive_index.session_id` 추가 → archive에 자식 남은 세션 메타 오삭제 방지(archive 자식 GC 후 다음 사이클 삭제, 1주기 지연). 회귀 `archive-session-retention.test.ts`(archive 자식 보호·1주기 지연·자식無 삭제·Hot 자식 보호, storage 433 pass).
- **단계 2 archive retention GC (ADR A1)** — `archive/archive-retention.ts:deleteExpiredArchive`: **완전 만료 파일**(모든 행 ts<cutoff, UTC일 무straddle) 단위 파일 remove + `deleteArchiveIndexByFile` + `archive_stats_hourly`/`archive_stats_proxy_hourly` `hour_ts<cutoff` DELETE. `retention.ts:deleteOldData` 7단계 배선(`getArchiveDir`로 store, 비활성 no-op, FS→DB self-healing). 회귀 `archive-retention-gc.test.ts`(완전만료만 삭제·최신 보존·빈 no-op·deleteOldData 통합, +4 → storage 429 pass). proxy CAS ref_count 차감은 proxy Archive 이주(A7) 도입 시.
- **단계 2 집계 병합 (stats 버킷 sum/count exact)** — `archive/stats-bridge.ts`: 컬럼 SSoT(dims/sums) + `archiveOldStats`(stats_hourly/proxy → archive_stats_* **테이블 간 INSERT+DELETE**, `ON CONFLICT DO UPDATE` 가법 병합 = 늦은 도착 재이주 안전) + `statsHourly/ProxyUnionSource`(Hot+Archive UNION ALL, 바깥 WHERE 1회). 집계 4파일 6곳(`aggregate-general` 2·`aggregate-cache` 1·`proxy-stats` 2·`metrics/timeseries` 1) `FROM stats_*` → UNION 소스 교체. `server/runtime/maintenance.ts`에 `archiveOldStats` 배선(row 이주와 동일 safeTs → 시각축 무겹침). 회귀 `archive-stats-merge.test.ts`(이주 전/후 `toEqual` exact + 가법 재이주 + archive 빈 무변경, +11 → storage 425 pass). **P95 스케치·raw-`requests` 집계 readers(bySession/burn/anomaly/latency)는 미착수 — handoff (1-잔여).**

**안전 상태**: 전부 additive, **이주 비활성**(`SPYGLASS_ARCHIVE_DAYS` 미설정) → 현재 동작 완전 무변경.
**⚠️ 프로덕션 활성화 전 남은 조회 병합 필수**(미병합 조회는 archive 데이터 누락) — handoff 참조.

## 변경 파일 인덱스 (누적)
```
src/profiler/**, scripts/profile-storage.ts, runtime/vacuum.ts, migrations/065     Phase 0
src/artifacts/**, queries/proxy-payload.ts, queries/cas-stats.ts, migrations/066   CAS
  server/src/proxy/handler/{inbound,persist,_shared}.ts, routes/proxy.ts,
  scripts/backfill-{system-prompts,proxy-cas}.ts, cli/analyze.ts, web StoragePanel  CAS 소비/백필/가시화
src/payload-codec.ts                                                               Phase 4
src/archive/**(+stats-bridge,+archive-retention), migrations/067, docs/adr-archive     Phase 5-7
  queries/{request/aggregate-general,request/aggregate-cache,proxy-stats,metrics/timeseries}.ts,
  queries/session/retention.ts, server/runtime/maintenance.ts                      Phase 5-7 집계 UNION+GC+배선
```
