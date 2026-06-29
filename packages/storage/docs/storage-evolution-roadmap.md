# Storage Evolution Roadmap — Git + ELK + Archive

> 목표: Spyglass 저장소를 `SQLite(단일 저장)` → `SQLite(Index) + Artifact Store(CAS) + Archive`
> 구조로 진화시킨다. 단, **모든 구조 변경은 측정 데이터로 정당화한 뒤에만** 수행한다.
>
> 핵심 원칙: **측정 → 결정 → 리팩토링**. CAS·압축·Archive를 "도입"하는 것이 목표가 아니라,
> "각 기법이 실제로 효과가 있는 데이터에만" 적용하는 것이 목표다.

이 문서는 초안 로드맵을 **실제 코드베이스(2026-06 기준)와 대조해 보정한** 버전이다.
초안의 방향(Git+ELK+Archive, 측정 우선)은 유지하되, 코드와 어긋난 전제를 바로잡았다.

---

## 0. 초안 대비 보정 사항 (왜 로드맵이 바뀌었나)

| 초안 전제 | 실제 코드 | 보정 |
| --- | --- | --- |
| 저장소 ~16GB / 보관 15일 | 실측 **2.5GB**, `DEFAULT_RETENTION_DAYS = 30` (`runtime/retention.ts`) | 16GB·15일은 미검증 추정. **Phase 0에서 실측**한 값으로 모든 판단을 대체한다. |
| `interface ArtifactStore` (Java) | 스택은 **TypeScript + Bun + `bun:sqlite`** | 추상화는 TS 인터페이스로 작성. |
| Prompt / Response / Tool Output / Context가 **별도 테이블** | 그런 테이블 없음. 대용량은 **payload 컬럼 3곳**에 집중 | "테이블별 크기"가 아니라 **payload를 type별로 분해**해야 의미가 생긴다. |
| Phase 4에서 "ZSTD 압축 도입" | **v21부터 이미 zstd 적용** (`proxy_requests.payload` BLOB, 원본크기 `payload_raw_size`) | 압축은 *신규 도입*이 아니라 *확대 적용* 문제. |
| Phase 3에서 "Rule/Skill CAS 도입" | `system_prompts`가 **이미 CAS**: PK=`SHA-256(content)`, `ref_count` 참조카운팅. `meta_documents`가 Agent/Skill/Command를 카탈로그로 분리 저장 | 초안이 기대한 "Rule 99% dedup"은 system 프롬프트에 대해 **이미 실현 중**. 같은 영역에 CAS를 또 씌우면 효과 ≈ 0. **잔여(residual) 중복**을 재야 한다. |

### 대용량 데이터가 실제로 사는 곳

| 컬럼 | 타입 | 인코딩 (`payload_algo`) | dedup 측정 방법 |
| --- | --- | --- | --- |
| `requests.payload` | TEXT | **평문** (DEFAULT `'zstd'`는 죽은 마커) / `aes256gcm` | 평문은 그대로 해시. 암호문은 분리 집계 |
| `claude_events.payload` | TEXT | 평문 / `aes256gcm` | 평문은 그대로 해시 |
| `proxy_requests.payload` | BLOB | `zstd` / `zstd+aes256gcm` | `decodeBlob`로 **압축 해제 후** 해시 |
| `system_prompts.content` | TEXT | 평문 / `aes256gcm` | 이미 dedup됨 → `byte_size × ref_count` vs `byte_size`로 실현 효과 직접 산출 |

> ⚠️ **측정 함정 2가지** (Phase 0가 반드시 다뤄야 함)
> 1. **압축 바이트를 해시하면 안 된다.** zstd 결과를 SHA-256하면 가짜 dedup률이 나온다 → `payload_algo`를 보고 평문으로 디코드한 뒤 해시한다.
> 2. **암호화 영역은 dedup이 구조적으로 0으로 측정된다.** AES-256-GCM(v56, opt-in)은 매번 랜덤 nonce를 쓰므로 동일 평문도 암호문이 전부 다르다 → 키가 없으면 **분리 보고**하고, 키가 있을 때만 디코드 후 측정한다.

---

## 1. 최종 목표 구조

```text
SQLite (Hot Index)              Artifact Store (CAS)        Archive Storage
├─ event metadata               ├─ <sha256>.zst             ├─ 2026-08-01.archive
├─ session metadata             ├─ <sha256>.zst             ├─ 2026-08-02.archive
├─ graph outbox (→ Ladybug)     └─ <sha256>.zst             └─ ...
├─ archive_index
└─ artifact_index

        └──────────────── Query Layer (Hot + Archive 투명 병합) ──────────────┘
```

- **Hot Index**: 최근 N일. 메타데이터 + 검색 인덱스. payload 본문은 artifact 참조.
- **Artifact Store(CAS)**: 내용 주소화 저장. 효과가 검증된 데이터만 대상.
- **Archive**: 오래된 데이터를 날짜 단위 묶음으로. SQLite 인덱스는 유지, 본문만 이주.
- **Query Layer**: UI는 Hot/Archive 구분을 모른다.

---

## Phase 0 — Storage Profiler  ← **지금 여기**

**리팩토링·구조 변경·기능 추가 금지. 읽기 전용 분석 도구만.**

현재 DB(실측 2.5GB)를 분석해 이후 모든 설계의 근거를 만든다.

- 테이블·인덱스별 **물리 크기** (`dbstat` 사용 — 가용 확인됨)
- payload 컬럼 **논리 크기** + `requests.type` / `tool_name`별 분해
- **이중 축 dedup 측정**:
  - Axis A (평문 기준): 디코드 후 정규화 해시 → 이론적 CAS 절감 상한
  - Axis B (물리 기준): 현재 zstd 적용 후 실제 디스크 + 추가 압축 여지
- `system_prompts`의 **이미 실현된 dedup 효과** 정량화 (`ref_count` 분포)
- 암호화(`aes256gcm`) 영역 분리 집계 (측정 불가 구간 명시)
- 측정은 **전체 집계 + 대용량 컬럼 샘플링**(추정치는 신뢰구간 명시) 병행

**산출물 (Markdown):**
1. Storage Analysis Report — 테이블/컬럼/type별 물리·논리 크기
2. Deduplication Analysis Report — 이중 축 dedup, 이미 실현된 효과 포함
3. Top-100 Largest Records — 개별 대형 레코드
4. Storage Optimization Recommendation — CAS/Archive 우선순위 결정 근거

→ 상세 실행 계획: `phase-0-storage-profiler-plan.md` (temp plans 디렉토리)

---

## Phase 1 — Storage Strategy Report

Phase 0 결과 기반으로 **CAS 적용 대상을 데이터로 선정**한다.

- dedup gain이 높은 데이터만 CAS 대상 (예: 반복되는 context/rule 류)
- Prompt/Response의 dedup이 낮으면 **CAS 우선순위를 낮춘다** (초안의 핵심 통찰)
- `system_prompts`처럼 이미 dedup된 영역은 **제외**
- 산출: 예상 절감률(CAS / Archive / Combined)을 *측정 기반*으로 명시

---

## Phase 2 — Artifact Layer 추상화 (CAS 미적용)

교체 가능한 저장 추상화만 도입한다. 아직 동작 변경 없음.

```typescript
export interface ArtifactRef {
  hash: string;      // sha256
  algo: PayloadAlgo; // 기존 payload-codec과 정합
  size: number;      // raw byte size
}

export interface ArtifactStore {
  store(content: Uint8Array): Promise<ArtifactRef>;
  load(hash: string): Promise<Uint8Array>;
  exists(hash: string): Promise<boolean>;
}
```

- 구현체 교체 목표: `SqliteArtifactStore` → `FileArtifactStore` → `S3` → `Archive`
- 기존 `payload-codec.ts`(encode/decode + algo 마커)와 정합되게 설계

---

## Phase 3 — CAS 적용 (검증된 데이터만)

Phase 1에서 dedup 효과가 입증된 데이터에만 적용.

```text
content → SHA-256 → exists? → YES: 참조 / NO: 저장
```

- Git object store 방식
- ⚠️ 암호화 켜진 환경에선 CAS 전에 **정규화·해시를 평문에 적용**해야 dedup이 성립 (nonce 문제)

---

## Phase 4 — ZSTD 압축 *확대*

> 신규 도입 아님. `proxy_requests.payload`는 이미 zstd. 이번엔 **TEXT payload 컬럼**으로 확대.

- 대상 후보: `requests.payload`, `claude_events.payload` (현재 평문 TEXT)
- Phase 0의 "추가 압축 여지" 측정으로 대상·우선순위 결정
- 원문 보존·조회 가능·압축 저장 동시 충족 (기존 `encodeText`/`decodeText` 확장)

---

## Phase 5 — Archive 설계 (ELK 스타일)

- Hot(0~N일): SQLite. Warm(N~retention): Archive. retention 이후: 삭제(기존 정책 유지)
- 경계값 N과 retention은 **Phase 0 실측 증가율**로 결정 (현 기본 30일)

---

## Phase 6 — Archive Index

**압축 파일을 직접 검색하지 않는다.** 인덱스는 SQLite에 유지.

```sql
CREATE TABLE archive_index (
  event_id     TEXT,
  session_id   TEXT,
  timestamp    INTEGER,
  archive_file TEXT,
  artifact_hash TEXT
);
```

- 검색 조건은 SQLite가 처리(`WHERE timestamp BETWEEN ...`), 필요한 archive만 로드 (Loki 방식)

---

## Phase 7 — Query Layer

사용자/ UI는 Hot/Archive를 구분하지 않는다.

```text
조회 → Hot(SQLite) 우선 → 부족하면 Archive Index 검색 → 필요한 Archive 로드 → 병합
```

- UI 변경 없음이 성공 기준

---

## 진행 원칙

- Phase 0 산출물 없이는 Phase 1 이후로 진행하지 않는다.
- 각 Phase는 이전 Phase의 측정/결정 문서를 근거로 인용한다.
- 이미 존재하는 최적화(zstd, `system_prompts` CAS, `meta_documents` 카탈로그)를 중복 구현하지 않는다.
