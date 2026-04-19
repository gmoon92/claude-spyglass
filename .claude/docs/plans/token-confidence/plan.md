# Feature Plan — token-confidence

> 근거: `.claude/docs/evaluation/spyglass-10round-evaluation/03-token-accuracy.md`, `12-critical-issues.md`
> 우선순위: **P0**
> 예상 소요: 1~2 일

---

## 1. 작업 목표

**`parseTranscript` 실패 시 `0`으로 silent 저장되는 문제를 `null + confidence` 표기로 전환하여 대시보드 신뢰도를 회복한다.**

### 핵심 전환
- 기존: `const tokensInput = transcriptData?.inputTokens ?? 0`
- 신규: `const tokensInput = transcriptData?.inputTokens ?? null`
- 신규 컬럼: `tokens_confidence` (`'high'` | `'error'`), `tokens_source` (`'transcript'` | `'unavailable'`)
- UI 인디케이터: `12,456 ✓` / `-- ⚠️`

### 비목표
- 환경변수 기반 대체 수집 (`CLAUDE_USAGE`) — 별도 라운드에서 가능성 검증 후
- 추정(`estimated`) 레벨 — transcript fallback 외 수단이 없어 지금은 2단계(`high`/`error`)만

---

## 2. 변경 범위

### 2.1 편집 파일

| 파일 | 변경 내용 |
|------|----------|
| `packages/server/src/collect.ts` | `parseTranscript` 반환 타입을 `TokenResult`로 확장, fallback 값을 `null`로 |
| `packages/storage/src/schema.ts` | `MIGRATION_V11` 추가 — `tokens_confidence`, `tokens_source` 컬럼 |
| `packages/storage/src/queries/request.ts` | INSERT·SELECT에 신규 컬럼 반영, 통계 쿼리에서 `tokens_confidence='error'` 행 처리 |
| `packages/server/src/api.ts` | API 응답 스키마에 confidence 필드 노출 |
| `packages/web/assets/js/renderers.js` | 토큰 셀 렌더링 시 confidence 인디케이터 추가 |
| `packages/web/assets/js/api.js` | SSE·REST 응답의 신규 필드 수용 |
| `packages/web/assets/css/tool-stats.css` 또는 `design-tokens.css` | `✓`/`⚠️` 인디케이터 색상 |

### 2.2 스키마 변경 (V11)

```sql
-- MIGRATION_V11
ALTER TABLE requests ADD COLUMN tokens_confidence TEXT DEFAULT 'high';
ALTER TABLE requests ADD COLUMN tokens_source TEXT DEFAULT 'transcript';

-- 기존 행: tokens_input·output이 0이면서 type='prompt'인 경우 'error'로 표기 (선택사항)
UPDATE requests
SET tokens_confidence = 'error', tokens_source = 'unavailable'
WHERE type = 'prompt'
  AND tokens_input = 0
  AND tokens_output = 0
  AND event_type IS NULL;
```

> 주의: 백필 UPDATE는 사용자 동의 후. 기존 0값이 진짜 0인지 실패였는지 구분 불가 — 기본값 `'high'`로 두고 신규 행부터 적용하는 것이 안전.

---

## 3. 단계별 실행 계획

### Step 1 — 타입 정의 (30분)
```typescript
// packages/server/src/collect.ts
export interface TokenResult {
  value: number | null;
  confidence: 'high' | 'error';
  source: 'transcript' | 'unavailable';
  error?: string;
}

interface TranscriptUsage {
  inputTokens: TokenResult;
  outputTokens: TokenResult;
  cacheCreationTokens: TokenResult;
  cacheReadTokens: TokenResult;
  model: string | null;
}
```

### Step 2 — `parseTranscript` 리팩터링 (1h)
- 파일 미존재 → `{value: null, confidence: 'error', source: 'unavailable', error: 'NOT_FOUND'}`
- JSON 파싱 실패 → `error: 'PARSE_ERROR'`
- usage 필드 부재 → `error: 'NO_USAGE'`
- 성공 → `{value: n, confidence: 'high', source: 'transcript'}`

### Step 3 — 마이그레이션 V11 추가 (1h)
- `schema.ts`에 `MIGRATION_V11` 상수
- `SCHEMA_VERSION` 10 → 11
- `connection.ts`의 마이그레이션 러너가 V11 처리 확인
- 백필 UPDATE는 **선택사항** — 기본값 유지 권장

### Step 4 — 쿼리·INSERT 로직 (1h)
- `insertRequest`에 `tokens_confidence`, `tokens_source` 포함
- `getRequestStats`·`getTokenStats` 쿼리에서 `tokens_confidence = 'error'` 행 제외 또는 별도 집계
- 예: `WHERE tokens_confidence = 'high'` 추가 또는 `SUM(CASE WHEN tokens_confidence='high' THEN tokens_input ELSE 0 END)`

### Step 5 — UI 렌더링 (1~2h)
- `renderers.js` 토큰 셀:
  ```javascript
  function tokenCellHtml(value, confidence) {
    if (confidence === 'error') return '<span class="token-error" title="Transcript 읽기 실패">--</span>';
    return `<span class="token-ok">${fmtNum(value)}</span>`;
  }
  ```
- Summary Strip 총 토큰도 동일 처리 (단, confidence='error' 건수를 별도 경고 표시)

### Step 6 — 검증 (2h)
- 단위 테스트: `parseTranscript`에 존재/부재/손상 파일 입력
- 통합 테스트: 실제 Claude Code 세션으로 `spyglass.db` 확인
- UI: 인위적으로 transcript 삭제 후 대시보드 확인
- 마이그레이션: 기존 DB에서 V10 → V11 업그레이드 성공 확인

### Step 7 — 커밋 (30분)
- `git:commit` 스킬 사용
- 메시지: `feat(token): 수집 신뢰도(confidence) 표기 도입 — silent 0 저장 제거`

---

## 4. 리스크 및 완화

| 리스크 | 확률 | 완화 |
|--------|------|------|
| 기존 대시보드의 total·avg 계산이 confidence='error' 행으로 왜곡 | 높음 | 통계 쿼리에 confidence 필터 추가 |
| 마이그레이션 V11 실패 시 롤백 경로 없음 | 중간 | 실행 전 `.spyglass.db.bak` 수동 백업 안내 |
| 기존 DB의 0 토큰 행을 어떻게 처리할지 정책 미합의 | 중간 | 기본값 `'high'` 유지 — 과거 데이터는 보수적으로 신뢰 |

---

## 5. CLAUDE.md 지침 적용

- **data-engineer 서브에이전트 위임** — 스키마 변경·마이그레이션은 해당 에이전트에게 Step 3~4 위임
- **LSP 우선** — 타입 변경 파급 범위 확인 시 LSP `find references` 활용

---

## 6. 완료 기준

- [ ] `TokenResult` 타입 정의
- [ ] `parseTranscript` fallback이 `null`로 동작
- [ ] `MIGRATION_V11` 통과 (SCHEMA_VERSION=11)
- [ ] 통계 쿼리가 confidence='error' 행 제외
- [ ] UI에 `--` / `⚠️` 표시 동작
- [ ] 인위적 실패 시나리오 테스트 통과
- [ ] 커밋 완료

---

## 7. 후속 작업 (별도 라운드)

- 환경변수 대체 수집 (`CLAUDE_USAGE`) 가능성 ADR
- `estimated` 레벨 도입 (Claude 토크나이저 근사치)
- UI 경고 배너 (`오늘 N건의 수집 실패`)
