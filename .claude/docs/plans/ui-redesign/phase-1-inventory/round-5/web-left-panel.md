# web-left-panel — Left Panel (W3)

> 좌측 280px 패널. 프로젝트·세션·툴 통계 3섹션 + 패널 토글 + 너비 리사이즈 + 섹션별 접기/펼치기.
> 5라운드 누적 인벤토리.

---

## R1 — 1차 작성

### 패널 컨테이너 (`<aside.left-panel>`)

- 너비: `var(--left-panel-width)` = 280px (기본)
- 숨김 상태: `.main-layout.left-panel-hidden` 클래스 토글 → grid-template-columns `1fr` + `display: none`
- 영속화: `localStorage.left-panel-hidden` (JSON boolean)
- 너비 리사이즈: `.panel-resize-handle` 드래그 (180px~480px) + 더블클릭 Auto-fit (콘텐츠 너비 측정)
- 너비 영속화: `localStorage.spyglass:panel-width`

### 패널 토글 버튼 (`#btnPanelCollapse.btn-panel-collapse`)

- 위치: `.left-panel` 직접 자식, `position: absolute; top: 50%; right: -12px; transform: translateY(-50%)` — border floating
- 모양: 원형(border-radius: 50%), 24px, `var(--surface-alt)` bg, `1px solid var(--border)`
- z-index: 20 (resize-handle z-index:10 위)
- Hover: `border-color: var(--accent)`, `color: var(--accent)`
- 숨김 상태: SVG `rotate(180deg)` (펼치기 방향)
- 클릭 → `toggleLeftPanel()` → 클래스 토글 + localStorage 저장

### 섹션 1 — 프로젝트 (`.panel-section.flex-section`)

- 헤더: `.panel-label` "프로젝트" (uppercase)
- 토글: `<` 버튼 (없음 — 토글 마크업 빠져 있음)
- 테이블 colgroup: 이름(`.cell-proj-name` ellipsis 120px hint) / 세션(38px) / 토큰(92px)
- 행 (`tr.clickable`):
  - `data-project="${project_name}"` 속성
  - 토큰 바 (`bar-track > bar-fill`) + 텍스트(`bar-label.num-hi`)
  - 바 너비: `max(1, round(total_tokens / maxTotal * 100))%`
  - title 속성으로 전체 이름
- 선택 상태: `row-selected` 클래스 (accent 좌측 border + accent-dim bg)
- 클릭 → `selectProject(name)` → `setSelectedProject` + `setSelectedSession(null)` + 우측 패널 default로 전환 + sessionPaneHint 변경 + skeleton + `fetchSessionsByProject`

### 섹션 2 — 세션 (`.panel-section.flex-section`, 1fr 가변)

- 헤더 좌: `.panel-label` "세션"
- 헤더 우: `#sessionPaneHint` (10px, text-dim, 동적 변경)
  - 미선택: "프로젝트를 선택하세요"
  - 선택 후: `${project_name} · ${count}개`
- 테이블 단일 셀 (colspan=4) `makeSessionRow()`:
  - sess-id 8자 (max-width 90px, ellipsis)
  - 상대시간 (`fmtRelative`)
  - 총토큰 (`fmtToken`, margin-left:auto)
  - 활성 표시 `●`(green) / `○`(text-dim)
  - 미리보기 (.sess-row-preview, `extractFirstPrompt` 60자)
- 정렬: 활성 우선 → `last_activity_at`/`started_at` 내림차순
- 클릭 → `selectSession(id)`

### 섹션 3 — 툴 통계 (`.panel-section.tool-stats-section`, 160px)

- 헤더 좌: `.panel-label` "툴 통계 **(전체)**" — 보조 텍스트 별도 span (font-weight:400, opacity:0.6)
- 헤더 우: `#toolCount` "{n}개"
- 테이블: 툴 / 호출 (right) / 평균토큰 (right) / 호출 비율 (바 + %)
- 툴 셀 (`tool-cell`):
  - 아이콘: `◉` 일반 / `◎` Agent/Skill/Task
  - tool_name + 옵션 sub (50자 이내, ellipsis)
- 호출 비율 바: `var(--green)` fill

### 패널 섹션별 접기/펼치기

- 각 섹션 헤더에 `.btn-panel-toggle[data-panel="projects|sessions|tools"]` 추가 (28x28, < 화살표 SVG)
- 클릭 → `togglePanelSection(panelId)` → `.panel-section--collapsed` 토글 + `.panel-body` 숨김 + SVG 180도 회전
- 영속화: `localStorage.left-panel-state` (JSON `{projects:bool, sessions:bool, tools:bool}`)
- 페이지 로드 시 `restorePanelState()` 호출
- Hover: bg `var(--accent-dim)`, color `var(--accent)`

---

## R2 — 검토

1. **R1에서 섹션별 토글 버튼 마크업 누락 발견**: index.html을 보면 W3의 panel-section 헤더에는 `.btn-panel-toggle`이 명시 마크업으로 없음. screen-inventory.md에는 있다고 적혔지만 실제 index.html은 비어 있음 → JS가 동적 삽입하거나 마크업 누락. 확인 필요.
2. **프로젝트 행 콘텐츠 누락**: `bar-cell` 안 `min-width:36px`/`min-width:30px` 인라인 스타일.
3. **prj-name title vs cell-proj-name CSS**: max-width:120px CSS로 이관, title 속성으로 전체 이름 표시.
4. **세션 정렬 키 명세 부정확**: `ended_at == null`이 활성, `last_activity_at` fallback `started_at` 내림차순.
5. **세션 행 hover/선택 CSS 누락**: `.clickable.row-selected` 색상.
6. **세션 패널 hint 정확성**: 코드에서는 `${_selectedProject} · ${list.length}개` (선택 후), `프로젝트를 선택하세요` (미선택), 빈 목록 시 `프로젝트 선택 후 N개`로 표시되지만 N=0인 경우 처리.
7. **툴 통계 출처 데이터**: 헤더 라벨 `(전체)`은 단순 텍스트 (세션별 통계는 detailToolsView에 있음).
8. **툴 통계 비어있을 때**: `<tr><td>` skeleton 2행, 빈 상태 별도 ("데이터 없음"/"—") 미구현.
9. **`renderTools`에 자체 toolIconHtml 함수**: `renderers.toolIconHtml`을 import하지 않고 자체 정의 — pre_tool 애니메이션 미적용. 의도된 동작인지 검토.
10. **panel-resize.js 더블클릭 Auto-fit**: 콘텐츠 측정 시 어떤 요소 측정? `measureMaxWidth` 함수 — col-resize와 공유.
11. **패널 숨김 상태에서 토글 버튼 위치**: `right: -12px`이면 패널이 사라지면 토글도 사라질 수 있음. `.left-panel-hidden` 시 토글이 어떻게 보이는지 확인 필요.
12. **프로젝트 클릭 시 sessionPaneHint 변경 타이밍**: skeleton 표시 후 fetchSessionsByProject까지 hint가 `${name} · …`. 응답 후 `${name} · ${list.length}개`로 갱신.

---

## R3 — R2 반영 + 추가

### 보강

- **섹션별 토글 버튼 실제 위치**: index.html에는 `.btn-panel-toggle` 마크업이 명시되어 있지 않음. screen-inventory.md(444라인)는 마크업이 있다고 하나 실제 HTML에는 누락. `togglePanelSection()`/`restorePanelState()` 함수가 JS로 동적 추가하는 구조이거나, 또는 screen-inventory.md가 outdated. **이는 R5에서 발견된 문제로 feedback.md 후보가 아니라 단순 인벤토리 불일치 — Phase 2 시 명확화 필요**.
- **프로젝트 행 인라인 스타일**: `min-width:36px` (바 트랙), `min-width:30px` (바 라벨). CSS 클래스로 이관 가능 후보.
- **세션 정렬 함수**:
  ```js
  // active 우선 → last_activity_at 또는 started_at 내림차순
  (a, b) => {
    const aActive = a.ended_at == null ? 1 : 0;
    const bActive = b.ended_at == null ? 1 : 0;
    if (bActive !== aActive) return bActive - aActive;
    const aLast = a.last_activity_at || a.started_at || 0;
    const bLast = b.last_activity_at || b.started_at || 0;
    if (bLast !== aLast) return bLast - aLast;
    return (b.started_at || 0) - (a.started_at || 0);
  }
  ```
- **세션 행 hover 정책**: `.clickable` 행은 `--accent-bg-medium` hover (table.css 확인 필요).
- **세션 행 미리보기 `extractFirstPrompt`**: payload JSON 파싱 → preview/prompt/content 텍스트 추출 → HTML 태그 제거 → 60자 슬라이스.
- **툴 통계 자체 toolIconHtml 사본**: left-panel.js에 별도 정의된 toolIconHtml은 `pre_tool` 애니메이션을 적용하지 않음. 좌측 패널의 툴 통계는 통계 데이터로 SSE 라이브 상태가 아니므로 의도된 단순화.
- **빈 상태 텍스트 매핑**:
  - 프로젝트: "프로젝트 없음" (`renderBrowserProjects`)
  - 세션 미선택: "—" (`renderBrowserSessions`)
  - 세션 빈 목록: "세션 없음"
  - 툴 통계 빈 목록: skeleton 2행 (텍스트 없음)
- **panel-resize 핸들 동작**:
  - 드래그: 마우스 X 좌표 기반 width 갱신, min/max 클램프
  - 더블클릭: `measureMaxWidth` 콘텐츠 측정 후 너비 자동 조정
- **패널 숨김 상태에서 토글 위치**:
  - `.left-panel { display: none }`이면 자식인 토글도 같이 사라짐 — 사용자는 토글 버튼을 볼 수 없음
  - 실제 CSS 확인 필요. screen-inventory.md(666라인)은 "숨김 상태 overflow:visible 전환"이라 표기 — 즉 `.left-panel-hidden .left-panel`은 `display: none`이 아니라 `overflow:visible`로 토글 버튼은 보이게 처리.

### 추가 인터랙션

- **프로젝트 ↔ 세션 동기화**:
  - 프로젝트 클릭 → 해당 프로젝트의 세션만 노출 (`renderBrowserSessions` 필터링)
  - 세션 클릭 → 우측 detail 뷰 진입 (`selectSession`)
- **이벤트 위임**: `.left-panel` 단일 click 핸들러로 `[data-project]`/`[data-session-id]` 분기.
- **자동 프로젝트 활성화**:
  - localStorage 저장된 마지막 프로젝트 우선
  - 없으면 가장 최근 세션의 프로젝트
  - 없으면 첫 프로젝트
- **30초 주기 sessions polling**: `setInterval(() => fetchAllSessions(), 30000)`.

---

## R4 — 검토 (미세·키보드·에러·상태 전이)

1. **키보드 접근성 부재**:
   - 프로젝트/세션 행이 `<tr>`로 구성, 클릭만 가능. Tab 포커스/Enter 활성화 없음.
   - 섹션 접기 토글 버튼은 `<button>`이라 가능.
2. **resize-handle 키보드 조작 없음**: 마우스 드래그 전용. 좌우 화살표로 조절 미지원.
3. **resize-handle 더블클릭 Auto-fit 디스커버리**: title="드래그: 너비 조절 · 더블클릭: 콘텐츠 너비에 맞춤"으로 hover 시 표시. 키보드 사용자에겐 발견 어려움.
4. **자동 프로젝트 활성화 우선순위 명확화**: localStorage > 최신 세션의 project > 첫 프로젝트.
5. **fetchAllSessions 30초 polling vs SSE**: SSE new_request로 새 세션 도착 시 `fetchAllSessions()` 호출이 별도로 있어 polling 외에도 즉시 갱신. polling은 fail-safe.
6. **세션 행 SSE 갱신**: SSE new_request 수신 시 해당 세션의 토큰만 `data-session-id` 셀렉터로 직접 갱신 (`tokEl.textContent = fmtToken(...)`) — 전체 re-render 회피로 스크롤 위치 유지. 그러나 새 세션 발생 시(`/clear` 직후) `fetchAllSessions()` 재조회로 전체 갱신.
7. **세션 행 미리보기 누락 케이스**: `first_prompt_payload`가 없거나 파싱 실패 시 `<div class="sess-row-preview">` 자체가 출력 안 됨. 이는 의도(없으면 안 보임).
8. **섹션 접기 시 높이 변화**: project 215px → 29px, sessions 1fr → 29px, tools 160px → 29px. 두 섹션 동시 접힘 시 빈 공간 처리 명세 누락. (CSS grid가 1fr 자동 분배할 수 있음)
9. **빈 상태 인터랙션**: "프로젝트 없음" 상태에서 신규 데이터 도착 시 자동 갱신 (SSE/30초 polling).
10. **toolCount 동적 갱신**: `${list.length}개`. 0건일 때 `—`.
11. **sessionPaneHint 변경 race**: 프로젝트 클릭 직후 `${name} · …` 표시 → fetch 응답 후 `${name} · ${list.length}개`. 빠른 연속 클릭 시 race 가능.
12. **prj-name ellipsis 정책**: title 속성으로 전체 이름 노출. 그러나 색상/배경 강조 없이 단순 ellipsis만 — 가독성 약함.
13. **선택 상태 시각 누적**: 프로젝트 선택 + 세션 선택 동시 가능. 둘 다 `row-selected` 클래스 동일 색. 두 패널이 같은 시각 강조 → 사용자가 어디 있는지 혼란 가능.
14. **panel-toggle-btn 아이콘 변화**:
   - 펼침: `<` 모양 (rotate 0)
   - 숨김: `>` 모양 (rotate 180deg) — 펼치기 방향
15. **prebuilt 토큰 바 vs 백분율**: `bar-fill style="width:${pct}%"` 인라인 스타일. CSS 변수로 이관 가능하나 동적 값이라 인라인이 합리.

---

## R5 — R4 반영 + 최종 추가

### 추가된 미세·접근성·상태 전이

- **키보드 내비게이션 미구현**:
  - 프로젝트/세션 목록 ↑↓ 이동 없음
  - Enter로 선택 없음
  - resize-handle 좌우 화살표 조절 없음
- **ARIA 부재**:
  - `<aside>` 자체는 시맨틱하지만 내부 섹션 `role="region"` 미부여
  - 토글 버튼 `aria-expanded` 미부여
  - 행 `aria-selected` 미부여
- **포커스 가시성**: 클릭 가능한 행에 `:focus-visible` 정책 미정.
- **panel-section 접기 시 grid 동작**: `.flex-section`이 `1fr` flex이므로 한 섹션 접히면 나머지 자동 확장.
- **resize-handle 위치**: `.panel-resize-handle`는 `.left-panel` 자식, 우측 끝 4px width, z-index:10. `.btn-panel-collapse`는 z-index:20으로 위. 두 인터랙션이 겹치는 우측 가장자리 — 사용자가 의도와 다른 동작을 일으킬 가능성.
- **프로젝트 토큰 바 vs 툴 호출 비율 바 색상**:
  - 프로젝트: `var(--accent)` (오렌지)
  - 툴 호출 비율: `var(--green)` (인라인 style)
  - 시각 의미 다름 — 시각 위계 잘 됨, 그러나 일관성은 약함.
- **toolIconHtml 사본 두 곳**: renderers.js 글로벌 vs left-panel.js 로컬 — pre_tool 애니메이션 정책이 다름. **잠재 inconsistency** — Phase 2에서 단일화 후보.
- **자동 프로젝트 활성화 디바운스 부재**: fetchAllSessions가 빠르게 두 번 끝나면 autoActivateProject가 두 번 호출 가능 (그러나 멱등 — `getSelectedProject()` 가드로 실제 영향 없음).
- **세션 정렬 미세 정책**:
  - 활성 = `ended_at == null` 우선
  - 그 다음 `last_activity_at` 기준
  - fallback `started_at`
  - 동률 시 `started_at` 한 번 더 비교 (안정 정렬 보강)
- **sessionPaneHint 동적 텍스트**:
  - "프로젝트를 선택하세요" (미선택)
  - "${name} · …" (skeleton 표시 직후)
  - "${name} · ${count}개" (응답 후)
  - "${name} · 0개" (빈 응답)
- **panel-resize Auto-fit 측정 대상**:
  - `measureMaxWidth(elements)` — `resize-utils.js`. 콘텐츠 셀 텍스트 너비 합산.
  - 측정 대상 셀 명세 부정확 (실제 측정 함수의 인자 확인 필요).
- **localStorage 키 5개 (W3 관련)**:
  - `left-panel-hidden` — 패널 숨김 boolean
  - `spyglass:panel-width` — 패널 너비 px
  - `left-panel-state` — 섹션별 접힘 JSON
  - `spyglass:lastProject` — 마지막 선택 프로젝트
  - 키 일관성: `spyglass:` 접두사가 일부에만 있음. 통일 후보.

### 추가 인터랙션 후보 (현재 부재)

- 프로젝트 검색 (이름 fuzzy)
- 세션 검색 (id/preview)
- 활성 세션만 필터 토글
- 활성 세션 빠른 점프
- 컨텍스트 메뉴 (오른쪽 클릭으로 세션 닫기 등)

---

## 최종 기능 개수 (W3)

- 패널 컨테이너: 4개 (숨김/펼침/너비 리사이즈/Auto-fit)
- 패널 토글 버튼: 3개 (위치/Hover/회전 SVG)
- 프로젝트 섹션: 7개 (이름/세션수/토큰바/title/선택/클릭/skeleton)
- 세션 섹션: 8개 (sess-id/상대시간/토큰/활성표시/미리보기/정렬/hint/클릭)
- 툴 통계 섹션: 6개 (라벨/(전체)/카운트/아이콘/호출비율/평균토큰)
- 섹션별 접기 토글: 3개 (3섹션 각각)
- localStorage 영속화: 4개 키
- 자동 프로젝트 활성화: 1개 (3단계 우선순위)
- 30초 polling: 1개

총 **약 37개 기능**.

## 발견된 누락·모호 (Phase 2 입력)

1. 섹션 토글 버튼 마크업이 index.html에 없음 — 동적 삽입인지 screen-inventory가 outdated인지 확인 필요
2. 키보드 내비게이션 전무 (↑↓ Enter)
3. ARIA(role/aria-expanded/aria-selected) 부족
4. 토글 버튼과 resize-handle의 우측 가장자리 충돌 위험
5. 토큰 바 색상이 프로젝트/툴 통계에서 다름 (의도/일관성 검토)
6. toolIconHtml 사본 분산 (renderers.js vs left-panel.js)
7. localStorage 키 prefix 비일관 (`spyglass:` vs 무접두사)
8. 프로젝트/세션 검색·필터 부재
9. 활성 세션 빠른 점프 부재
10. 행에 `:focus-visible`/`aria-selected` 부재
