# web-cross-cutting — Cross-cutting Layers (W13)

> 보이지 않지만 화면 전반에 영향을 주는 레이어. 툴팁 시스템 + 이상 감지 + 실시간/SSE + 영속화/리사이즈 + 키보드 접근성 + 프롬프트 확장 패널.
> 5라운드 누적 인벤토리.

---

## R1 — 1차 작성

### 1. 툴팁 시스템

#### Cache Tooltip (`cache-tooltip.js`)
- 트리거: `.cache-cell` hover (W5/W9의 cache 컬럼)
- data 속성: `data-cache-read` / `data-cache-write`
- 표시 내용: 캐시 읽기/생성 토큰, 절감 비율 등

#### Stat Tooltip (`stat-tooltip.js`)
- 트리거: `[data-stat-tooltip]` hover (W2 Summary Strip 9개 stat-card)
- 9종: active/avg-duration/p95/err/sessions/requests/tokens/cost/saved
- 각 카드별 상세 설명/계산 방식

#### Cache Panel Tooltip (`cache-panel-tooltip.js`)
- 트리거: `[data-cache-panel-tooltip]` hover (W4 Cache Panel 3섹션)
- 3종: hit-rate/cost/ratio
- 각 섹션별 정의/예시

#### 기타 title 속성 툴팁 (네이티브)
- LIVE 배지, 날짜 필터, 타입 필터, panel-resize-handle, btn-toggle, btn-close, btn-panel-toggle, btn-panel-collapse 등

### 2. Anomaly Detection (`anomaly.js`)

#### detectAnomalies(requests, p95DurationMs)
- 입력: requests 배열 + 서버 meta.p95DurationMs
- 출력: Map<requestId, Set<'spike'|'loop'|'slow'>>

#### 3종 감지 알고리즘
- **spike**: 세션별 prompt tokens_input 평균의 200% 초과
- **loop**: 동일 turn_id 내 동일 tool_name 연속 3회 이상
- **slow**: tool_call duration_ms > p95DurationMs

#### 적용 위치
- W5 (Default View): 행 전체에 mini-badge (spike/loop는 cell-target, slow는 cell-duration)
- W10 (Turn View): turn 단위로 집계 (`_detailTurnAnomalyMap`)
- W11 (Gantt): turn 라벨에 anomaly 시각 단서
- W9 (Flat View): 미적용 (R5 발견)

### 3. Realtime / SSE Layer

#### SSE 연결 (`main.js connectSSE`)
- EventSource `/events`
- 이벤트: `new_request`
- 자동 재시도: 5초 setTimeout
- onopen → setIsSSEConnected(true) + clearError + 데이터 재조회 (fetchDashboard/fetchRequests/fetchAllSessions)
- onerror → setIsSSEConnected(false) + 5초 후 재연결

#### LIVE 배지 동기화
- W1 헤더의 `#liveBadge`
- connected: `LIVE`
- disconnected: `OFFLINE` (`.disconnected` 클래스)

#### prependRequest (W5)
- 인플레이스 업데이트: 같은 id 행은 cell-target/duration만 갱신
- 신규: 최상단 삽입, 200행 초과 시 가장 오래된 행 deleteRow
- scroll-lock 처리: 사용자가 scroll up 상태면 위치 보정 + count++

#### refreshDetailSession (W9/W10/W11)
- SSE 수신 시 selected session 일치하면 호출
- /api/sessions/{id}/requests + /turns 병렬 조회
- applyDetailFilter() → 모든 detail 뷰 갱신

#### 1초 debounce (`refreshDebounce`)
- SSE new_request 수신 시 1초 후 fetchDashboard 호출 — Summary Strip 갱신

### 4. Persistence & Resize Layer

#### LocalStorage 키 6종
- `spyglass:lastProject` — 마지막 선택 프로젝트
- `spyglass:panel-width` — Left Panel 너비
- `spyglass:chart-collapsed` — Chart Section 접힘 boolean
- `left-panel-hidden` — Left Panel 숨김 boolean
- `left-panel-state` — 섹션별 접힘 JSON `{projects, sessions, tools}`
- `_promptCache`는 in-memory만, localStorage 미저장

#### Panel Resize (`panel-resize.js`)
- `.panel-resize-handle` 우측 4px width
- 마우스 드래그 → width 갱신 (180~480px clamp)
- 더블클릭 → `measureMaxWidth(elements)` 콘텐츠 너비 측정 → Auto-fit

#### Column Resize (`col-resize.js`)
- 각 colgroup col에 핸들 추가 (마우스 드래그)
- 더블클릭 → Auto-fit
- 적용 테이블: feedBody (W5), detailFlatView (W9)

#### resize-utils (`resize-utils.js`)
- `measureMaxWidth(elements)` SSoT — panel-resize/col-resize 공유

### 5. 키보드 접근성

#### 명시 구현
- 카드 W10 summary: tabindex=0, role="button", aria-expanded, Enter/Space ✅
- 모든 `<button>` 태그: 기본 Tab/Enter ✅

#### 미구현
- 행 ↑↓ 이동 (W3/W5/W9 모두)
- 행 Enter (모두)
- ESC 핸들러 (검색/확장 패널/detail 닫기)
- ←→ 탭 전환 (W8)
- 단축키 (검색/필터/Tab/refresh)

### 6. Prompt Expand Panel (`renderers.togglePromptExpand`)

#### 동작
- `[data-expand-id]` 클릭 → togglePromptExpand(rid, container, cols)
- 같은 id 클릭 시 닫힘
- 다른 id 클릭 시 기존 모두 제거 후 새로 표시

#### 두 가지 컨테이너
- 테이블 안: `<tr.prompt-expand-row>` (colspan=cols)
- 테이블 밖: `<div data-expand-for>` (grid-column 1/-1 인라인)

#### 내용
- 복사 버튼 (`onclick=navigator.clipboard.writeText(...).then(...)`)
- 복사 성공 시 1.5초간 "✓복사됨" 표시
- pre 텍스트 (white-space pre-wrap, word-break break-all)

#### 데이터 출처
- `_promptCache: Map(id → text)` — 최대 500개
- contextPreview 호출 시 cache.set
- togglePromptExpand 호출 시 cache.get

---

## R2 — 검토

1. **툴팁 시스템 분산**: 4개 모듈 (cache/stat/cache-panel/네이티브 title). 시각 일관성 부족 가능.
2. **anomaly 적용 범위 비일관**: W5 ✅, W9 ❌, W10 부분, W11 부분. 단일 SSoT 부재.
3. **SSE 재연결 5초 hardcoded**: 환경 설정 부재.
4. **prependRequest는 anomaly 미적용**: 새 요청은 spike/loop/slow 즉시 미반영.
5. **localStorage prefix 비일관**: `spyglass:` vs 무접두사 (`left-panel-hidden`/`left-panel-state`).
6. **Resize 폴백**: ResizeObserver 부재 시 window resize 폴백 (chart.js만 명시).
7. **키보드 접근성 전반 부족**: 카드만 적절, 나머지 미흡.
8. **prompt expand 텍스트 cache 500 제한**: 오래된 텍스트 무음 삭제 — 사용자가 클릭했는데 빈 텍스트 가능 (희박).
9. **prompt expand 복사 버튼 inline onclick**: 보안/유지보수 측면 이벤트 위임 권장.
10. **prompt expand pre 스타일 인라인**: CSS 클래스로 이관 가능.
11. **escape HTML 함수 중복**: tool-stats.js에 자체 정의, 다른 곳은 formatters.escHtml.
12. **30초 polling vs SSE**: SSE 연결 시 polling 중복. 그러나 fail-safe 의도.
13. **fetchDashboard debounce 1초**: SSE 빈도 높을 때 stat 갱신 지연.
14. **dispatch CustomEvent `feed:updated`**: applyFeedSearch 트리거. 다른 모듈에서 구독 부재.

---

## R3 — R2 반영 + 추가

### 보강

- **툴팁 일관성**:
  - cache-cell, stat-card, cache-panel section: 자체 위치 계산 모듈
  - 그 외: 네이티브 title (브라우저 디폴트 hover 지연 약 500ms, 디자인 일관성 약함)
- **anomaly 적용 SSoT 부재 — 잠재 일관성 문제 (Phase 2 후보)**.
- **SSE 동작**:
  - onopen 시 fetchDashboard/fetchRequests/fetchAllSessions 모두 재호출 — 초기 동기화
  - onerror 시 5초 setTimeout으로 connectSSE 재호출
  - new_request 수신 시:
    1. recordRequest() / drawTimeline() (W4 차트)
    2. JSON 파싱 → req.data
    3. 세션 토큰 갱신 (현재 selected session 행만 직접 갱신)
    4. prependRequest(req) (W5)
    5. selected detail이 있으면 refreshDetailSession (W9~W12)
    6. 1초 debounce 후 fetchDashboard (W2)
- **prependRequest 인플레이스 범위**: cell-target HTML + duration 텍스트만. cell-token (in/out)/cache 미갱신 — pre_tool 시점 토큰 미정 의도.
- **새 세션 도착 처리**: SSE 수신 시 sess가 getAllSessions에 없으면 `fetchAllSessions()` 재호출 (예: `/clear` 직후).
- **localStorage 키 정리**:
  | 키 | 역할 | prefix |
  |----|------|--------|
  | spyglass:lastProject | 마지막 프로젝트 | ✅ |
  | spyglass:panel-width | 패널 너비 | ✅ |
  | spyglass:chart-collapsed | 차트 접힘 | ✅ |
  | left-panel-hidden | 패널 숨김 | ❌ |
  | left-panel-state | 섹션별 접힘 | ❌ |
- **Resize 정책**:
  - panel-resize: ResizeObserver 미사용, mousemove 직접
  - col-resize: 각 컬럼 핸들 직접 mousemove
  - chart.js (timeline): ResizeObserver O, 폴백 window resize
  - context-chart, donut: 캔버스 size 정적 (donut 90 고정, context rect)
- **prompt cache 정책**:
  - max 500
  - LRU evict: oldest key delete (Map 순서 기반)
  - cache miss 시 (rid는 있으나 text 없음): pre 빈 문자열

### 추가 인터랙션

- **scroll-lock 배너**: W5 전용. 다른 뷰에서는 스크롤 보존만 (별도 배너 없음).
- **스타일 vs 인라인 정책**: 일부는 인라인 (style="..."), 일부는 클래스. 통일 부재.

---

## R4 — 검토 (미세·키보드·에러·상태 전이)

1. **툴팁 키보드/터치 미지원**: hover 전용. focus/long-press 미지원.
2. **툴팁 ESC 닫기 부재**: hover 끝나야 닫힘.
3. **툴팁 위치 클램프**: 화면 가장자리 잘림 처리 미확인 (각 모듈별 별도 구현).
4. **anomaly 알고리즘 임계값 hardcoded**: 200%, 3회, p95. 사용자 조정 불가.
5. **SSE EventSource 토큰/인증 미적용**: 모든 사용자에게 모든 데이터 노출.
6. **SSE retry 5초 backoff 없음**: 일정 시간. exponential backoff 부재.
7. **prependRequest 시 행이 200 초과하면 사라짐**: 사용자 의도와 충돌 가능 (방금 본 행 사라짐).
8. **localStorage 마이그레이션 정책 부재**: 키 변경/삭제 시 stale 데이터 잔존.
9. **Resize handle 우측 z-index 충돌 (W3)**: btn-panel-collapse z-index:20, panel-resize-handle z-index:10 — 같은 우측 가장자리.
10. **Auto-fit 측정 정확성**: measureMaxWidth가 모든 케이스에서 정확한지 확인 필요.
11. **키보드 단축키 충돌**: 브라우저 기본 단축키와 충돌 회피 정책 부재.
12. **prompt expand 복사 실패 처리**: catch 부재 — promise rejection 무음.
13. **prompt expand pre word-break break-all**: 긴 코드 줄바꿈 — 단어 중간에서도 잘림. 가독성 약함.
14. **prompt expand 동시 다중 패널 부재**: 한 화면에 한 개만 — 비교 어려움.
15. **CustomEvent feed:updated**: applyFeedSearch만 구독. 더 많은 곳에서 사용 가능 (chart, summary 등).
16. **dispatch 빈도 통제 부재**: prependRequest 빈번하면 dispatch도 빈번 — applyFeedSearch 비용.
17. **30초 polling fetchAllSessions**: SSE 끊긴 동안에도 30초마다 호출. 서버 부하 가능.

---

## R5 — R4 반영 + 최종 추가

### 추가된 미세·접근성·상태·일관성

- **툴팁 전반 ARIA 부재**: `role="tooltip"`, `aria-describedby` 부재
- **툴팁 키보드/포커스 미지원**: hover 전용 — 키보드/터치 사용자 미지원
- **툴팁 위치 클램프 일관성 미확인**
- **anomaly 임계값 hardcoded** — 사용자 설정 부재
- **anomaly SSoT 부재**: W5/W9/W10/W11 적용 범위 비일관 (W9 미적용)
- **SSE 인증 부재**: 모든 사용자 모든 데이터 노출 (로컬 도구 가정)
- **SSE retry exponential backoff 부재**: 5초 고정
- **localStorage prefix 비일관** (`spyglass:` 일부)
- **localStorage 마이그레이션 부재**
- **Resize z-index 충돌 (panel/btn)**
- **Resize handle 키보드 미지원**
- **prompt cache 500 제한 무음 evict**
- **prompt expand 동시 다중 부재**
- **prompt expand 복사 실패 처리 부재**
- **prompt expand pre word-break break-all** — 코드 가독성 약함
- **CustomEvent 활용 적음**: 더 많은 컴포넌트가 SSE/필터 변경 구독 가능
- **dispatch 빈도 통제 부재** — debounce/throttle 미적용
- **30초 polling 서버 부하**: SSE 살아있을 때 polling 비활성화 후보
- **인라인 style vs CSS 클래스 비일관**: index.html에서 일부 인라인 (styled feed-search-buttons, donut typeLegend, loadMoreBtn 등)
- **escHtml 자체 정의 (tool-stats.js)** — formatters.escHtml 사용 권장
- **renderers.toolIconHtml vs left-panel.toolIconHtml 사본**: 사본은 pre_tool 애니메이션 미적용 — 의도된 단순화이지만 잠재 inconsistency

### 키보드 단축키 (현재 부재)

| 의도 | 현재 |
|------|------|
| Cmd/Ctrl+F 검색 | 없음 |
| Cmd/Ctrl+R 새로고침 | 브라우저 기본 |
| ESC (검색/확장/detail/툴팁) | 없음 |
| 1~9 (탭/필터) | 없음 |
| ↑↓ (행/카드/턴) | 없음 |
| ←→ (탭/페이지) | 없음 |
| Enter (선택) | 카드만 ✅ |
| ? (도움말) | 없음 |
| Cmd/Ctrl+, (설정) | 없음 |
| / (검색 포커스) | 없음 (TUI에는 있음) |

---

## 최종 기능 개수 (W13)

### 툴팁 시스템 — 4개 모듈
- cache-tooltip / stat-tooltip / cache-panel-tooltip / 네이티브 title

### Anomaly Detection — 3개 알고리즘
- spike / loop / slow

### Realtime — 6개
- SSE 연결 / 재시도 / onopen 동기화 / prependRequest / refreshDetailSession / 1초 debounce

### LIVE 배지 동기화 — 1개

### Persistence — 5개 키 + 2개 모듈 (panel-resize, col-resize) + 1개 SSoT (resize-utils)

### 키보드 접근성 — 부분 (카드만 ✅)

### Prompt Expand — 5개 (data-expand-id / 두 컨테이너 / 복사 버튼 / pre 텍스트 / cache LRU)

### CustomEvent — 1개 (`feed:updated`)

총 **약 27개 기능**.

## 발견된 누락·모호 (Phase 2 입력)

1. anomaly SSoT 부재 — W5/W9/W10/W11 적용 범위 비일관
2. anomaly 임계값 hardcoded
3. 툴팁 ARIA/키보드/포커스 부재
4. 툴팁 위치 클램프 일관성 미확인
5. localStorage prefix 비일관 (`spyglass:` 일부)
6. localStorage 마이그레이션 부재
7. SSE retry exponential backoff 부재 (5초 고정)
8. SSE 인증 부재
9. Resize z-index 충돌 (panel collapse btn vs resize handle)
10. Resize 키보드 미지원
11. prompt cache 500 무음 evict
12. prompt expand 동시 다중 부재
13. prompt expand 복사 실패 처리 부재
14. prompt expand pre word-break break-all 가독성
15. CustomEvent 활용 부족
16. dispatch debounce/throttle 미적용
17. 30초 polling 서버 부하 (SSE 살아있을 때)
18. 인라인 style vs CSS 클래스 비일관
19. escHtml 코드 중복 (tool-stats.js)
20. toolIconHtml 사본 분산 (renderers vs left-panel)
21. 키보드 단축키 전반 부재 (Cmd/Ctrl+F, ESC, 1~9, ↑↓, ←→, /, ?, Cmd/Ctrl+,)
