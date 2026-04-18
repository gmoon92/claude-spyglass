# tui-badge-prompt-content 검증 보고서

> Feature: tui-badge-prompt-content
> 검증일: 2026-04-18
> 상태: ✅ 검증 완료

---

## 검증 체크리스트

### 1. 태스크 구현 검증 (tasks.md 기반)

#### Phase 1 — Formatter 클래스
- [x] T-01: RequestTypeFormatter 클래스 생성 ✅
  - `packages/tui/src/formatters/RequestTypeFormatter.ts` 존재
  - RequestType union type, TYPE_CONFIG const assertion, 5개 정적 메서드 + formatDisplay() 확인
- [x] T-02: TokenFormatter 클래스 생성 ✅
  - `packages/tui/src/formatters/TokenFormatter.ts` 존재
  - `format()`: 1000 → "1.0K", 1000000 → "1.0M" 변환 로직 확인
- [x] T-03: TimeFormatter 클래스 생성 ✅ (요구사항 초과 충족)
  - `packages/tui/src/formatters/TimeFormatter.ts` 존재
  - formatDate(), formatTime(), formatDuration() 모두 존재
  - 추가: `formatTime24h()` (LiveTab 24시간 표시용, 요구사항 초과)
- [x] T-04: formatters index.ts 생성 ✅
  - 3개 클래스 + RequestType 타입 모두 통합 export

#### Phase 2 — 컴포넌트 리팩토링
- [x] T-05: LiveTab — 인라인 함수 전체 제거, formatters import 사용 ✅
- [x] T-06: HistoryTab — 인라인 함수 전체 제거, formatters import 사용 ✅
- [x] T-07: RequestList — 인라인 함수 전체 제거, formatters import 사용 ✅
- [x] T-08: AnalysisTab — 인라인 함수 전체 제거, formatters import 사용 ✅

#### Phase 3 — 프롬프트 preview 표시
- [x] T-09: schema.ts preview 필드 추가 ✅
  - `Request.preview?: string | null` 필드 존재
  - `MIGRATION_V7`: `ALTER TABLE requests ADD COLUMN preview TEXT`
  - `SCHEMA_VERSION = 7`
- [x] T-09-b: connection.ts V7 마이그레이션 실행 로직 ✅
  - `MIGRATION_V7` import 및 `runMigrations()` 내 실행
- [x] T-10: collect.ts preview 추출 로직 ✅
  - `extractPreview()` 함수: hook payload.prompt → 100자 축약
  - `CollectPayload.preview` 필드 존재
  - `saveRequest()` 호출 시 preview 전달
- [x] T-10-b: queries/request.ts preview 지원 ✅
  - `CreateRequestParams.preview` 필드, SQL INSERT에 preview 컬럼 포함
- [x] T-11: LiveTab preview 서브라인 표시 ✅
  - `RecentRequest.preview?: string | null` 필드
  - `↳ {req.preview}` JSX 렌더링 로직 존재
- [x] T-12: HistoryTab Preview 컬럼 추가 ✅
  - `SessionRequest.preview?: string | null` 필드
  - 상세 뷰에 Preview 컬럼 헤더 및 `req.preview` 렌더링

---

### 2. ADR 결정 준수 검증

- [x] ADR-010-B: 클래스 기반 정적 메서드 패턴 채택 ✅
  - 모든 Formatter가 `class` 선언 + `static` 메서드만 사용
- [x] `TYPE_CONFIG`가 `as const satisfies Record<RequestType, ...>` 패턴 ✅
- [x] `RequestType` union type 정의 ('prompt' | 'tool_call' | 'system') ✅
- [x] `packages/tui/src/formatters/` 디렉토리 구조 ✅

---

### 3. 기능 요구사항 검증

- [x] R1: 타입 뱃지 로직 모듈화 ✅ — 4개 컴포넌트 인라인 중복 완전 제거
- [x] R2: 사용자 프롬프트 내용 표시 ✅ — preview 수집 + DB 저장 + TUI 렌더링
- [x] R3: 포맷팅 유틸리티 통합 ✅ — formatters/ 단일 진입점(index.ts)

---

### 4. 웹 UI 검증 (Playwright)

- [x] UI-01: 웹 대시보드(http://localhost:9999) 정상 로드 ✅
  - "Claude Spyglass" 타이틀, 헤더/차트/테이블 정상 렌더링
  - 총 세션 14, 총 요청 537, 총 토큰 703.4K 표시 확인
- [x] UI-02: API `/api/requests` 응답에 preview 필드 포함 ✅
  - preview 키 존재 확인 (현재 값은 null — 기존 수집 데이터는 미적용, 신규부터 채워짐)
- [x] UI-03: 대시보드 UI 렌더링 정상 ✅
  - 요청 추이 차트, 타입 도넛 차트 (tool_call 94% / prompt 6%), 최근 요청 테이블 정상

---

## 검증 결과

### 코드 검증
✅ formatters/ 4개 파일 존재 및 정상 export  
✅ RequestTypeFormatter: 5개 메서드 + formatDisplay() 추가 (요구사항 초과 충족)  
✅ TokenFormatter: K/M 단위 변환 로직 정확  
✅ TimeFormatter: 요구사항 3개 메서드 + formatTime24h() 추가  
✅ 4개 컴포넌트 인라인 함수 전체 제거 확인  
✅ schema.ts: preview 필드, MIGRATION_V7, SCHEMA_VERSION=7  
✅ collect.ts: extractPreview() 함수, 100자 축약 로직  
✅ LiveTab/HistoryTab: preview 렌더링 로직 존재  
✅ TypeScript 타입 오류 없음 (bun tsc --noEmit 통과)

> ⚠️ 비고: schema.ts에서 MIGRATION_V7이 V6보다 위에 정의됨.
> 그러나 connection.ts의 마이그레이션 로직이 컬럼 존재 여부로 동적 실행하므로 실제 동작에 영향 없음.

### 웹 UI 검증
✅ 서버(localhost:9999) 정상 응답  
✅ 대시보드 전체 UI 오류 없이 렌더링  
✅ `/api/requests` 응답에 preview 필드 키 존재 확인  
✅ 스크린샷 저장: `screenshots/dashboard-main.png`

> ⚠️ 비고: 기존 수집 데이터의 preview 값이 null인 것은 정상.
> extractPreview()는 신규 수집 시점부터 적용되므로 이후 프롬프트 요청부터 채워짐.

---

## 종합 결과

**✅ 검증 완료 — 전 항목 통과**

| 구분 | 통과 | 실패 | 비고 |
|------|------|------|------|
| 태스크 구현 (T-01~T-12) | 12/12 | 0 | |
| ADR 결정 준수 | 4/4 | 0 | |
| 기능 요구사항 (R1~R3) | 3/3 | 0 | |
| 웹 UI (Playwright) | 3/3 | 0 | preview 값은 신규 요청부터 채워짐 |
| **합계** | **22/22** | **0** | |
