# Web UI/UX 개선 작업 목록

> 기반 문서: plan.md, adr.md  
> 작성일: 2026-04-18 (검토 반영 수정)  
> 총 태스크: 9개  
> 대상 파일: `packages/web/index.html`

## 검토 반영 수정 사항
- T-01: `manualRefresh()` 내부 `#btnRefresh` null 참조 제거 추가 (블로커)
- T-02: 모바일 반응형 `@media` 처리 포함
- 기존 T-06(슬라이드) + T-07(UIState) 통합 → 새 T-06
- T-07(ResizeObserver) 선행 조건: T-07 → T-05 (UIState와 무관)

---

## 태스크 목록

| ID | 태스크 | 예상 시간 | 선행 태스크 | 커밋 타입 |
|----|--------|----------|------------|----------|
| T-01 | 새로고침 버튼 제거 + SSE onopen 재로드 + manualRefresh() 수정 | 0.5h | - | fix |
| T-02 | CSS Grid 전체 레이아웃 뼈대 + 모바일 반응형 | 1.5h | T-01 | refactor |
| T-03 | Summary Strip 컴팩트 재설계 | 0.5h | T-02 | refactor |
| T-04 | Left Panel 구성 (프로젝트·세션·Tool Stats 이동) | 1h | T-02 | refactor |
| T-05 | Right Panel 기본 뷰 (타임라인 + 최근 요청 피드 통합) | 1h | T-04 | refactor |
| T-06 | UIState + renderRightPanel() + 슬라이드 전환 통합 | 2h | T-05 | feat |
| T-07 | Canvas ResizeObserver + drawTimeline rAF 최적화 | 0.5h | T-05 | perf |
| T-08 | 디자인 개선 (색상 팔레트, 타이포그래피, 밀도) | 1h | T-06 | refactor |
| T-09 | _promptCache 항목 제한 + 인라인 onclick → 이벤트 위임 | 1h | T-08 | refactor |

---

## 의존성 그래프

```
T-01 → T-02 → T-03
              ↓
              T-04 → T-05 → T-06 → T-08 → T-09
                     ↓
                     T-07 (T-05 완료 후 병행 가능)
```

---

## T-01: 새로고침 버튼 제거 + SSE onopen 수정 + manualRefresh() 수정

**선행 조건**: 없음

### 작업 내용

1. 헤더 `#btnRefresh` 버튼 HTML 제거 및 `.btn-refresh` CSS 제거
2. `manualRefresh()` 내부 `document.getElementById('btnRefresh')` 참조 제거 — null 참조로 에러 배너 "다시 시도" 버튼이 TypeError 발생하는 블로커 수정
3. `sseSource.onopen`에 `fetchDashboard() + fetchRequests() + fetchAllSessions()` 추가

### 구현 범위

- HTML: `<button id="btnRefresh" ...>` 요소 삭제
- CSS: `.btn-refresh`, `.btn-refresh.spinning`, `@keyframes spin` 삭제
- JS `manualRefresh()`: `btn.classList.add('spinning')` + `btn.classList.remove('spinning')` 제거, fetch 3개만 남김
- JS `sseSource.onopen`: `clearError(); clearTimeout(retryTimer);` 뒤에 fetch 3개 추가

### 커밋 메시지

```
fix(web): 새로고침 버튼 제거 및 SSE 재연결 후 데이터 재로드 수정
```

### 완료 기준

- [ ] 헤더에 새로고침 버튼 없음
- [ ] `.btn-refresh` CSS 규칙 없음
- [ ] `getElementById('btnRefresh')` 코드 없음
- [ ] `sseSource.onopen`에 fetch 3개 존재
- [ ] `manualRefresh()` 함수 존재 (fetch 로직만 남음)

---

## T-02: CSS Grid 전체 레이아웃 뼈대 + 모바일 반응형

**선행 조건**: T-01

### 작업 내용

`body`를 CSS Grid로 전환하고 2패널 고정 높이 레이아웃을 구성한다.
모바일(`max-width: 768px`) 미디어 쿼리에서 단일 패널로 전환한다.

### 구현 범위

- CSS 변수 추가:
  ```css
  --left-panel-width: 280px;
  ```
- `body`:
  ```css
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  height: 100vh;
  overflow: hidden;
  padding: 0;
  ```
- `.main-layout` (신규):
  ```css
  display: grid;
  grid-template-columns: var(--left-panel-width) 1fr;
  overflow: hidden;
  ```
- `.left-panel` (신규): `display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid var(--border);`
- `.right-panel` (신규): `position: relative; overflow: hidden; display: flex; flex-direction: column;`
- 기존 `body { padding: 24px }` 제거, 헤더 내부 padding 명시
- 기존 `.browser-list { max-height: 260px }` 하드코딩 제거
- 모바일 반응형:
  ```css
  @media (max-width: 768px) {
    --left-panel-width: 100%;
    .main-layout { grid-template-columns: 1fr; }
    .left-panel { max-height: 200px; border-right: none; border-bottom: 1px solid var(--border); }
  }
  ```

### 커밋 메시지

```
refactor(web): CSS Grid 기반 고정 높이 2패널 레이아웃 뼈대 도입
```

### 완료 기준

- [ ] `body { display: grid; height: 100vh; overflow: hidden; }` 존재
- [ ] `grid-template-columns: var(--left-panel-width) 1fr` 존재
- [ ] `.browser-list { max-height: 260px }` 없음
- [ ] `@media (max-width: 768px)` 반응형 규칙 존재
- [ ] 브라우저에서 좌측 280px / 우측 flex-1 패널 확인

---

## T-03: Summary Strip 컴팩트 재설계

**선행 조건**: T-02

### 작업 내용

4개 통계 카드를 1행 컴팩트 배치로 변경한다.

### 구현 범위

- HTML: `.summary-grid` → `.summary-strip` 클래스명 교체
- CSS:
  ```css
  .summary-strip { display: flex; gap: 1px; background: var(--border); }
  .stat-card { flex: 1; display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: var(--bg); }
  .stat-label { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
  .stat-value { font-size: 18px; font-weight: 700; white-space: nowrap; }
  ```

### 커밋 메시지

```
refactor(web): Summary 카드 컴팩트 1행 배치로 재설계
```

### 완료 기준

- [ ] 4개 카드가 1행에 배치됨
- [ ] `.stat-value { font-size: 18px }` (기존 28px에서 축소)
- [ ] `white-space: nowrap` 적용으로 줄바꿈 방지

---

## T-04: Left Panel 구성 (프로젝트·세션·Tool Stats 이동)

**선행 조건**: T-02

### 작업 내용

브라우저 그리드와 Tool Stats를 `.left-panel` 컨테이너로 이동한다.
내부 리스트가 패널 높이를 채우며 오버플로우 시 스크롤되도록 `flex: 1; overflow-y: auto; min-height: 0` 적용.

### 구현 범위

- HTML: `#browserGrid` → `.left-panel` 내부로 이동
- HTML: Tool Stats 섹션 → `.left-panel` 하단으로 이동
- CSS:
  ```css
  .left-panel .section-label { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-dim); padding: 8px 12px 4px; }
  .project-list, .session-list { flex: 1; overflow-y: auto; min-height: 0; }
  .tool-stats-section { border-top: 1px solid var(--border); flex-shrink: 0; }
  ```
- JS: `renderTools()`에서 도구 데이터 없으면 `.tool-stats-section { display: none }`

### 커밋 메시지

```
refactor(web): 프로젝트/세션/도구통계를 Left Panel로 통합 재배치
```

### 완료 기준

- [ ] 프로젝트 클릭 → 세션 목록 정상 표시
- [ ] 세션 목록 내부 스크롤 동작 (`overflow-y: auto; min-height: 0`)
- [ ] Tool Stats 조건부 표시 동작
- [ ] 빈 프로젝트 목록 상태에서 세션 패널 빈 상태 처리 유지

---

## T-05: Right Panel 기본 뷰 (타임라인 + 최근 요청 피드 통합)

**선행 조건**: T-04

### 작업 내용

Right Panel에 `#defaultView` 컨테이너를 생성하고 타임라인 차트와 최근 요청 피드를 배치한다.
기존 페이지 하단 `#recentRequests` 섹션을 제거한다.
세션 상세는 `#detailView` 컨테이너로 준비 (T-06에서 전환 로직 추가).

### 구현 범위

- HTML: `.right-panel` 내부 구조:
  ```html
  <div id="defaultView" class="right-view active">
    <!-- 타임라인 차트 (기존 .charts-row 이동) -->
    <!-- 최근 요청 피드 테이블 -->
  </div>
  <div id="detailView" class="right-view">
    <!-- 기존 #detailSection 내용 (기존 위치에서 이동) -->
  </div>
  ```
- CSS:
  ```css
  .right-view { display: flex; flex-direction: column; overflow-y: auto; padding: 16px; gap: 16px; }
  ```
- HTML: 페이지 하단 기존 `#recentRequests` 섹션 제거
- JS: `renderRequests()`가 `#defaultView` 내부 피드 테이블을 업데이트하도록 수정
- 데이터 로딩 중 스켈레톤: `#detailView` 내부 로딩 메시지 추가 (`<div id="detailLoading">로딩 중...</div>`)

### 커밋 메시지

```
refactor(web): Right Panel 기본 뷰에 타임라인+최근요청 피드 통합
```

### 완료 기준

- [ ] 세션 미선택 시 `#defaultView`가 visible (`.active` 클래스)
- [ ] 최근 요청 피드 실시간 갱신 (SSE 이벤트 수신 시)
- [ ] 페이지 하단 별도 Recent Requests 섹션 없음
- [ ] `#detailView` 컨테이너 존재 (비어있어도 됨)

---

## T-06: UIState + renderRightPanel() + 슬라이드 전환 통합

**선행 조건**: T-05

> 검토 반영: 기존 T-06(슬라이드)과 T-07(UIState)을 통합. 두 태스크가 동일한 우측 패널 렌더링 로직을 순차 교체하는 구조적 문제 해소.

### 작업 내용

`uiState` 명시적 상태 객체를 도입하고 `renderRightPanel()` 단일 진입점을 구현한다.
동시에 `position: absolute + opacity/transform` CSS transition으로 슬라이드 전환 구현.
`isTransitioning` 플래그를 `uiState`에 포함하여 전환 중 중복 클릭 방지.
기존 `scrollIntoView()` 제거.

### 구현 범위

- CSS:
  ```css
  .right-panel { position: relative; }
  .right-view {
    position: absolute; inset: 0; overflow-y: auto;
    opacity: 0; transform: translateX(6px);
    transition: opacity .18s ease, transform .18s ease;
    pointer-events: none;
  }
  .right-view.active { opacity: 1; transform: translateX(0); pointer-events: auto; }
  ```
- JS `uiState` 객체:
  ```js
  const uiState = { rightView: 'default', detailTab: 'flat', isTransitioning: false };
  ```
- JS `renderRightPanel()`:
  ```js
  function renderRightPanel() {
    const isDetail = uiState.rightView === 'detail';
    document.getElementById('defaultView').classList.toggle('active', !isDetail);
    document.getElementById('detailView').classList.toggle('active', isDetail);
  }
  ```
- JS `selectSession()`:
  - `scrollIntoView()` 제거
  - `uiState.rightView = 'detail'; uiState.detailTab = 'flat'; renderRightPanel();`
  - 로딩 표시: `#detailLoading` 표시 → 데이터 도착 후 숨김
  - `isTransitioning` 플래그: 전환 시작 시 true, `transitionend` 이벤트 후 false
- JS `closeDetail()`:
  - `uiState.rightView = 'default'; selectedSession = null; renderRightPanel();`
- JS `setDetailView()`:
  - `uiState.detailTab = view;` + 탭 UI 갱신

### 커밋 메시지

```
feat(web): UIState 상태 관리 및 세션 상세 슬라이드 전환 도입
```

### 완료 기준

- [ ] `uiState` 객체 존재 (`rightView`, `detailTab`, `isTransitioning` 포함)
- [ ] `renderRightPanel()` 함수 존재
- [ ] `scrollIntoView` 호출 코드 없음
- [ ] `getElementById('btnRefresh')` 관련 코드 없음 (T-01 확인)
- [ ] 세션 클릭 시 슬라이드 전환 (~180ms) 확인
- [ ] 세션 전환 시 항상 flat 탭으로 초기화
- [ ] 로딩 중 `#detailLoading` 표시

---

## T-07: Canvas ResizeObserver + drawTimeline rAF 최적화

**선행 조건**: T-05 (UIState와 무관, 레이아웃 확정 후 적용 가능)

### 작업 내용

`window.addEventListener('resize', drawTimeline)` 대신 타임라인 캔버스 컨테이너에 ResizeObserver를 부착한다.
`requestAnimationFrame`으로 래핑하여 연속 호출을 1프레임으로 병합한다.

### 구현 범위

```js
let _rafId = null;
const timelineWrap = document.querySelector('#timelineChart').parentElement;
if ('ResizeObserver' in window) {
  new ResizeObserver(() => {
    cancelAnimationFrame(_rafId);
    _rafId = requestAnimationFrame(() => drawTimeline());
  }).observe(timelineWrap);
} else {
  window.addEventListener('resize', drawTimeline);
}
```
- 기존 타임라인 관련 `window.addEventListener('resize', ...)` 제거

### 커밋 메시지

```
perf(web): Canvas ResizeObserver 도입 및 drawTimeline rAF 최적화
```

### 완료 기준

- [ ] `new ResizeObserver(...)` 코드 존재
- [ ] `_rafId` + `cancelAnimationFrame` 패턴 존재
- [ ] 창 크기 변경 시 타임라인 차트 깨짐 없음
- [ ] 패널 전환 후 차트 너비 정상 재계산

---

## T-08: 디자인 개선 (색상 팔레트, 타이포그래피, 밀도)

**선행 조건**: T-06

### 작업 내용

Anthropic 색상 팔레트 적용, 타이포그래피 계층 정리, 섹션 밀도 최적화.

### 구현 범위

- CSS 변수 색상 팔레트 교체:
  ```css
  --accent: #d97757;
  --accent-dim: rgba(217, 119, 87, 0.12);
  --bg: #0f0f0f;
  --surface: #1a1a1a;
  --surface-hover: #222222;
  --border: #2a2a2a;
  --text: #e8e8e8;
  --text-muted: #888;
  --text-dim: #555;
  ```
- 헤더: `font-weight: 800; letter-spacing: -0.5px` 로고 강화
- 선택된 세션/프로젝트 행: `background: var(--accent-dim); border-left: 2px solid var(--accent);`
- 섹션 레이블: `font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim);`
- 테이블 행: `font-size: 12px; height: 32px` (밀도 증가)
- LIVE 배지 색상 조정 (연결 상태와 연동)

### 커밋 메시지

```
refactor(web): Anthropic 색상 팔레트 적용 및 디자인 개선
```

### 완료 기준

- [ ] `--accent: #d97757` CSS 변수 존재
- [ ] 선택된 항목 accent 강조 표시 (border-left + 배경)
- [ ] 섹션 레이블 uppercase 소형 적용
- [ ] `--bg: #0f0f0f` (다크 배경 강화)

---

## T-09: _promptCache 항목 제한 + 인라인 onclick → 이벤트 위임

**선행 조건**: T-08

### 작업 내용

장기 실행 메모리 누수를 방지하고, XSS 위험 있는 인라인 onclick을 이벤트 위임으로 교체한다.

### 구현 범위

- JS `_promptCache` 제한:
  ```js
  const PROMPT_CACHE_MAX = 500;
  // 저장 전: if (Object.keys(_promptCache).length >= PROMPT_CACHE_MAX) { _promptCache = {}; }
  ```
  (간단한 전체 초기화; expanded 상태 prompt는 재로드 시 재캐싱됨)
- JS 이벤트 위임 — Left Panel:
  ```js
  document.querySelector('.left-panel').addEventListener('click', e => {
    const projRow = e.target.closest('[data-project]');
    if (projRow) { selectProject(projRow.dataset.project); return; }
    const sessRow = e.target.closest('[data-session-id]');
    if (sessRow) { selectSession(sessRow.dataset.sessionId); }
  });
  ```
- HTML 렌더링: `onclick="selectProject(...)"` → `data-project="${escHtml(name)}"`, `onclick="selectSession(...)"` → `data-session-id="${id}"`

### 커밋 메시지

```
refactor(web): _promptCache 최대 항목 제한 및 이벤트 위임 패턴 적용
```

### 완료 기준

- [ ] `PROMPT_CACHE_MAX = 500` 상수 존재
- [ ] `onclick="selectProject"` 패턴 없음
- [ ] `data-project`, `data-session-id` 속성 기반 이벤트 위임 동작
- [ ] 프로젝트/세션 클릭 정상 동작

---

## 롤백

```bash
git log --oneline -10
git revert HEAD~N..HEAD  # N개 커밋 되돌리기
```
