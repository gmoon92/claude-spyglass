# web-shell — Global Shell + Summary Strip (W1 + W2)

> 항상 보이는 외곽 프레임. 헤더(로고/LIVE/날짜 필터/갱신시각), 에러 배너, Summary Strip(9 stat-card), 푸터.
> 5라운드 누적 인벤토리.

---

## R1 — 1차 작성

### W1 Global Shell

#### 헤더 (`<header.header>`, height 52px)
- 로고: "Claude" + `<span>Spyglass</span>` (16px, 800)
- LIVE 배지 (`#liveBadge.badge-live`)
  - `.dot` + "LIVE" — SSE 연결 시
  - `.disconnected` 클래스 + "OFFLINE" — SSE 끊김 시
  - title: "SSE 실시간 연결 상태. 초록: 연결됨 · 빨강: 연결 끊김 (5초마다 재시도)"
- 날짜 필터 (`#dateFilter`)
  - 버튼 3개: 전체(`data-range="all"`, 기본 active)/오늘(`today`)/이번주(`week`)
  - 클릭 시 `setActiveRange` → `fetchDashboard/fetchRequests/fetchCacheStats/fetchAllSessions` 일괄 호출
  - `.filter-btn.active` 토글
  - 각 버튼 title: 데이터 범위 설명 (예: "오늘 00:00(로컬 시간) 이후 데이터만 표시")
- 마지막 갱신 시각 (`#lastUpdated`)
  - `setLastUpdated()` — 한국어 toLocaleTimeString
  - 초기값 "—"

#### 에러 배너 (`<div.error-banner#errorBanner>`)
- 평소 숨김, `.visible` 클래스 토글
- SVG 아이콘 + 메시지(`#errorMsg`) + "다시 시도" 버튼(`#retryBtn`)
- 클릭 시 `manualRefresh()` — `fetchDashboard/fetchRequests/fetchAllSessions` 병렬 호출
- 메시지 변경: SSE 끊기거나 fetch 실패 시 동적 텍스트

#### 푸터 (`<footer.footer>`, height 20px)
- 텍스트: "Claude Spyglass — real-time Claude Code monitor"

### W2 Summary Strip (`.summary-strip`, 40px)

9개 stat-card + 1개 구분선:
- 활성 (`#activeCard` / `#statActive`) — `.active` 클래스 + `.is-active-indicator` 토글
- 평균 응답 (`#statAvgDuration`) — `formatDuration`
- P95 (`#stat-p95`) — `Xms`/`X.Xs`
- 오류 (`#stat-error-rate`) — `X.X%`, `.is-error`(>0%) / `.is-critical`(>1%) 토글
- 구분선 (`.stat-divider`)
- 세션 (`#statSessions`) — fmt 숫자
- 요청 (`#statRequests`) — fmt 숫자
- 토큰 (`#statTokens`) — fmtToken (k/M)
- 비용 (`#stat-cost`) — `$X.XX`
- 절감 (`#stat-cache-savings`) — `$X.XX`

각 카드 `data-stat-tooltip` 속성 — `stat-tooltip.js`가 hover 시 툴팁 표시.

---

## R2 — 검토

R1 누락·모호 검토:

1. **로고 텍스트 색상 의미 누락**: `<span>Spyglass</span>`가 어떤 색인지 명세 없음 → 일반 텍스트색.
2. **헤더 layout 정책 누락**: 헤더가 `flex` 컨테이너로 좌/중/우 3분할인지, 실제 정렬 규칙은? → 좌측 그룹(로고+LIVE), 중앙(날짜 필터), 우측(`#lastUpdated`).
3. **LIVE 배지 상태 전이 누락**: connected/connecting/disconnected 외에 SSE 자동 재시도(5초) 동작 명세 누락.
4. **에러 배너 `.visible` 토글 트리거 명세 누락**: 어떤 함수가 호출하는지 — `infra.showError(msg)` / `clearError()`. dashboard fetch 실패, SSE onerror 모두 트리거.
5. **데이터 범위 변경 시 차트 부제 변경**: `chartSubtitle` 텍스트가 같이 바뀜 — "전체 기간"/"오늘"/"이번 주". W1에 속한 동작인지 W4의 동작인지 경계 모호.
6. **Summary Strip 구분선 위치 의미 누락**: `.stat-divider`가 *실시간/성능 지표*와 *볼륨/비용 지표*의 시각 분리. summary-strip의 좌측 그룹(`is-active-indicator`)와 우측 그룹(`is-error`/`is-critical`)이 어떤 카드에 적용되는지 정확히 표시.
7. **stat-tooltip 활성화 트리거 누락**: `data-stat-tooltip` 5종(active/avg-duration/sessions/requests/tokens) + p95/err/cost/saved까지 9종.
8. **Summary Strip 카드 텍스트 색상 변화 명세 누락**: `is-error`는 값 텍스트만 빨강, `is-critical`은 카드 전체 border+bg 강조.
9. **반응형 동작 누락**: 좁은 폭에서 Summary Strip이 wrap 되는지/스크롤 되는지/카드가 줄어드는지 — 현재 코드 확인 필요.
10. **푸터 전체 폭 차지 여부**: footer가 main-layout 그리드 어디에 위치하는지 — `<footer>`는 main-layout 밖, `<body>` 직속 자식.
11. **로딩 초기 상태**: `<span class="skeleton">` shimmer 3개 stat 적용 (활성/평균/세션/요청/토큰), p95/오류/비용/절감은 "--" 텍스트로 시작.

---

## R3 — R2 반영 + 추가

### W1 Global Shell (보강)

- **헤더 layout**: `display: flex`, 3등분 (`.header-left` 좌, `.date-filter` 중, `#lastUpdated` 우). 좌측 패널 토글 버튼은 헤더에 없음 — `.left-panel` 직접 자식.
- **로고 색상**: `Claude`는 `var(--text)`, `<span>Spyglass</span>`는 같은 색이지만 별도 span으로 폰트/색 변경 여지 확보.
- **LIVE 배지 상태 전이**:
  - 초기 `LIVE` (낙관적)
  - `clearError()` 호출 시 `LIVE` 강제 적용 (SSE onopen)
  - `showError()` 호출 시 `disconnected` + `OFFLINE` 강제 적용
  - SSE onerror → `setIsSSEConnected(false)` + `retryTimer = setTimeout(connectSSE, 5000)` (5초 재시도)
- **날짜 필터 부수 효과**:
  - `chartSubtitle` 텍스트 변경 (W4와 연결되는 cross-cutting)
  - `fetchDashboard` + `fetchRequests` + `fetchCacheStats` + `fetchAllSessions` 일괄 호출
  - 활성 버튼 시각적 강조: `.filter-btn.active` (배경 강조)
- **에러 배너 트리거**:
  - `fetchDashboard()` catch → `showError(`대시보드 로드 실패: ${err.message}`)`
  - SSE `onerror` → 직접 호출하지 않고 reconnect 로직만 (배너는 fetchDashboard 실패 시 켜짐)
  - 배너 표시 시 `liveBadge`도 강제로 OFFLINE 상태로 동기화

### W2 Summary Strip (보강)

- **카드 분류 (좌→우, 시각적으로 구분선으로 분리)**:
  - 좌 그룹 (실시간 + 성능): 활성 / 평균응답 / P95 / 오류
  - `.stat-divider`
  - 우 그룹 (볼륨 + 비용): 세션 / 요청 / 토큰 / 비용 / 절감
- **카드 상태 클래스 (api.fetchDashboard에서 직접 토글)**:
  - 활성 카드: `activeCount > 0` → `.active` + `.is-active-indicator` 추가
  - 오류 카드: `errorRate > 0` → `.is-error`, `errorRate > 0.01` → `.is-critical` 추가
- **stat-tooltip 9종 hover 툴팁**: `data-stat-tooltip`로 식별, `stat-tooltip.js`가 별도 DOM에 위치 계산 후 표시.
- **로딩 초기 상태**:
  - 활성/평균응답/세션/요청/토큰 → `<span class="skeleton"></span>` shimmer
  - P95/오류/비용/절감 → 텍스트 `"--"` (서버 미수신 시 그대로 유지)
  - fetchDashboard 첫 응답 후 텍스트 채워짐
- **반응형**: 현재 CSS는 `flex` 단일 행, 좁은 폭에서 wrap 없음 (디자이너 피드백 "숨막힌다"의 원인 후보).

---

## R4 — 검토 (미세·키보드·에러·상태 전이)

1. **헤더 좌측 토글 버튼이 절대 없는지** 확인: 이전엔 있었는데 panel-toggle-button-position에서 `.btn-panel-collapse`가 패널 자식으로 이동. 헤더에 토글 영역이 비어 있어 시선 좌측 진입점이 약함.
2. **헤더 키보드 접근성 누락**:
   - 날짜 필터 버튼 `<button>` 태그라 Tab 포커스 가능, Enter/Space 클릭 가능.
   - 그러나 active 상태가 `aria-current` 없이 클래스로만 표현 — 스크린리더 지원 약함.
   - 로고는 그냥 텍스트 (링크 아님).
3. **LIVE 배지 클릭/포커스 동작 없음**: `<span>`으로 클릭 불가. 사용자가 SSE를 강제 재연결할 방법이 없음.
4. **에러 배너 키보드**: "다시 시도" 버튼은 `<button>` 태그라 키보드 접근 가능. ESC로 배너 닫기 동작 없음.
5. **에러 배너 메시지 종류**: 현재 `fetchDashboard` 실패만 명시. `fetchRequests` 실패, `fetchAllSessions` 실패는 별도 표시 없이 silent.
   - `fetchRequests` 실패 시 — 테이블에 빨간 텍스트 "요청 목록 로드 실패" 표시 (별도 셀).
   - `fetchAllSessions` 실패 — silent.
6. **lastUpdated 갱신 주기**: `setLastUpdated()`는 `fetchDashboard` 성공 시에만 호출. SSE 갱신은 lastUpdated를 업데이트하지 않음 — 실시간성 표시 부정확.
7. **Summary Strip stat-card 키보드 포커스**: `<div>`로 구성되어 Tab 포커스 불가. tooltip은 hover로만 표시 → 모바일/터치/키보드 사용자 미지원.
8. **stat-card 클릭 동작 없음**: 활성 세션 클릭으로 활성 세션 목록 이동, 오류 클릭으로 오류 행 필터링 등 액션 부재.
9. **`#statActive`의 `.active` vs `.is-active-indicator`**: 동시 적용 — 중복 클래스. 어느 쪽이 우선순위?
10. **숫자 포매팅 일관성**: fmt(toLocaleString 'ko-KR') vs fmtToken (k/M). 토큰만 fmtToken, 나머지는 ko-KR 천단위 콤마.
11. **에러 상태에서 Summary Strip**: API 실패 후 stat-card 값이 어떻게 되는지 — 마지막 성공값 유지 (재호출까지). 사용자가 "stale 데이터"인지 인지할 단서 없음.
12. **푸터 클릭 동작 없음**: 텍스트만, 클릭 불가.
13. **헤더와 Summary Strip 사이 간격**: 1px 에러 배너가 평소 숨김 — 간격 0. 시각적 분리 약함.
14. **로딩 vs 에러 우선순위**: 초기 로딩 중 fetch가 실패하면 skeleton이 즉시 사라지고 텍스트 "--" 또는 빈 값. 명확한 에러 표시 부족.

---

## R5 — R4 반영 + 최종 추가

### 추가된 미세 인터랙션·상태·접근성

- **LIVE 배지 인터랙션**: 현재 클릭 불가. 잠재 누락 — 디자인 재설계 시 "수동 재연결" 트리거로 활용 후보.
- **날짜 필터 ARIA**: 현재 `aria-current` 없음. `role="group"` 또는 `role="tablist"` 부재. Phase 2 보강 후보.
- **에러 배너 ESC 닫기 미구현**: `retry`만 가능, 닫기 불가. 메시지가 영구 노출.
- **lastUpdated 갱신 채널**:
  - `fetchDashboard` 성공 시 → 갱신 ✅
  - SSE new_request 수신 시 → 갱신 ❌ (누락)
  - 30초 주기 `fetchAllSessions` → 갱신 ❌
  - 결과: 사용자가 SSE만으로 갱신되는 구간에는 lastUpdated가 멈춰 보임.
- **Summary Strip 데이터 정합성**:
  - SSE new_request 수신 시 stat-card는 즉시 갱신되지 않고, 1초 debounce 후 `fetchDashboard()` 재호출로만 갱신.
  - 정확하지만 1초 딜레이 → "활성"이 변동하는 구간에 race 존재.
- **stat-card 시각 위계 부재**:
  - 9개 카드가 동일 폰트 굵기·크기로 나열 → 디자이너 피드백 "어디 봐야 할지 모르겠다"의 직접 원인.
  - 핵심(활성/오류) vs 보조(요청/토큰) 위계 구분 없음.
- **`is-active-indicator` vs `active` 중복**:
  - `active`는 일반 active 상태(예: 카드 자체 강조), `is-active-indicator`는 활성 세션 전용 시각 강조(녹색 dot).
  - 동시 적용으로 시각 충돌 가능 — Phase 2에서 정리 후보.
- **반응형 부재**:
  - Summary Strip이 좁은 폭에서 가로 스크롤(`overflow-x: auto`)인지, wrap 인지, 카드 hidden 인지 명세 없음. CSS 확인 필요.
  - 헤더 날짜 필터도 좁은 폭에서 처리 명세 없음.
- **로고 영역 클릭 동작 없음**: 일반적 대시보드는 로고 클릭 = 홈 / 대시보드 초기화. 현재 부재.
- **헤더 토글 위치 변경의 부수 효과**:
  - `.btn-panel-collapse`가 헤더에서 빠지면서 헤더 좌측이 단순화됨 → 시각 무게 우측 편향.
  - 좌측 패널 숨김 상태에서는 토글 버튼이 가려질 가능성 (border floating 위치). 검증 필요.
- **다크 테마 외 경험 부재**: light 모드 토큰 미정의, OS 다크모드 매체 쿼리 미적용.
- **에러 메시지 다국어 일관성**: 한국어 + 영문 혼재 ("LIVE", "갱신: HH:MM:SS"). 디자인 일관성 측면 검토 후보.

### 키보드 단축키 (현재 부재)

| 의도 | 현재 단축키 | 비고 |
|------|------------|------|
| 수동 새로고침 | 없음 | "다시 시도" 버튼 클릭만 |
| 날짜 필터 토글 | 없음 | Tab+Enter 가능 |
| 패널 토글 | 없음 | 버튼 클릭만 |

---

## 최종 기능 개수 (W1 + W2)

- W1 Global Shell: **15개 기능** (로고 1, LIVE 배지 1, 날짜 필터 4(전체/오늘/이번주/active), lastUpdated 1, 에러 배너 4(표시/메시지/다시 시도/숨김), 푸터 1, fetch 트리거 3)
- W2 Summary Strip: **14개 기능** (stat-card 9개 + 구분선 1 + 상태 클래스 4종(active/is-active-indicator/is-error/is-critical))

총 **29개 기능**.

## 발견된 누락·모호 (Phase 2 입력)

1. 시각 위계 부재 (9개 stat-card 동일 무게)
2. 로고 클릭 동작 없음
3. LIVE 배지 클릭으로 수동 재연결 부재
4. SSE 갱신 시 lastUpdated 미갱신
5. 에러 배너 ESC 닫기 부재
6. ARIA(`aria-current`/`role`) 부족
7. 반응형 명세 부재
8. 다크 테마 외 미지원
9. `is-active-indicator` vs `active` 클래스 중복
10. stat-card에 클릭 액션 없음 (활성→활성 세션, 오류→오류 행 필터 등 잠재)
11. 한국어/영문 혼재 일관성 검토 후보
