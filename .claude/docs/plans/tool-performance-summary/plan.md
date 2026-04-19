# tool-performance-summary 개발 계획

> Feature: tool-performance-summary
> 작성일: 2026-04-19
> 작성자: Claude Code

## 목표

세션 상세 뷰에 "도구" 탭을 추가하고, 도구별 성능 지표(응답시간·호출횟수·에러율·토큰 기여도)를
한눈에 파악할 수 있는 Tool Performance Summary 패널을 구현한다.
"어떤 도구가 느리고, 실패가 많고, 비용이 가장 비싼가"를 세션 단위로 분석 가능하게 한다.

## 전제 조건

- 백엔드 `GET /api/sessions/:sessionId/tool-stats` 이미 완료
- 응답: `{ success: true, data: SessionToolStats[] }`
- `SessionToolStats` 필드: `tool_name, call_count, avg_duration_ms, max_duration_ms, total_tokens, avg_tokens, error_count, pct_of_total_tokens`

## 범위

- 포함:
  - `packages/web/assets/js/tool-stats.js` 신규 생성
  - `packages/web/assets/css/tool-stats.css` 신규 생성
  - `packages/web/index.html` — 탭 버튼 + 컨테이너 추가
  - `packages/web/assets/js/session-detail.js` — 탭 연동 수정
- 제외:
  - 백엔드 API, DB 스키마, 마이그레이션 (이미 완료)
  - 전역 필터(프로젝트/날짜) 연동 (세션 단위 탭이므로 불필요)

## 단계별 계획

### 1단계: CSS 스타일 작성 (`tool-stats.css`)
- `.tool-stats-section`, `.tool-stats-title`, `.tool-stats-row` 레이아웃
- `.tool-stats-bar-wrap`, `.tool-stats-bar`, `.tool-stats-bar.is-token` 바 차트
- `.call-count-badge`, `.error-badge` 뱃지 스타일
- 기존 CSS 변수만 사용 (하드코딩 색상 금지)

### 2단계: JS 모듈 작성 (`tool-stats.js`)
- `loadToolStats(sessionId)` — API 호출 → `renderToolStats()` 위임
- `clearToolStats()` — 패널 초기화
- `renderToolStats(stats)` — 3개 섹션 HTML 렌더링
  - 섹션 1: 평균 응답시간 바 차트 (avg_duration_ms DESC 정렬)
  - 섹션 2: 호출 횟수 / 에러 뱃지 (call_count DESC 정렬)
  - 섹션 3: 토큰 기여도 바 차트 (pct_of_total_tokens DESC 정렬)
- `fmtDur`, `fmtToken` formatters.js에서 import

### 3단계: HTML 수정 (`index.html`)
- `<head>`에 `tool-stats.css` 링크 추가
- 탭바에 `<button id="tabTools">도구</button>` 추가
- `#detailGanttView` 다음에 `#detailToolsView` 컨테이너 추가

### 4단계: JS 연동 (`session-detail.js`)
- `import { loadToolStats, clearToolStats }` 추가
- `_currentSessionId` 상태 변수 추가
- `setDetailView(tab)` — `tools` 탭 분기 추가
- `loadSessionDetail(sessionId)` — `clearToolStats()` 호출 추가

### 5단계: 검증 (Playwright)
- http://localhost:9999 접속
- tool_call이 있는 세션 선택 후 "도구" 탭 클릭
- 3개 섹션 렌더링 확인
- 스크린샷 저장

## 완료 기준

- [ ] `tool-stats.css` — CSS 변수만 사용, 하드코딩 색상 없음
- [ ] `tool-stats.js` — 3개 섹션 정상 렌더링
- [ ] `index.html` — "도구" 탭 버튼 및 컨테이너 추가
- [ ] `session-detail.js` — tools 탭 전환 및 데이터 로드 연동
- [ ] `npm run typecheck` 에러 없음
- [ ] Playwright 스크린샷으로 UI 확인

## 영향 파일

```
packages/web/assets/js/tool-stats.js      — 신규
packages/web/assets/css/tool-stats.css    — 신규
packages/web/index.html                   — 탭 버튼 + 컨테이너 추가
packages/web/assets/js/session-detail.js  — 탭 연동 수정
```

## 예상 소요 시간

약 1시간 (CSS 20분 + JS 25분 + HTML/연동 15분)
