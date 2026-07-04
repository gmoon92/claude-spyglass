# Storage Profiler — Phase 0 측정 결과 (2026-06-30)

> 상위 문서: [`storage-evolution-roadmap.md`](./storage-evolution-roadmap.md)
> 도구: `packages/storage/src/profiler/` (read-only) · CLI `scripts/profile-storage.ts`
>
> 측정 환경: **dev** (`~/.spyglass/spyglass.db`, 2.55GB). ⚠️ 프로덕션 16GB 환경은 별도 측정 필요 —
> 이 수치로 일반화 금지. 메커니즘 확인용 스냅샷이다.

## 1. 핵심 결과 요약

| 측정 | 값 | 해석 |
| --- | --- | --- |
| DB 파일(물리) | **2.55 GB** | UI "대화·이벤트 기록"이 보여주는 값 (§4) |
| **freelist (죽은 공간)** | **2.40 GB (94%)** | 삭제 후 미회수 페이지. VACUUM으로 즉시 회수 가능 |
| 실제 사용 데이터 | **~150 MB** | 진짜 live 데이터 |
| proxy_requests.payload — document dedup | 0.0% | 통짜 해시는 무의미 |
| **proxy_requests.payload — 청크 dedup** | **94.7%** (splitConversation 단위, 2026-07-05 재측정) · 95.2%/264MB (2026-06-30, content-only 초측정) | message/tool/system 블록 단위 = **CAS가 실제 저장하는 단위**. **CAS의 실제 잠재력** |
| request_payloads.payload — 청크 dedup | 14.4% (재측정) · 12.6%(초측정) | 모니터링만 |
| system_prompts (기존 CAS) | 이미 95%+ 실현 | 신규 CAS 제외 |

> **측정 단위 정합 (정공법 A, 2026-07-05):** 청크 dedup 측정을 CAS가 실제 저장하는 단위
> (`chunker.splitConversation` — envelope + system + message 전체객체 + tool)로 통일했다. 초측정(95.2%)은
> message `content`만 세분화한 이론 상한이었고, 재측정(94.7%)은 실제 CAS 저장 단위 기준이라 profiler
> 수치 = 실제 CAS 절감이 정합한다(측정 hash 집합 = `artifacts.hash` 집합). 소폭 하락은 envelope 청크가
> 요청마다 거의 고유(저dedup)하기 때문이며, 절감의 본질(≈95%)은 동일하다.

## 2. 결정적 발견 — dedup은 "청크 단위"로 측정해야 한다

document(payload 통째) 단위 dedup은 0%지만, 같은 데이터를 message/tool/system **블록**으로
쪼개 측정하면 **94.7%(splitConversation 단위 재측정) / 95.2%(content-only 초측정)**가 중복이다.
conversation payload가 append 구조라 매 요청이 이전 턴을 통째로 다시 담기 때문. → **CAS는 레코드가
아니라 청크(Git blob) 단위로 설계해야** 효과가 난다. 초안 로드맵이 우려한 "CAS 효과 5~10%"는
*document 단위로 봤을 때*의 함정이었다.

## 3. 발견한 버그 — VACUUM이 한 번도 돌지 않았다

`runRetentionCycle`(retention.ts)이 디스크 회수를 `PRAGMA VACUUM`으로 호출했는데, 이는 SQLite가
**인식하지 못하는 pragma라 silent no-op**이다. 주석은 "delete → vacuum을 한 묶음으로 수행해야
디스크가 실제로 회수된다"고 명시했지만 실제 VACUUM은 실행된 적이 없다. 그 결과 retention 삭제분이
freelist에 무한 누적 → dev 2.4GB, **프로덕션 16GB의 유력한 단일 원인**.

### 수정 (같은 커밋)
- `runtime/vacuum.ts` (신규, VACUUM 전략 SSoT): `auto_vacuum=INCREMENTAL`이면 `incremental_vacuum`
  (저비용), 아니면 freelist 임계 초과 시 full `VACUUM` (disk 가드 포함).
- `queries/session/retention.ts`: `PRAGMA VACUUM` → `runVacuumMaintenance()` 경유.
- `migrations/065-auto-vacuum-incremental.sql`: `PRAGMA auto_vacuum=INCREMENTAL`.

### 자동 전파 (태그 버저닝 → 자동업데이트로 전 환경 적용)
자동업데이트 `/api/update`(`packages/server/src/routes/version.ts`) 실제 시퀀스:
```
git pull --ff-only → bun install → (1.2s) → detached `bun run dev`
  → ensure-deps → daily-cleanup.ts → web:build → index.ts restart (옛 서버 SIGTERM → 같은 포트 재기동)
  → 재기동 DB 연결 시 runMigrations → 065 적용(user_version 65, auto_vacuum 전환 대기)
```
auto_vacuum 변경은 SQLite 사양상 다음 full VACUUM 1회로만 전환된다. 그 VACUUM은 daily-cleanup
또는 서버 자체 일일 유지보수에서 freelist가 임계 이상일 때 1회 수행 → 전환 + 회수, 이후 incremental.
수동 개입 불필요. 임시 DB 검증: `user_version=65` 적용 후 force VACUUM → `auto_vacuum` 0→2 전환 확인.

### ⚠️ best-effort VACUUM (자동업데이트 안전성)
`bun run dev`의 daily-cleanup 단계는 **옛 서버가 살아있는 동안** 실행된다. 따라서 첫 full VACUUM이
`database is locked`로 실패할 수 있다. 만약 여기서 throw하면 daily-cleanup이 `exit(1)` → `&&` 체인
단절 → **서버 재시작 누락 → 자동업데이트 중단**. 이를 막기 위해 `runVacuumMaintenance`는 VACUUM 실패를
흡수하고 `action: 'skipped-error'`를 반환한다(절대 throw 안 함). 회수는 다음 사이클(서버가 단독으로
DB를 소유할 때 — 같은 connection 내 VACUUM은 락 경합 없음)에 성공하므로 결국 수렴한다.
즉 자동업데이트 직후 freelist가 바로 안 줄 수도 있으나(날짜 게이팅 + 락), 하루 내 자동 정상화된다.

## 4. UI "저장소" 패널이 2.55GB로 보이는 이유 (오해 주의)

`GET /api/settings/sqlite/info` 핸들러(`packages/server/src/routes/settings.ts:294-301`)가
**`fs.stat(dbPath).size`** = 물리 파일 크기를 그대로 "대화·이벤트 기록"으로 표시한다.
이 값은 **freelist(죽은 공간 2.4GB)를 포함**하므로, 실제로는 ~150MB의 데이터를 2.55GB로 보여준다.

- 프론트: `packages/web/src/features/settings/StoragePanelView.tsx` (총 용량 = sqliteBytes + graphBytes)
- "관계 흐름 그래프" 37MB = `~/.spyglass/graph` 디렉토리 합산 (LadybugDB/Kuzu)

**§3의 VACUUM 수정이 적용·실행되면 이 숫자는 ~150MB 수준으로 급감**한다.
(선택) 패널을 "사용 중 / 회수 가능(freelist)"으로 분리 표기하면 오해를 막을 수 있다 — 미적용.

## 5. 프로덕션(16GB) 검증 가설

| # | 가설 | 확인 |
| - | --- | --- |
| H1 | conversation payload 청크 dedup ≫ document → 청크 CAS가 대부분 제거 | dev 94.7%(CAS 실제 단위) 확인. **프로덕션 재측정 필요** |
| H2 | 16GB 상당 부분은 `auto_vacuum=NONE` + VACUUM no-op로 인한 죽은 freelist | 프로덕션 freelist 측정 |
| H3 | request_payloads(hook tool output)도 dedup 여지 | 프로덕션 청크 측정 |

### 프로덕션 실행 명령 (read-only, 마이그레이션 미실행 — 안전)
```bash
cd <claude-spyglass-repo>   # 이 변경 포함 버전
# 1차: 샘플(대용량 청크 디코드 부담 완화)
bun run packages/storage/src/scripts/profile-storage.ts \
  --db="$HOME/.spyglass/spyglass.db" --out="$HOME/.spyglass/reports" --sample=20000
# 2차: 전수
bun run packages/storage/src/scripts/profile-storage.ts \
  --db="$HOME/.spyglass/spyglass.db" --out="$HOME/.spyglass/reports"
```
암호화(`SPYGLASS_ENCRYPTION_KEY`) 환경은 키를 env로 주입해야 암호문 청크까지 측정된다(없으면 분리 집계).

## 6. 다음 단계
1. 프로덕션 프로파일 실행 → H1~H3 실수치 확정.
2. 로드맵을 청크-CAS + 단일 게이트(ArtifactStore) 중심으로 확정 → Phase 2 설계.
3. 단일 게이트 불변식: `normalize → SHA-256(평문) → exists? → zstd → encrypt → store`
   (해시는 반드시 평문에 — 압축/암호화 후 해시 시 dedup 깨짐).
