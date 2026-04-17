# UX 분석 보고서 — Claude Spyglass 대시보드

> 작성일: 2026-04-18  
> 분석 기준: 소스 코드 및 이벤트 흐름 실증 분석  
> 방법론: 4인 페르소나 시나리오 기반 교차 검증

---

## 분석 페르소나

| 코드 | 페르소나 | 연차 | 주요 관심사 |
|------|----------|------|------------|
| **Alex** | 주니어 개발자 | 1년차 | Claude Code 처음 사용, 데이터 맥락 이해 |
| **미나** | 시니어 백엔드 개발자 | 7년차 | 데이터 정확성, 정렬 일관성, 신뢰성 |
| **준혁** | AI/프롬프트 엔지니어 | 3년차 | 토큰 비용 최적화, 모델 성능 분석 |
| **재영** | 팀 리드/아키텍트 | 12년차 | 팀 사용 추이, 비용 관리, 병목 파악 |

---

## 심각도 HIGH — 즉시 수정 필요

### H1. 턴 뷰 정렬이 오름차순

**증상**: 세션 상세 > 턴 뷰에서 가장 오래된 턴이 맨 위에 표시됨  
**코드 위치**: `packages/storage/src/queries/request.ts:508`

```sql
-- 현재 (오름차순)
ORDER BY timestamp ASC

-- 기대 (내림차순 — 최신 작업이 맨 위)
ORDER BY timestamp DESC
```

**영향**: 플랫 뷰는 `DESC`, 턴 뷰는 `ASC`로 모순. 탭을 전환할 때마다 스크롤 방향이 반전됨  
**발생 페르소나**: Alex, 미나, 준혁 (전 페르소나)  
**담당 역할**: 백엔드 개발자 (쿼리 수정) + 프론트엔드 개발자 (렌더 순서 확인)

---

### H2. 세션 목록 정렬 미보장

**증상**: 프로젝트 클릭 시 표시되는 세션 목록이 최신순으로 정렬되지 않음  
**코드 위치**: `packages/web/index.html:957` — `renderBrowserSessions`

```js
// 현재 — filter만 있고 sort 없음
const list = allSessions.filter(s => s.project_name === selectedProject);

// 수정안
const list = allSessions
  .filter(s => s.project_name === selectedProject)
  .sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
```

**영향**: API 응답 순서에 의존하여 오래된 세션이 상단에 노출될 수 있음  
**발생 페르소나**: Alex (최신 세션을 찾지 못함), 재영 (오늘 작업 파악 불가)  
**담당 역할**: 프론트엔드 개발자

---

### H3. 세션 상세 뷰 열린 상태에서 SSE 갱신 미반영

**증상**: 세션 상세를 열어놓고 작업 중일 때, 새 요청이 와도 상세 뷰가 업데이트되지 않음  
**코드 위치**: `packages/web/index.html:1201`

```js
// 현재 — 세션 상세 갱신 없음
sseSource.addEventListener('new_request', () => {
  fetchDashboard();
  fetchRequests();
  fetchAllSessions();
  // selectSession(selectedSession) 호출 없음
});

// 수정안: selectedSession이 있으면 재갱신
if (selectedSession) selectSession(selectedSession);
```

**영향**: 실시간 모니터링 목적으로 세션을 열어도 데이터가 고정됨. 수동으로 세션을 다시 클릭해야 갱신됨  
**발생 페르소나**: 재영 (활성 세션 실시간 추적 불가), 준혁 (진행 중인 작업 토큰 확인 불가)  
**담당 역할**: 프론트엔드 개발자

---

## 심각도 MEDIUM — 중요하지만 즉각 위험 없음

### M1. 프롬프트 원문 확인 불가

**증상**: 프롬프트 미리보기가 60자(플랫뷰)/80자(턴뷰)로 잘리며, 클릭해서 펼쳐도 500자 한도  
**코드 위치**: `packages/web/index.html:835` (60자), `line:1098` (80자), `line:843` (500자 제한)

```js
// 현재
const display = text.length > MAX ? text.slice(0, MAX) + `\n…(총 ${text.length}자)` : text;

// 수정안: "전체 보기" 버튼 → 모달 또는 별도 패널
```

**영향**: 대형 컨텍스트(50k+ 토큰)를 쓴 프롬프트 분석 불가. 원문 확인 위해 DB 직접 조회 필요  
**발생 페르소나**: Alex ("뭘 보냈는데?"), 준혁 (프롬프트 품질 분석)  
**담당 역할**: 프론트엔드 개발자 (UI 확장), 백엔드 개발자 (payload 전문 API 필요 시)

---

### M2. tool_detail 누락 시 툴콜 내용 전혀 알 수 없음

**증상**: `tool_detail`이 null이면 툴 이름(Read, Bash, Edit)만 표시  
**코드 위치**: `packages/web/index.html:810` — `toolLabel()`, 훅 스크립트 캡처 로직

```
현재 표시: Read
기대 표시: Read  /src/components/App.tsx
```

**영향**: 훅이 tool_detail을 캡처하지 못하면 "무엇을" 했는지 전혀 알 수 없음  
**발생 페르소나**: Alex ("툴콜인데 리드? 뭘 읽었는데?"), 미나 (작업 내역 검증 불가)  
**담당 역할**: DevOps/훅 담당자 (collect.sh 파싱 강화), 백엔드 개발자 (tool_detail 저장 검증)

---

### M3. 툴 통계 GROUP BY가 과도하게 세분화됨

**증상**: `tool_name + tool_detail`로 그룹핑되어 같은 툴이 파일마다 별도 행으로 표시됨  
**코드 위치**: `packages/storage/src/queries/request.ts:421`

```sql
-- 현재: Read가 파일마다 별개 행
GROUP BY tool_name, tool_detail

-- 수정안: 툴 요약은 tool_name만, 드릴다운에서 detail 표시
GROUP BY tool_name
```

**영향**: "Read가 총 몇 번 호출됐나?" 단순 통계도 직접 합산해야 함  
**발생 페르소나**: 미나, 재영  
**담당 역할**: 백엔드 개발자 + 프론트엔드 개발자

---

### M4. 턴 뷰에서 tool_call의 IN 토큰이 항상 "—"

**증상**: 플랫 뷰는 IN/OUT 분리 표시, 턴 뷰는 `tokens_total`만 표시  
**코드 위치**: `packages/storage/src/queries/request.ts:465` — `TurnToolCall` 인터페이스

```typescript
// 현재 — total만
interface TurnToolCall {
  tokens_total: number;
}

// 수정안 — in/out 추가
interface TurnToolCall {
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
}
```

**코드 위치 (렌더)**: `packages/web/index.html:1112` — 턴뷰 tool_call 행의 IN 열이 하드코딩 "—"  
**발생 페르소나**: 준혁 (tool_call 비용 세부 분석)  
**담당 역할**: 백엔드 개발자 (인터페이스 + 쿼리), 프론트엔드 개발자 (렌더 수정)

---

### M5. 모델별 토큰 통계 없음

**증상**: `requests.model` 컬럼은 DB에 있으나 집계 쿼리와 UI에 표시되지 않음  
**영향**: Opus/Sonnet/Haiku 사용 비율 파악 불가, 비용 최적화 분석 불가  
**발생 페르소나**: 준혁, 재영  
**담당 역할**: 백엔드 개발자 (집계 쿼리 추가), 프론트엔드 개발자 (통계 패널 추가)

---

### M6. 세션 지속 시간 미표시

**증상**: 세션 목록에 시작 시간만 있고, `ended_at - started_at`으로 계산 가능한 지속 시간 없음  
**발생 페르소나**: 재영 ("3시간에 50만 토큰" vs "30분에 50만 토큰"은 완전히 다른 상황)  
**담당 역할**: 프론트엔드 개발자 (계산 및 표시 추가)

---

## 심각도 LOW — 개선 과제

| # | 이슈 | 담당 역할 |
|---|------|-----------|
| L1 | 날짜/기간 필터 없음 (오늘, 이번 주, 커스텀) | 풀스택 |
| L2 | SSE `new_request` 시 `/api/sessions?limit=500` 전체 재조회 (성능) | 백엔드 + 프론트엔드 |
| L3 | 타임라인 차트 버킷 클릭 시 해당 시간대 요청으로 이동 없음 | 프론트엔드 |
| L4 | 평균 응답시간 레이블 불명확 (prompt만인지 전체인지) | 백엔드 + 프론트엔드 |
| L5 | 세션에 의미있는 식별자 없음 (첫 프롬프트 요약 등) | 풀스택 |
| L6 | 캐시 토큰 (`cache_read_input_tokens`) 스키마에 없음 | 백엔드 (스키마 확장) |

---

## 코드 품질 이슈 (진단 도구 발견)

| 파일 | 라인 | 이슈 | 담당 역할 |
|------|------|------|-----------|
| `connection.ts` | 19, 22 | `CONNECT_TIMEOUT_MS`, `RETRY_INTERVAL_MS` 선언만 있고 미사용 | 백엔드 |
| `connection.ts` | 130, 140, 145, 150 | deprecated `db.run()` API 4곳 사용 | 백엔드 |
| `api.ts` | 18 | `getRequestsWithFilter` import됐으나 미사용 | 백엔드 |
| `request.ts` | 265, 278, 290, 305 | `(db as any).run()` — 타입 안전성 낮음 | 백엔드 |

---

## 담당 역할별 이슈 요약

### 프론트엔드 개발자

> 주로 `packages/web/index.html` 담당

- H1 (턴 뷰 정렬 반영)
- H2 (세션 목록 sort 추가)
- H3 (SSE 상세뷰 갱신)
- M1 (프롬프트 전체 보기 UI)
- M4 (턴뷰 IN/OUT 렌더)
- M5 (모델별 통계 패널)
- M6 (세션 지속 시간 표시)
- L3 (타임라인 인터랙션)

### 백엔드 개발자

> 주로 `packages/storage/`, `packages/server/` 담당

- H1 (getTurnsBySession ORDER BY 수정)
- M3 (툴 통계 GROUP BY 개선)
- M4 (TurnToolCall 인터페이스 확장)
- M5 (모델별 집계 쿼리 추가)
- L6 (캐시 토큰 스키마 확장)
- 코드 품질 이슈 전반 (deprecated API, 미사용 코드)

### DevOps / 훅 담당자

> 주로 `hooks/spyglass-collect.sh` 담당

- M2 (tool_detail 캡처 강화 — 훅 스크립트 파싱 개선)

### 풀스택 / 팀 리드

- L1 (날짜 필터 — API + UI 모두 변경)
- L2 (SSE 성능 개선 — 이벤트 데이터 포함 방식으로 전환)
- L5 (세션 식별자 — 스키마 + UI)

---

## 수정 우선순위 로드맵

```
Phase 1 (즉시, 1-2일)
  ├── H1: 턴 뷰 ORDER BY DESC 수정
  ├── H2: 세션 목록 sort 추가
  └── H3: SSE → 상세뷰 자동 갱신

Phase 2 (단기, 1주)
  ├── M1: 프롬프트 전체 보기
  ├── M2: tool_detail 훅 캡처 강화
  ├── M3: 툴 통계 GROUP BY 개선
  ├── M4: 턴뷰 IN/OUT 분리
  └── 코드 품질 이슈 정리

Phase 3 (중기, 2-4주)
  ├── M5: 모델별 통계
  ├── M6: 세션 지속 시간
  ├── L1: 날짜 필터
  └── L2: SSE 성능 개선

Phase 4 (장기)
  ├── L5: 세션 식별자
  ├── L6: 캐시 토큰 스키마
  └── L3: 타임라인 인터랙션
```
