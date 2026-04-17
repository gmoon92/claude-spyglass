# Dashboard Improvement 작업 목록

> 기반 문서: dashboard-improvement-plan.md, adr.md  
> 작성일: 2026-04-18 (검토 반영 후 갱신)  
> 총 태스크: 10개

---

## 태스크 목록

| ID | 태스크 | 선행 태스크 | 커밋 타입 |
|----|--------|------------|----------|
| T-01 | DB schema v4 + ORM — source 컬럼 추가 | - | feat ⚠️ |
| T-02 | collect.ts — source 필드 DB 저장 | T-01 | feat |
| T-03 | storage/api — avgDurationMs 집계 추가 | - | feat |
| T-04 | HTML — formatDuration 유틸 + 평균 응답시간 카드 | T-03 | feat |
| T-05a | HTML — promptPreview 통합 + FLAT_VIEW_COLS 상수화 | T-04 | feat |
| T-05b | HTML — renderDetailRequests 컬럼 개선 | T-05a | feat |
| T-06 | HTML — 최근 요청 테이블 컬럼 개선 | T-04, T-05a | feat |
| T-07 | HTML — 턴 뷰 토큰 입출력/응답시간 개선 | T-04, T-05a | feat |
| T-08 | HTML — 세션 상세 헤더 종료 시각 추가 | - | feat |
| T-09 | HTML — renderTools avg_tokens 표시 | - | feat |

---

## 의존성 그래프

```
T-01 → T-02

T-03 → T-04 → T-05a → T-05b
                    → T-06
                    → T-07

T-08  (독립)
T-09  (독립)
```

---

## T-01: DB schema v4 + ORM — source 컬럼 추가 ⚠️ 고위험

**선행 조건**: 없음

### 작업 내용

`schema.ts`에서 스키마를 v4로 올리고 `requests.source` 컬럼을 추가한다.  
ADR-001 결정에 따라 NULL 허용, 기본값 없음.  
ORM 레이어(Request 인터페이스, CreateRequestParams, SQL_CREATE_REQUEST)도 함께 수정한다.

### 구현 범위

- `packages/storage/src/schema.ts`:
  - `SCHEMA_VERSION` → `4`
  - `MIGRATION_V4` 상수 추가: `ALTER TABLE requests ADD COLUMN source TEXT`
  - `runMigrations()` 에 v4 분기 추가
  - `Request` 인터페이스에 `source?: string | null` 추가

- `packages/storage/src/index.ts` (또는 request.ts):
  - `CreateRequestParams` 인터페이스에 `source?: string | null` 추가
  - `SQL_CREATE_REQUEST` INSERT 구문에 `source` 컬럼 추가

### 커밋 메시지

```
feat(storage): schema v4 — requests.source 컬럼 추가
```

### 검증 명령어

```bash
cd /Users/gmoon/IdeaProjects/claude-code-system/workspace/claude-spyglass
bun run build
# 서버 실행 후 DB 확인:
# sqlite3 ~/.spyglass/db.sqlite ".schema requests"
# sqlite3 ~/.spyglass/db.sqlite "SELECT source FROM requests LIMIT 5"
```

### 완료 기준

- [ ] `SCHEMA_VERSION = 4`
- [ ] `requests` 테이블에 `source TEXT` 컬럼 존재 (NULL 허용, 기본값 없음)
- [ ] 기존 레코드의 `source`는 NULL
- [ ] `CreateRequestParams.source?: string | null` 추가됨
- [ ] `SQL_CREATE_REQUEST`에 source 컬럼 포함됨
- [ ] 빌드 성공

### 롤백 방법

```bash
git revert HEAD
# SQLite는 컬럼 DROP 불가 → 마이그레이션 전 DB 파일을 백업본으로 교체
# 백업: cp ~/.spyglass/db.sqlite ~/.spyglass/db.sqlite.bak.v3
```

---

## T-02: collect.ts — source 필드 DB 저장

**선행 조건**: T-01 완료 후

### 작업 내용

`packages/server/src/collect.ts`에서 `createRequest()` 호출 시 `source` 필드를 전달한다.

### 구현 범위

- `packages/server/src/collect.ts`:
  - `saveRequest()` 내 `createRequest()` 호출에 `source: payload.source ?? null` 추가
  - 빈 문자열 방어: `payload.source || null` (빈 문자열도 null 처리)

### 커밋 메시지

```
feat(collect): source 필드 DB 저장
```

### 검증 명령어

```bash
bun run build
# 서버 실행 후 훅 트리거:
# sqlite3 ~/.spyglass/db.sqlite "SELECT id, source FROM requests ORDER BY created_at DESC LIMIT 3"
```

### 완료 기준

- [ ] 빌드 성공
- [ ] 신규 수집 레코드에 `source` 값이 저장됨
- [ ] `source`가 없거나 빈 문자열인 페이로드 → null 저장

### 롤백 방법

```bash
git revert HEAD
```

---

## T-03: storage/api — avgDurationMs 집계 추가

**선행 조건**: 없음

### 작업 내용

`/api/dashboard` summary 응답에 `avgDurationMs` 필드를 추가한다.  
구현 전 `getRequestStats()`에 `avg_duration_ms`가 이미 존재하는지 확인하고, 있다면 신규 함수 생성 대신 기존 통계를 dashboard API에 연결한다.

### 구현 범위

- `packages/storage/src/index.ts`:
  - `getRequestStats()`에 avg_duration_ms가 없으면: `getAvgPromptDurationMs()` 함수 추가
  - 쿼리: `SELECT AVG(duration_ms) as avg FROM requests WHERE type = 'prompt' AND duration_ms > 0`
  - 반환: `Promise<number>` (결과 없을 시 0)

- `packages/server/src/api.ts`:
  - `/api/dashboard` 핸들러에서 집계 함수 호출
  - `summary` 응답에 `avgDurationMs: Math.round(avg)` 추가

### 커밋 메시지

```
feat(api): dashboard summary에 avgDurationMs 추가
```

### 검증 명령어

```bash
bun run build
# 서버 실행 후:
# curl http://localhost:4444/api/dashboard | jq '.summary.avgDurationMs'
# 숫자 또는 0이 반환되어야 함
```

### 완료 기준

- [ ] 빌드 성공
- [ ] `/api/dashboard` 응답의 `summary.avgDurationMs`가 숫자값으로 반환됨
- [ ] `duration_ms > 0`인 `prompt` 레코드가 없으면 `0` 반환
- [ ] `duration_ms = 0` 레코드는 집계에서 제외됨 (필터 적용 확인)

### 롤백 방법

```bash
git revert HEAD
```

---

## T-04: HTML — formatDuration 유틸 + 평균 응답시간 요약 카드

**선행 조건**: T-03 완료 후

### 작업 내용

공통 포맷 유틸 함수를 선언하고, 요약 카드 영역에 평균 응답시간 카드를 추가한다.

### 구현 범위

- `packages/web/index.html`:
  1. **유틸 함수 추가** (JS 유틸 섹션 최상단):
     ```js
     function formatDuration(ms) {
       if (ms === null || ms === undefined || isNaN(ms) || ms <= 0) return '—';
       if (ms < 1000) return `${ms}ms`;
       return `${(ms / 1000).toFixed(1)}s`;
     }
     ```
  2. **summary-grid CSS**:
     - `grid-template-columns: repeat(4,1fr)` → `repeat(auto-fit, minmax(140px, 1fr))`
  3. **카드 HTML 추가**:
     - 제목: `평균 응답시간`, 값 요소 ID: `avgDuration`
  4. **fetchDashboard() 바인딩**:
     - `document.getElementById('avgDuration').textContent = formatDuration(d.summary.avgDurationMs)`

### 커밋 메시지

```
feat(web): formatDuration 유틸 + 평균 응답시간 요약 카드 추가
```

### 검증 명령어

```bash
# 브라우저에서 대시보드 열어 요약 카드 확인
```

### 완료 기준

- [ ] `formatDuration(0)` → `'—'`
- [ ] `formatDuration(null)` → `'—'`
- [ ] `formatDuration(undefined)` → `'—'`
- [ ] `formatDuration(NaN)` → `'—'`
- [ ] `formatDuration(500)` → `'500ms'`
- [ ] `formatDuration(1500)` → `'1.5s'`
- [ ] 요약 카드 5개 표시 (평균 응답시간 카드 포함)
- [ ] 화면 폭 축소 시 카드가 자동 줄바꿈됨

### 롤백 방법

```bash
git revert HEAD
```

---

## T-05a: HTML — promptPreview 통합 + FLAT_VIEW_COLS 상수화

**선행 조건**: T-04 완료 후

### 작업 내용

버그 A/B/C 처리:
- A: colspan 하드코딩 → 상수 참조 (ADR-002)
- B: promptPreview 타입 가드 제거 → 모든 타입 payload 미리보기
- C: 턴 뷰 inline 미리보기 코드 제거 → promptPreview(r, 80) 호출로 교체

### 구현 범위

- `packages/web/index.html`:
  1. **상수 추가**:
     ```js
     const FLAT_VIEW_COLS = 6;
     ```
  2. **promptPreview(r, maxLen=60) 함수 수정**:
     - `if (r.type !== 'prompt' || !r.payload) return ''` → `if (!r.payload) return ''`
     - 두 번째 파라미터 `maxLen = 60` 추가
     - payload truncation: `payload.slice(0, maxLen)`
  3. **togglePromptExpand() colspan 수정**:
     - `colspan="5"` → `colspan="${FLAT_VIEW_COLS}"` (버그 A 수정)
  4. **플랫 뷰 내 모든 하드코딩 colspan**:
     - 빈 데이터 행, 로딩 행 등 `FLAT_VIEW_COLS` 참조로 교체
  5. **턴 뷰 inline 미리보기 코드 교체** (962행 근처):
     - 직접 구현된 80자 truncation → `promptPreview(r, 80)` 호출로 교체

### 커밋 메시지

```
feat(web): promptPreview 통합 및 FLAT_VIEW_COLS 상수화 (colspan 버그 수정)
```

### 검증 명령어

```bash
# 브라우저 플랫 뷰에서:
# - expand 행이 컬럼 범위 내 정상 렌더링 (버그 A)
# - tool_call, system 타입도 payload 미리보기 표시 (버그 B)
# - 턴 뷰 payload 미리보기가 promptPreview 결과와 동일 (버그 C)
```

### 완료 기준

- [ ] `FLAT_VIEW_COLS = 6` 상수 선언됨
- [ ] expand 행이 컬럼 경계를 벗어나지 않음
- [ ] prompt/tool_call/system 모두 payload 미리보기 표시됨
- [ ] 턴 뷰 inline 중복 구현 제거됨

### 롤백 방법

```bash
git revert HEAD
```

---

## T-05b: HTML — renderDetailRequests 컬럼 개선

**선행 조건**: T-05a 완료 후

### 작업 내용

버그 D 처리. 플랫 뷰 헤더와 `renderDetailRequests()` 렌더링 로직을 개선한다.

### 구현 범위

- `packages/web/index.html`:
  1. **플랫 뷰 헤더 수정**:
     - `<th>토큰</th>` → `<th>IN</th><th>OUT</th><th>응답시간</th>` (총 컬럼: 6)
  2. **renderDetailRequests() 수정**:
     - `tokens_total` 단일 셀 → `tokens_input || '—'`, `tokens_output || '—'`, `formatDuration(r.duration_ms)` 3개 셀
     - model 배지 추가 (r.model이 있을 경우)

### 커밋 메시지

```
feat(web): 플랫 뷰 토큰 입출력 분리 및 응답시간 컬럼 추가
```

### 검증 명령어

```bash
# 브라우저 세션 상세 → 플랫 뷰:
# - 헤더: IN | OUT | 응답시간
# - 각 행의 IN/OUT/응답시간 값 표시
```

### 완료 기준

- [ ] 플랫 뷰 헤더: 시각 | 타입 | 툴 | IN | OUT | 응답시간
- [ ] tokens_input/output이 0 또는 null이면 `—` 표시
- [ ] formatDuration 적용된 응답시간 표시

### 롤백 방법

```bash
git revert HEAD
```

---

## T-06: HTML — 최근 요청 테이블 컬럼 개선

**선행 조건**: T-04, T-05a 완료 후

### 작업 내용

버그 E 처리. 최근 요청 테이블의 토큰/응답시간 컬럼을 개선한다.

### 구현 범위

- `packages/web/index.html`:
  1. **상수 추가**:
     ```js
     const RECENT_REQ_COLS = 7;
     ```
  2. **최근 요청 테이블 헤더 수정**:
     - `<th>토큰</th>` → `<th>IN</th><th>OUT</th><th>응답시간</th>`
  3. **renderRequests() 수정**:
     - `tokens_total` 단일 셀 → `tokens_input || '—'`, `tokens_output || '—'`, `formatDuration(r.duration_ms)` 3개 셀
  4. **빈 데이터/로딩 행 colspan 수정**:
     - 하드코딩 colspan → `RECENT_REQ_COLS` 참조

### 커밋 메시지

```
feat(web): 최근 요청 테이블 토큰 입출력 분리 및 응답시간 추가
```

### 검증 명령어

```bash
# 브라우저 대시보드 메인 → 최근 요청 테이블:
# - 헤더: IN | OUT | 응답시간 | 세션 ID
# - 빈 테이블 상태에서 colspan 전체 너비 차지
```

### 완료 기준

- [ ] `RECENT_REQ_COLS = 7` 상수 선언됨
- [ ] 최근 요청 헤더: 시각 | 타입 | 툴 | IN | OUT | 응답시간 | 세션 ID
- [ ] 0/null tokens → `—` 표시

### 롤백 방법

```bash
git revert HEAD
```

---

## T-07: HTML — 턴 뷰 토큰 입출력/응답시간 개선

**선행 조건**: T-04, T-05a 완료 후

### 작업 내용

버그 F/G 처리. 턴 뷰 prompt 행과 헤더를 개선한다.

### 구현 범위

- `packages/web/index.html`:
  1. **턴 뷰 CSS grid 컬럼 수정**:
     - `28px 1fr 60px 60px 80px` → `28px 1fr 50px 50px 70px 80px`
  2. **prompt 행 수정** (현재 빈 `<span></span>` 있는 979행 근처):
     - 토큰: `IN {tokens_input ?? '—'} / OUT {tokens_output ?? '—'}` 분리 표시
     - 빈 duration 셀: `formatDuration(r.duration_ms)` 추가 (버그 F 수정)
  3. **tool_call / system 행**: 새 IN/OUT 컬럼 위치에 빈 셀 추가 (grid 정합성)
  4. **턴 헤더 수정** (999-1000행 근처, 버그 G 수정):
     - 기존: meta 문자열 + 별도 `<span class="turn-tokens">` (중복)
     - 변경: `도구 N개 · IN Xk / OUT Xk · ⏱ formatDuration(totalDuration)` 단일 표시
     - `<span class="turn-tokens">` 제거

### 커밋 메시지

```
feat(web): 턴 뷰 prompt 행 토큰 입출력·응답시간 표시 개선
```

### 검증 명령어

```bash
# 브라우저 세션 상세 → 턴 뷰:
# - prompt 행: IN X / OUT Y 분리 표시
# - prompt 행: 응답시간 표시
# - 턴 헤더: total_tokens 한 곳에만 표시
# - tool_call/system 행 grid 정렬 정상
```

### 완료 기준

- [ ] prompt 행: IN/OUT 분리 표시
- [ ] prompt 행: `formatDuration` 응답시간 표시 (버그 F 수정)
- [ ] 턴 헤더: total_tokens 중복 없음 (버그 G 수정)
- [ ] prompt가 없는 턴: IN/OUT 모두 `—` 표시
- [ ] tool_call/system 행의 grid 정합성 유지

### 롤백 방법

```bash
git revert HEAD
```

---

## T-08: HTML — 세션 상세 헤더 종료 시각 추가

**선행 조건**: 없음

### 작업 내용

세션 상세 헤더에 종료 시각을 추가한다.

### 구현 범위

- `packages/web/index.html`:
  1. **세션 상세 헤더 HTML**:
     - `detailTokens` 요소 옆에 `detailEndedAt` 요소 추가
  2. **렌더링 함수 수정**:
     ```js
     const endedAt = session.ended_at
       ? new Date(session.ended_at).toLocaleTimeString()
       : null;
     document.getElementById('detailEndedAt').textContent =
       endedAt ? `종료: ${endedAt}` : '';
     ```

### 커밋 메시지

```
feat(web): 세션 상세 헤더에 종료 시각 추가
```

### 검증 명령어

```bash
# 브라우저:
# - 활성 세션 클릭 → 종료 시각 미표시
# - 종료된 세션 클릭 → 종료: HH:MM:SS 표시 (로컬 시각)
```

### 완료 기준

- [ ] 활성 세션: 종료 시각 표시 없음
- [ ] 종료 세션: `종료: HH:MM:SS` 표시 (로컬 시각)
- [ ] `ended_at` 값이 UTC로 저장된 경우 로컬 시각으로 변환됨

### 롤백 방법

```bash
git revert HEAD
```

---

## T-09: HTML — renderTools avg_tokens 표시

**선행 조건**: 없음

### 작업 내용

버그 H 처리. API가 이미 `avg_tokens`를 반환하지만 `renderTools()`에서 렌더링하지 않는 문제를 수정한다.  
backend 변경 없음, HTML 렌더러 수정만.

### 구현 범위

- `packages/web/index.html`:
  - `renderTools()` 함수에서 각 툴 항목에 `avg_tokens` 표시 추가
  - 표시 형식: `평균 X토큰` (기존 `fmtToken()` 함수 재사용)
  - `avg_tokens`가 0 또는 null이면 표시 생략

### 커밋 메시지

```
feat(web): renderTools에 avg_tokens 컬럼 추가
```

### 검증 명령어

```bash
# 브라우저 세션 상세 → 툴 통계 탭:
# - 각 툴 항목에 평균 토큰 표시됨
```

### 완료 기준

- [ ] 툴 통계에 평균 토큰 표시됨 (`평균 X토큰`)
- [ ] `avg_tokens = 0` 또는 null이면 표시 생략

### 롤백 방법

```bash
git revert HEAD
```
