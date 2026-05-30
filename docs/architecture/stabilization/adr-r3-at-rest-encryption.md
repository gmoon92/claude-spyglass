# ADR — R3: 대화 본문 at-rest 컬럼 암호화 (+ R10 diag 평문)

- 상태: **Accepted** (전문가 회의 4-렌즈 반영, 2026-05-31)
- 브랜치: `r3-at-rest-encryption` (워크트리)
- 범위: `proxy_requests.payload` · `requests.payload` · `claude_events.payload` · `system_prompts.content` at-rest 평문/비암호화 + R10 diag `.jsonl`
- 경로 표기: 소스는 `packages/server/src/...`, `packages/storage/...`. 마이그레이션은 `packages/storage/migrations/...`.
- 원칙: 사실 주장에 `파일:라인` 근거. 회귀 0. 모든 소스 수정에 연관 테스트 동반.

## 컨텍스트 (위협 모델)

DB 파일(`~/.spyglass/spyglass.db`) 유출 시 전체 대화 본문·시스템 프롬프트·hook 원문이 평문 노출. 유일 방어선은 best-effort `chmod 0o600/0o700`(`connection.ts:97-133`).

대상은 **loopback 단일 사용자 데몬**. 위협 = "DB/백업/파일 단독 유출 시 평문 노출". 막는 것: DB 단독 공유/백업/버그리포트 첨부 + GCM 변조 탐지. **못 막는 것(문서화)**: 홈 디렉토리 통째 유출(키 동봉 시), 프로세스 메모리, 활성화 이전 평문 행. API 인증 게이트 부재(확정사실 6)는 범위 밖.

## 확정된 사실 (소스 대조 — 전문가 회의 정정 반영)

| # | 사실 | 근거 |
|---|------|------|
| 1 | **`requests.payload`는 TEXT다(BLOB 아님).** 016이 requests를 `payload TEXT`로 재생성, 021의 `ADD COLUMN payload BLOB`은 중복명이라 `migrator.ts:397`에서 silent skip. requests의 `payload_raw_size`/`payload_algo`는 추가됐으나 **미사용(dead)**. | `migrations/016:20,22,35`, `021:13`, `migrator.ts:397-402` |
| 2 | `proxy_requests.payload`만 실제 zstd BLOB + `payload_algo` 분기. 단, 읽기 3곳이 `payload_algo` 무시하고 **무조건 zstd** 디코드(`instanceof Uint8Array` 분기) | 쓰기 `proxy/handler/persist.ts:108-111`; 읽기 `routes/proxy.ts:53-55`, `cli/analyze.ts:169`, `scripts/backfill-system-prompts.ts:103` |
| 3 | `requests.payload`는 **string으로 API에 raw 전달 → 클라이언트(web/tui)가 `JSON.parse`**. 서버는 디코드 안 함 | `queries/request/{read,turn}.ts`, `request-normalizer.ts:228,252`, `domain/session-status.ts:209-211`; 클라 `web/.../render/extract.js`, `tui/.../useSessionTurns.ts:101-103` |
| 4 | `claude_events.payload` 평문 TEXT NOT NULL, algo 컬럼 없음 | `migrations/006:14`, 쓰기 `events.ts:82`, 읽기 `queries/event.ts:55-71` |
| 5 | `system_prompts.content` 평문 TEXT NOT NULL. `hash=SHA-256(정규화 평문)`가 dedup PK | `migrations/022:19`, `queries/system-prompt.ts:93,117-133` |
| 6 | app-level 암호화 0건, 로컬 API 인증 게이트 0건 | rg 전수 |
| 7 | bun:sqlite SQLCipher 미지원 → 컬럼 암호화 채택 | 잔여문서 R3 |
| 8 | 최신 마이그레이션 055 → 신규 **056** | `migrations/` |
| 9 | `node:crypto`·`Bun.zstd*` 가용 (Bun ≥1.2) | `events.ts:8` import |
| 10 | R10 diag는 **기본 OFF**(`SPYGLASS_DIAG_ENABLED`), off 시 no-op, dir 0o700, 재시작 truncate | `diag-log.ts`(ENABLED 게이트), `events.ts:59` |

## 확정 설계

### D1. 암호화 — AES-256-GCM (`node:crypto`)
- 평문 → (선택: zstd 압축) → AES-256-GCM. 레코드 단위 `randomBytes(12)` nonce(내부 생성만, 외부 주입 금지). 16바이트 auth tag로 변조 검출.
- 압축 순서: **compress-then-encrypt**. proxy는 기존 zstd 유지 후 암호화.
- 모듈: `packages/storage/src/crypto.ts`(encrypt/decrypt/키로딩).

### D2. 프레이밍 + payload_algo (additive)
- BLOB 프레이밍: `[version(1) | nonce(12) | tag(16) | ciphertext]`.
- `payload_algo` enum 확장: `NULL`(평문)·`'zstd'`(기존)·`'aes256gcm'`·`'zstd+aes256gcm'`.
- TEXT 컬럼(requests.payload·claude_events.payload·system_prompts.content)은 프레이밍 BLOB을 **base64로 인코딩해 기존 TEXT 컬럼에 in-place 저장** → **string→BLOB 타입 변경 없음 = R7 비해당**.
- proxy_requests.payload만 실제 BLOB에 프레이밍 직접 저장.

### D3. 디코드 SSoT
- `packages/storage/src/payload-codec.ts`: `encodePayload(plain, {compress, encrypt}) → {value, algo}` / `decodePayload(value, algo) → plain`. 모든 쓰기/읽기가 이 한 곳만 경유. 분기 분산 금지(현 proxy 무조건-zstd 문제의 근원).

### D4. 키 관리
- 우선순위: env `SPYGLASS_ENCRYPTION_KEY`(base64 32B) > 키파일 `~/.spyglass/encryption.key`(0600) > 최초 기동 자동 생성(`randomBytes(32)`).
- **KDF 없음**(고엔트로피 랜덤 키). 크로스플랫폼 균일 키파일(키체인 분기 없음).
- 키파일이 DB와 같은 디렉토리면 통째 유출 시 무력 → "키파일 백업 제외" 문서화.

### D5. 옵트인 (기본 OFF)
- `SPYGLASS_ENCRYPTION`(예: `1`/`true`) ON일 때만 신규 쓰기 암호화. OFF=평문(기존 동작·85개 테스트 무변경).
- 읽기는 **항상** `payload_algo` 분기 → OFF↔ON 무손실, 평문/zstd/암호문 혼재 동시 조회 정상.
- 키 부재: 기능 OFF면 그대로, ON이면 자동 생성. **기동 실패 금지**.

### D6. 마이그레이션 056 (additive only)
- `claude_events`: `ADD COLUMN payload_algo TEXT` (algo 마커).
- `system_prompts`: `ADD COLUMN content_algo TEXT` (algo 마커).
- `requests`: 변경 없음(dead `payload_algo` 재사용). `proxy_requests`: 변경 없음(기존 algo 재사용).
- 파괴적 변경(컬럼 삭제/타입 변경) 금지. 신규 컬럼명이 기존과 겹치지 않는지 확인(migrator silent-skip 함정).

### D7. requests.payload 서버측 복호화
- 클라이언트가 `JSON.parse`하므로 API 응답 전 서버에서 평문 string 복원.
- 중앙 지점: `request-normalizer.ts:228,252`(모든 `/api/requests*`·`/api/sessions*` 경유). **우회 경로 `session-status.ts:211` `first_prompt_payload`는 별도 디코드**(누락 1순위 위험).

### D8. system_prompts dedup 보존
- content만 암호화, `hash`는 **평문 기준 SHA-256 유지**(dedup·ref_count 정합). GCM random-nonce라 ciphertext dedup 불가 — 평문 해시로 dedup. HMAC 전환은 과잉(미채택), 평문-해시 equality leak은 위협모델상 수용·문서화.

### D9. R10 diag
- 암호화/마스킹 **미채택**(기본 OFF·휘발성 디버그 산출물). 하드닝만: diag 파일 생성 모드 **0o600 명시** + diag ON 시 "평문 기록" 경고 1줄.

### D10. 범위 한계 (문서화, 확대 금지)
- `requests.preview`/`response_preview`/`system_reminder` 등 평문 파생 미리보기 컬럼은 R3 범위 밖 — 평문 잔존(별도 R-item). WAL은 암호화 컬럼의 평문을 누출하지 않음(암호문 페이지 이미지). 활성화 이전 행은 평문 유지(D5 옵트인 백필).

## 전문가 회의 권장사항 (채택/완화/기각)

- **채택**: AES-256-GCM 컬럼 암호화(비례 최소 정답), `payload_algo` additive 확장(R6 정합·proxy 기존 패턴 재사용), `node:crypto`(의존성 0·buildless 정합), 중앙 codec SSoT.
- **완화(범위축소)**: 키관리 = env+키파일(0600) 단일 키로(키체인 양다리 축소). R10 = 비활성 유지 + 0o600 + 경고로(암호화 축소).
- **기각(과잉)**: KMS/봉투 암호화, 키 회전, 다중/컬럼별 키, 카운터 nonce, diag 암호화, preview/derived 컬럼 확대, HMAC dedup, SQLCipher.
- **R7 판정**: proxy/claude_events/system_prompts = additive로 backward-compatible(R7 비해당). requests.payload = TEXT+base64 유지로 타입 변경 없음 → **R7 비해당**(string 기대 소비처가 추가 발견되면 재평가). claude_events는 Storage v3 R1(미래 SoT) 전방결합 — v3 materializer 도입 시 투영 전 복호화 필요(현재 v3 미구현이라 충돌 없음, 주석화).

## 단계 (staging) — 회귀 안전 순

1. **기반**: `crypto.ts` + `payload-codec.ts` + 키관리 + 단위 테스트(round-trip·키부재·변조·혼재 algo).
2. **마이그레이션 056** + migrator 테스트.
3. **Stage A — proxy_requests.payload**: 디코드 3곳(`routes/proxy.ts`·`cli/analyze.ts`·`backfill-system-prompts.ts`)을 codec 분기로 교체 + 쓰기 암호화. 혼재 round-trip 테스트.
4. **Stage B — claude_events.payload + system_prompts.content**: 쓰기 암호화 + 읽기 codec 분기. system_prompts hash 평문 유지. 테스트.
5. **Stage C — requests.payload**: 쓰기 암호화(base64-in-TEXT) + 서버측 복호화(normalizer + session-status). 클라 `JSON.parse` 계약 테스트(평문 string 보장).
6. **R10**: diag 파일 0o600 + 경고.
7. **회귀 게이트 + 스펙 준수 최종 검토 + 최종 보고**.

## 회귀 테스트 (필수)

- 컬럼별 평문/zstd/암호문 **혼재 행 동시 조회 동일 평문 복원**(1건 실패=fail).
- proxy 무조건-zstd 회귀 가드(암호문 행 decode_error 없이 평문 messages).
- `requests.payload` 클라 계약: `/api/sessions` `first_prompt_payload` + `/api/sessions/:id/turns` `prompt.payload`가 항상 `JSON.parse` 가능한 평문 string.
- system_prompts: 평문/암호문 hash dedup·ref_count 정합.
- backfill/analyze: zstd+암호문 혼재 DB에서 decode_err=0.
- migrator: 056 적용 후 user_version 증가 + 신규 컬럼 존재 + 기존 행 보존.
- phase gate: 기존 85개 테스트 + `bun run typecheck` 전체 통과.

## over-engineering 가드 (각 단계 후 자문)

- 노출면을 실제로 줄였는가, 간접 계층만 늘렸는가?
- buildless·단일사용자 정체성과 충돌하지 않는가?
- 기존 동작·테스트·이벤트 흐름이 100% 동일한가? (OFF 시 무변경 확인)

## 구현 결과 (검증 완료 — 2026-05-31)

상태: **구현 완료**. 회귀 0(전체 1143 테스트 pass / 0 fail, 102 파일), root typecheck 베이스라인 12건 불변(R3 신규 0건).

### 신규 파일
- `packages/storage/src/crypto.ts` — AES-256-GCM(`encryptBytes`/`decryptBytes`) + 키 해석(`resolveEncryptionKey`, env>파일(0600)>자동생성).
- `packages/storage/src/payload-codec.ts` — `encodeText`/`decodeText`(base64-in-TEXT), `encodeBlob`/`decodeBlob`(proxy BLOB) 분기 SSoT.
- `packages/storage/src/runtime/encryption.ts` — `getActiveKey`/`shouldEncrypt`(읽기는 플래그 무관 키 로드, 쓰기는 옵트인 게이트).
- `packages/storage/migrations/056-payload-encryption.sql` — additive algo 마커 2개 + requests 죽은 'zstd' 정리.

### 변경 파일 (seam)
- 쓰기: `proxy/handler/{inbound,persist,_shared}.ts`(proxy), `queries/event.ts`(claude_events), `queries/system-prompt.ts`(system_prompts), `queries/request/write.ts` + `hook/persist.ts`(requests — createRequest/머지UPDATE/raw INSERT 3경로).
- 읽기: `routes/proxy.ts`·`cli/analyze.ts`·`scripts/backfill-system-prompts.ts`(proxy 무조건-zstd 가정 제거), `queries/request/{read,turn}.ts`·`domain/session-status.ts`(requests 서버측 복호), `queries/{event,system-prompt}.ts`.
- R10: `diag-log.ts`(0o600 + 경고).

### 설계 대비 변경점 (회의 결정 외 구현 중 발견)
1. **확정사실 #1 정정**: `requests.payload`는 TEXT(BLOB 아님). 021의 BLOB 추가가 migrator silent-skip됨.
2. **requests.payload_algo DEFAULT 'zstd' 함정**: 021이 넣은 죽은 기본값이라 기존 requests 행이 모두 algo='zstd'(거짓, 실제 평문). → (a) `decodeText`는 `'aes256gcm'`만 복호하고 그 외(NULL/'zstd'/미래값)는 평문 passthrough, (b) 056이 requests의 'zstd'를 NULL로 정리. proxy의 'zstd'는 실제 압축이라 불변.
3. **requests 복호 위치**: 회의는 normalizer 1지점을 제안했으나, 우회 경로(session-status 등) 누락 위험을 없애기 위해 **storage read 계층 전수 복호**로 구현(read.ts·turn.ts·session-status). 더 강한 커버리지.
4. **hook 머지 UPDATE corruption 차단**: pre→post 머지가 payload만 갱신하고 algo를 안 건드려 발생할 algo/값 불일치를 `payload_algo` 동기 갱신으로 차단.

### 테스트 (신규)
- `crypto.test.ts`(13), `payload-codec.test.ts`(+lenient), `encryption-runtime.test.ts`, `migration-056-*.test.ts`, `proxy-payload-encryption.test.ts`, `text-payload-encryption.test.ts`, `request-payload-encryption.test.ts`, `diag-log-permissions.test.ts` — 평문/zstd/암호문 혼재 round-trip + 키부재 예외 + 클라이언트 계약(평문 string 보장) + dedup 보존 + 0o600.

### 스펙 준수 체크 (ADR D1~D10)
D1 AES-256-GCM·random nonce·compress-then-encrypt ✓ / D2 payload_algo enum·base64-in-TEXT·proxy BLOB ✓ / D3 codec SSoT ✓ / D4 키 env>파일>자동생성·KDF/키체인 없음 ✓ / D5 옵트인 OFF 기본·읽기 항상 분기·기동실패 없음 ✓ / D6 056 additive ✓ / D7 requests 서버측 복호 ✓ / D8 system_prompts hash 평문 dedup ✓ / D9 R10 0o600+경고·미암호화 ✓ / D10 preview 등 파생 컬럼 범위 밖 문서화 ✓. R7: requests TEXT 유지(타입 변경 없음) → 비해당.
