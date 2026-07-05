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

**안전 상태**: 전부 additive, **이주 비활성**(`SPYGLASS_ARCHIVE_DAYS` 미설정 + 배선 안 됨) → 현재 동작 완전 무변경. **남은 단계 2(조회 병합·배선·sessions 이주)는 handoff 참조.**

## 변경 파일 인덱스 (누적)
```
src/profiler/**, scripts/profile-storage.ts, runtime/vacuum.ts, migrations/065     Phase 0
src/artifacts/**, queries/proxy-payload.ts, queries/cas-stats.ts, migrations/066   CAS
  server/src/proxy/handler/{inbound,persist,_shared}.ts, routes/proxy.ts,
  scripts/backfill-{system-prompts,proxy-cas}.ts, cli/analyze.ts, web StoragePanel  CAS 소비/백필/가시화
src/payload-codec.ts                                                               Phase 4
src/archive/**, migrations/067, docs/storage-evolution-adr-archive.md              Phase 5-7
```
