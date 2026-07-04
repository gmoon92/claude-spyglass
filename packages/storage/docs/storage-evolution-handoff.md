# Storage Evolution — 작업 핸드오프 (2026-07-05 갱신)

> 다른 노트북/세션에서 이어서 작업하기 위한 인계 문서. 세션 컨텍스트 없이 이 문서만 읽고
> 진행 상황·다음 할 일을 파악할 수 있도록 작성했다.
>
> 함께 읽을 문서:
> - [`storage-evolution-roadmap.md`](./storage-evolution-roadmap.md) — 전체 8-Phase 로드맵 (CAS+ELK+Archive)
> - [`storage-profiler-findings.md`](./storage-profiler-findings.md) — Phase 0 측정 결과 상세

## 0. 한 줄 요약

저장소를 `SQLite(Index) + Artifact Store(CAS) + Archive(ELK식)`로 진화시키는 다단계 작업 중.
**원칙: 측정 → 결정 → 리팩토링.** 현재 **Phase 0(측정) + Phase 2·3(CAS) 완료**.
proxy payload를 청크 단위 content-addressed로 저장(기본 동작, 옵션 아님)하고, 레거시 행은 대량
백필로 전환한다. **ELK/Archive(Phase 5-7)·ZSTD 확대(Phase 4)는 아직 미구현.** 다음 관문은
**프로덕션 16GB 환경 프로파일링 + 프로덕션 백필**.

## 1. 지금까지 한 것 (배포됨 — v4.11.7, origin/main)

커밋:
- `23ad243` feat(storage): Storage Profiler(Phase 0) + VACUUM 회수 버그 수정
- `c2d5e3d` chore(release): 버전 4.11.7 (태그 `v4.11.7`)

내용:
1. **Storage Profiler** (read-only, DB 무수정) — `packages/storage/src/profiler/`
   - 물리 크기(dbstat) / 논리 크기 / dedup(document·**청크** 두 축) / Top-100 / 권장안 Markdown 4종
   - CLI: `bun run packages/storage/src/scripts/profile-storage.ts [--db= --out= --sample= --top=]`
2. **VACUUM 회수 버그 수정** — `runRetentionCycle`이 `PRAGMA VACUUM`(존재하지 않는 pragma →
   silent no-op)을 호출해 VACUUM이 한 번도 안 돌았음. freelist 무한 누적의 근본 원인.
   - `packages/storage/src/runtime/vacuum.ts` 신설 — VACUUM 전략 SSoT (incremental/full + disk 가드,
     **best-effort: throw 금지** → 자동업데이트 체인 안 깨짐)
   - `migrations/065-auto-vacuum-incremental.sql` — `auto_vacuum=INCREMENTAL`, 자동업데이트로 전파

## 1-b. CAS 도입 (Phase 2·3 완료 — 커밋 `fa36c0b`, 아직 origin/main push 전일 수 있음)

- **artifacts 테이블(마이그레이션 066)** + `SqliteArtifactStore` + `chunker`(splitConversation/
  joinConversation, envelope+`$spyref` placeholder로 재조립·키 순서 보존) — `packages/storage/src/artifacts/`.
- **재조립 SSoT** `reconstructProxyPayloadText`(`queries/proxy-payload.ts`): `payload_manifest_algo`로
  CAS/레거시 분기(역호환). 읽기 3곳(routes/proxy·backfill-system-prompts·cli/analyze) 모두 이 경유.
- **쓰기 = 기본 CAS**(옵션/게이트 없음): `inbound.ts`가 conversation 본문을 splitConversation으로 분해해
  청크 저장(payload NULL). 비-conversation 본문만 통짜 zstd fallback. `persist.ts` 트랜잭션 원자 저장.
- **retention artifact GC**: proxy_requests 삭제 시 ref_count 차감 → 고아 청크 회수(`session/retention.ts`).
- **profiler 정합(정공법 A)**: 측정 청킹을 CAS 실제 단위(splitConversation)로 통합 → 측정 hash 집합 =
  `artifacts.hash` 집합. 재측정 **94.7%**(초측정 95.2% content-only와 근사).
- **대량 백필**: `backfillProxyPayloadToCas`(`queries/proxy-payload.ts`) + CLI `scripts/backfill-proxy-cas.ts`.
  행별 round-trip 검증(`Bun.deepEquals`) 통과분만 payload NULL화. keyset 커서·멱등·배치 트랜잭션.
  **dev DB 397행 전량 전환 완료**(논리 52.4MB→고유 8MB). 프로덕션은 미실행.

## 2. ⚠️ 아직 안 한 것

- **프로덕션 16GB 프로파일링 + 프로덕션 백필** — dev만 검증/전환됨(§4-A).
- **ZSTD 확대 (Phase 4)** — `requests.payload`·`claude_events.payload`(TEXT 평문) 압축 미착수.
- **ELK/Archive (Phase 5-7)** — 전부 로드맵 위에만 존재.

## 3. 핵심 측정 결과 (dev 2.5GB — 대표성 없음, 메커니즘 확인용)

| 측정 | 값 | 의미 |
| --- | --- | --- |
| DB 파일 / freelist(죽은 공간) / 실데이터 | 2.55GB / **2.40GB(94%)** / ~150MB | 대부분이 회수 안 된 빈 페이지 |
| proxy payload — document dedup | **0.0%** | 통짜 해시는 무의미 |
| proxy payload — **청크 dedup** | **95.2% (264MB)** | message/tool/system 블록 단위 = CAS 실제 잠재력 |
| system_prompts (기존 CAS) | 이미 98.3% 실현 | 신규 CAS 제외 |

**결정적 통찰**: CAS는 레코드(document)가 아니라 **청크(message/tool/system 블록, Git blob) 단위**로
설계해야 효과가 난다. append 구조라 document 전체는 0%여도 블록은 95% 중복.

## 4. 바로 다음 할 일 (최우선)

### (A) 프로덕션 16GB 환경에서 프로파일러 실행
dev 2.5GB는 대표성이 없다. **16GB가 발생한 실제 설치 환경**에서 아래를 실행해 실수치 확보:
```bash
cd <claude-spyglass-repo>   # v4.11.7 이상 (git pull로 최신화)
# 1차: 샘플(대용량 청크 디코드 부담 완화)
bun run packages/storage/src/scripts/profile-storage.ts \
  --db="$HOME/.spyglass/spyglass.db" --out="$HOME/.spyglass/reports" --sample=20000
# 2차: 전수
bun run packages/storage/src/scripts/profile-storage.ts \
  --db="$HOME/.spyglass/spyglass.db" --out="$HOME/.spyglass/reports"
```
- read-only + query_only라 DB 무수정, 마이그레이션도 안 돌림 → 안전.
- 암호화 환경이면 `SPYGLASS_ENCRYPTION_KEY` env 주입해야 암호문 청크까지 측정(없으면 분리 집계).
- 확인할 가설: H1 청크 dedup 실제 비율 / H2 16GB 중 freelist(죽은 공간) 비중 / H3 request_payloads dedup.

### (A-2) 프로덕션 CAS 대량 백필 (프로파일링과 함께)
레거시 payload 행을 CAS로 전환(비가역). **dry-run 선행 필수**:
```bash
bun run packages/server/scripts/backfill-proxy-cas.ts --dry-run           # 전환 가능 수 + round-trip 검증
bun run packages/server/scripts/backfill-proxy-cas.ts --limit 5           # 소량 실전환 검증
bun run packages/server/scripts/backfill-proxy-cas.ts                     # 전체
```
- 행별 round-trip 검증 통과분만 payload NULL화 → 안전. 멱등(재실행 무해). VACUUM은 daily-cleanup 주기.
- **주의**: 백필 후 CAS 행을 읽으려면 서버가 이 커밋(reconstruct 경유) 이상이어야 함 — 구버전은 빈 messages.

### (B) 남은 로드맵 — Phase 4(ZSTD 확대) → Phase 5-7(Archive/ELK/Query Layer)
- **Phase 4**: `requests.payload`·`claude_events.payload`(TEXT 평문)를 zstd 확대. Phase 0의 "추가 압축 여지"
  측정으로 우선순위 결정. `encodeText`/`decodeText` 확장(현재 TEXT는 압축 없이 평문/AES만).
- **Phase 5-7**: Hot/Warm/Archive 경계 + archive_index + Query Layer(Hot/Archive 투명 병합). 로드맵 참조.
- CAS 불변식(유지): `normalize → SHA-256(평문!) → exists? → zstd → encrypt → store`. 이미 `artifacts`에 구현됨.

## 5. 미해결 결정 / 주의사항

- **UTC 날짜 게이트**: cleanup이 `new Date().toISOString()`(UTC) 기준 하루 1회라, 한국에선
  "정리 리셋"이 자정이 아니라 09:00 KST에 일어남. VACUUM 회수도 이 주기에 묶임.
  로컬 날짜 기준으로 바꿀지 미정. (`scripts/daily-cleanup.ts:22`, `runtime/maintenance.ts:40`)
- **즉시 VACUUM 회수**(원할 때): `bun run stop && bun run scripts/daily-cleanup.ts --force && bun run dev`
- **자동업데이트 경로**: `/api/update` → `git pull --ff-only → bun install → bun run dev`
  (= ensure-deps → daily-cleanup → web:build → `index.ts restart`). 재기동 시 `runMigrations`로 065 적용.
- **배포 = origin/main push** (다른 환경이 `git pull --ff-only`로 수신). push는 사용자 명시 요청 시에만.
- 버전업 시 `chore(release): 버전 X.Y.Z`(루트 package.json 1줄) + lightweight 태그 `vX.Y.Z`.

## 6. 변경 파일 인덱스 (이번 작업)
```
packages/storage/src/profiler/**                      신규 (프로파일러)
packages/storage/src/scripts/profile-storage.ts       신규 (CLI)
packages/storage/src/runtime/vacuum.ts                신규 (VACUUM SSoT)
packages/storage/src/queries/session/retention.ts     수정 (PRAGMA VACUUM 버그)
packages/server/src/runtime/maintenance.ts            수정 (DB 경로 전달)
packages/storage/migrations/065-auto-vacuum-incremental.sql  신규
packages/storage/docs/storage-evolution-roadmap.md    신규 (로드맵)
packages/storage/docs/storage-profiler-findings.md    신규 (측정 결과)
packages/storage/docs/storage-evolution-handoff.md    신규 (이 문서)
```
