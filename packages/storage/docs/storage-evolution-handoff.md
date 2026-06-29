# Storage Evolution — 작업 핸드오프 (2026-06-30)

> 다른 노트북/세션에서 이어서 작업하기 위한 인계 문서. 세션 컨텍스트 없이 이 문서만 읽고
> 진행 상황·다음 할 일을 파악할 수 있도록 작성했다.
>
> 함께 읽을 문서:
> - [`storage-evolution-roadmap.md`](./storage-evolution-roadmap.md) — 전체 8-Phase 로드맵 (CAS+ELK+Archive)
> - [`storage-profiler-findings.md`](./storage-profiler-findings.md) — Phase 0 측정 결과 상세

## 0. 한 줄 요약

저장소를 `SQLite(Index) + Artifact Store(CAS) + Archive(ELK식)`로 진화시키는 다단계 작업 중.
**원칙: 측정 → 결정 → 리팩토링.** 현재 **Phase 0(측정) 완료 + VACUUM 운영 버그 수정 배포(v4.11.7)**.
**CAS·ELK·Archive는 아직 미구현(로드맵 문서에만 존재).** 다음 관문은 **프로덕션 16GB 환경 프로파일링**.

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

## 2. ⚠️ 아직 안 한 것 (문서만, 미구현)

- **CAS (Phase 2-3)** — ArtifactStore도 content-addressed 저장도 **코드로 없음**. dev에서
  청크 dedup **95.2% "잠재력만 측정"**한 상태.
- **ZSTD 확대 (Phase 4)**, **ELK/Archive (Phase 5-7)** — 전부 로드맵 위에만 존재.

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

### (B) 결과로 로드맵 Phase 1(Strategy Report) 확정 → Phase 2 착수
- Phase 2 = **ArtifactStore 추상화 + 단일 쓰기 게이트**.
- 단일 게이트 불변식(절대 깨지면 안 됨):
  `normalize → SHA-256(평문!) → exists? → zstd → encrypt → store`
  (해시는 반드시 평문에 — 압축/암호화 후 해시하면 zstd 사전상태·AES nonce로 dedup 깨짐)
- decode 측은 이미 `payload-codec.ts`가 단일 게이트 → encode/write 측 대칭만 완성.
- 목적: 새 테이블 추가 시 압축/CAS 누락 방지(구조로 강제). 본문은 raw 저장 금지, ref/manifest만.

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
