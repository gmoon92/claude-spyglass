# ADR-002: Split Handle — 사용자가 직접 정하는 공간 분배

> Feature: chart-log-integration
> 상태: **제안됨** (2026-04-21)

---

## 1. 컨셉명과 핵심 메타포

**Split Handle** — "IDE의 분할 창처럼, 지금 내가 필요한 만큼 경계선을 당긴다"

chartSection과 content-switcher 사이에 드래그 가능한 리사이즈 핸들을 두어
사용자가 원하는 비율로 즉시 조절한다. 차트를 완전히 접으면 핸들이 상단으로 붙어
로그가 전체를 차지한다. 반대로 차트를 크게 당기면 상세 분석 모드가 된다.
사용자의 마지막 선택은 `localStorage`에 저장되어 다음 접속에도 유지된다.

---

## 2. 레이아웃 스케치

### 기본 상태 (균형 배분 — 차트 30% / 로그 70%)

```
┌─────────────────────────────────────────────────┐
│ RIGHT PANEL                                      │
│                                                  │
│ ┌─ 요청 추이 (실시간) ──────────────── [∧] ───┐  │
│ │  ▁▂▃▅▇█▆▄    ● prompt 42%  Hit  ████ 89%  │  │
│ │  timeline    ● tool   38%  Cost $0.031     │  │  ← ~30% 높이
│ │  chart       ● agent  20%  Save $0.042     │  │
│ └──────────────────────────────────────────────┘  │
│ ┄┄┄┄┄┄┄┄┄ ══ DRAG HANDLE ══ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │  ← 6px 드래그 핸들
│ ┌─ 최근 요청 ─── [⌕ search] ── [필터 버튼들] ─┐  │
│ │ Time   Action  Target  Model  Message  ...   │  │
│ │ 14:32  tool    Read    sonnet  ...           │  │
│ │ 14:31  prompt  Agent   sonnet  ...           │  │  ← ~70% 높이
│ │ 14:31  tool    Write   sonnet  ...           │  │
│ │ ...                                          │  │
│ └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 차트 최소화 상태 (드래그로 상단에 고정)

```
┌─────────────────────────────────────────────────┐
│ RIGHT PANEL                                      │
│ ┌─ 요청 추이 (실시간) ──────────────── [∧] ───┐  │
│ └──────────────────────────────────────────────┘  │  ← 헤더(28px)만 보임
│ ══ DRAG HANDLE ══════════════════════════════  │
│ ┌─ 최근 요청 ─── [⌕ search] ── [필터 버튼들] ─┐  │
│ │ Time   Action  Target  Model  Message  ...   │  │
│ │ ...                                          │  │
│ │ ...                  (거의 전체 높이)         │  │
│ └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 차트 분석 모드 (드래그로 차트 50%)

```
┌─────────────────────────────────────────────────┐
│ RIGHT PANEL                                      │
│ ┌─ 요청 추이 (실시간) ──────────────────────────┐ │
│ │  timeline chart (크게)                       │ │
│ │  ▁▁▂▃▅▇██▇▆▄▃▂▁▂▃▄▅▅▄▃▂▁                   │ │
│ ├──────────────────────────────────────────────┤ │
│ │  ● prompt 42%   │  Hit Rate  ████████  89%  │ │  ← ~50% 높이
│ │  ● tool   38%   │  Cost w/o  $0.073         │ │
│ │  ● agent  20%   │  Actual    $0.031         │ │
│ │                 │  Saved     $0.042         │ │
│ └──────────────────────────────────────────────┘ │
│ ══ DRAG HANDLE ══════════════════════════════  │
│ ┌─ 최근 요청 ───────────────────────────────────┐ │
│ │ Time   Action  ...                           │ │  ← ~50% 높이
│ └──────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

---

## 3. 인터랙션 흐름

### 차트를 보고 싶을 때
1. 드래그 핸들에 커서를 올리면 `cursor: row-resize` 커서 변경 + 핸들 강조(배경색)
2. 위아래로 드래그 → `chartSection` 높이가 실시간으로 변경됨 (`mousemove` 이벤트)
3. 드래그 종료 시(`mouseup`) 현재 비율을 `localStorage['chartRatio']`에 저장
4. 헤더의 [∧] 버튼: 한 번 클릭으로 `chartRatio = 0` (최소화), 다시 클릭으로 저장된 비율 복원

### 로그에 집중하고 싶을 때
1. 핸들을 위로 끝까지 드래그 → chartSection이 헤더(28px)만 남음
2. 또는 [∧] 버튼 클릭으로 즉시 최소화 (CSS transition 0.2s)
3. 로그 영역이 확장되어 약 전체 높이 – 28px 확보

### detailView(세션 상세) 전환 시
- 핸들 위치는 유지됨 — chartSection은 그대로, content-switcher 내부만 detailView로 전환
- detailView의 Accumulated Tokens Chart도 chartSection 아래 공간에서 렌더됨

---

## 4. 기술적 실현 방식

### DOM 구조 변경 최소화

현재 `right-panel` flex 구조에서 `chartSection`의 `flex-shrink: 0`을 제거하고
`flex-basis`를 동적으로 조절하는 방식을 사용한다.

```
right-panel  (flex-direction: column)
  ├── #chartSection        (flex: 0 0 <chartHeight>px)  ← JS로 height 조절
  ├── #resizeHandle        (flex: 0 0 6px)              ← 신규 요소
  └── .content-switcher    (flex: 1)                    ← 나머지 자동
```

### 리사이즈 핸들 CSS

```css
#resizeHandle {
  flex: 0 0 6px;
  background: var(--border);
  cursor: row-resize;
  position: relative;
  transition: background .15s;
}
#resizeHandle::after {
  content: '';
  position: absolute;
  inset: -4px 0;          /* 터치 영역 확장 */
}
#resizeHandle:hover,
#resizeHandle.dragging {
  background: var(--accent-dim);
}
```

### JS 드래그 로직 (의사 코드)

```js
let startY, startHeight;
handle.addEventListener('mousedown', e => {
  startY = e.clientY;
  startHeight = chartSection.getBoundingClientRect().height;
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', stopDrag);
});
function onDrag(e) {
  const delta = e.clientY - startY;
  const next = Math.max(28, Math.min(panelHeight * 0.7, startHeight + delta));
  chartSection.style.flexBasis = next + 'px';
  // Chart.js resize trigger
  timelineChart.resize(); typeChart.resize();
}
function stopDrag() {
  localStorage.setItem('chartRatio', chartSection.offsetHeight / rightPanel.offsetHeight);
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
}
```

### Chart.js 연동
- 드래그 중 `chart.resize()` 호출로 canvas가 새 높이에 맞게 리렌더
- `throttle(16ms)` 적용으로 60fps 드래그 성능 유지

### 최소/최대 제한
- 최소 차트 높이: 28px (헤더만)
- 최대 차트 높이: `rightPanel.offsetHeight * 0.7`
- 최소 로그 높이: `rightPanel.offsetHeight * 0.3`

---

## 5. 장점 / 단점 / 리스크

### 장점
1. **사용자 자율성 최대**: IDE처럼 자신의 워크플로우에 맞게 공간을 직접 설정. 학습 비용 없음.
2. **상태 기억**: localStorage 저장으로 재접속 후에도 선호 비율 유지. 매번 조작 불필요.
3. **점진적 공개**: 차트를 완전히 숨기지 않고 헤더만 남겨 존재를 잊지 않음. 발견성 유지.

### 단점
1. **드래그 중 Chart.js resize 비용**: `chart.resize()` 빈번 호출로 고사양 데이터에서 드롭 가능. throttle 필수.
2. **터치/트랙패드 UX 열위**: 세로 드래그가 스크롤과 충돌. 터치 환경에서 핸들 조작이 까다로움.
3. **UI 복잡도 증가**: 드래그 핸들이 인터페이스에 새로운 조작 요소를 추가 — 미니멀한 현재 디자인과 이질적일 수 있음.

### 리스크
1. **Chart.js canvas height 0 처리**: flexBasis가 28px(헤더만)일 때 canvas 높이가 0이 되어 Chart.js 에러 발생 가능. `chartSection.chart-collapsed` 상태와의 공존 로직 필요.
2. **window resize 이벤트 충돌**: 브라우저 창 크기 변경 시 저장된 `chartRatio`를 픽셀로 재계산하는 로직이 없으면 비율이 깨짐.
3. **기존 `btnToggleChart` 접기 CSS 전환 재작업**: 현재 `grid-template-rows` 기반 collapse 로직이 flexBasis 기반과 충돌. 토글 버튼 동작 재정의 필요.

---

## 6. 적합한 사용 시나리오

**이 안이 최적인 사용자 패턴:**
- 차트와 로그를 **동시에** 보며 상관관계를 분석하는 성능 튜닝 워크플로우
- 아침에는 차트 크게(트렌드 파악), 오후에는 로그 크게(디버깅)처럼 **시간대별로 요구가 달라지는** 유형
- IDE(VS Code, IntelliJ) 분할 창 조작에 익숙한 개발자
- 4K 또는 27인치 이상 대형 모니터에서 세로 공간이 충분한 환경

**덜 적합한 경우:**
- 항상 동일한 뷰를 원하며 레이아웃을 직접 조작하기 싫은 유형 (설정 후 잊어버리는 사용자에게는 적합하나, 처음 접하면 핸들 존재 자체를 모를 수 있음)
- 터치 스크린 또는 트랙패드 세밀 조작이 어려운 환경

---

## 7. 시각화 보강 자료

### 7-1. Before / After 와이어프레임 (픽셀 비율 반영)

총 가용 높이 580px 기준. 기본 저장 비율 chartRatio=0.30 기준.

```
[AS-IS: 현재 구조]                     [TO-BE: Split Handle — 30/70 기본]

┌──────────────────────┐               ┌──────────────────────┐
│  view-section-header │  28px         │  view-section-header │  28px
│  요청 추이 (실시간)  │               │  요청 추이 (실시간)  │
├──────────────────────┤               │  [∧ collapse btn]    │
│  charts-inner        │ 180px         ├──────────────────────┤
│  ▁▂▃▅▇█▆▄  ● 42%   │               │  charts-inner        │ 146px
│  timeline    ● 38%  │               │  ▁▂▃▅▇█▆▄   ● 42%  │
│             ● 20%   │               │  timeline    ● 38%  │
│  Hit ████ 89%       │               │  Hit ████ 89%       │
│  Saved    $0.042    │               │  Saved    $0.042    │
├──────────────────────┤               ├──────────────────────┤
│                      │               │ == DRAG HANDLE ===== │   6px  <- 신규
├──────────────────────┤               ├──────────────────────┤
│  feed-body           │ 372px         │  feed-body           │ 400px
│  Time  Action  ...   │               │  Time  Action  ...   │
│  14:32 tool   Read   │               │  14:32 tool   Read   │
│  14:31 prompt Agent  │               │  14:31 prompt Agent  │
│  14:31 tool   Write  │               │  14:31 tool   Write  │
│  14:30 prompt  —     │               │  14:30 prompt  —     │
│                      │               │  14:29 tool   Bash   │
└──────────────────────┘               │  14:28 prompt  —     │
                                       └──────────────────────┘
  로그 영역: 372px (64%)                 로그 영역: 400px (69%)
  차트 영역: 208px (36%)                 차트 영역: 174px (30%)
  핸들:        0px  (0%)                 핸들:         6px  (1%)

[chartRatio=0 으로 드래그 시 — 로그 최대화]

┌──────────────────────┐               [chartRatio=0.5 으로 드래그 시 — 분석 모드]
│  view-section-header │  28px
│  요청 추이 [v 펼치기]│               ┌──────────────────────┐
├──────────────────────┤               │  view-section-header │  28px
│ == DRAG HANDLE ===== │   6px         ├──────────────────────┤
├──────────────────────┤               │  charts-inner        │ 257px
│  feed-body           │ 546px         │  ▁▁▂▃▅▇██▇▆▄▃▂▁    │
│  Time  Action  ...   │               │  (timeline chart     │
│  (최대 높이 확보)     │               │   도넛 + cache 패널) │
│                      │               ├──────────────────────┤
│                      │               │ == DRAG HANDLE ===== │   6px
│                      │               ├──────────────────────┤
│                      │               │  feed-body           │ 289px
│                      │               │  Time  Action  ...   │
└──────────────────────┘               └──────────────────────┘
  로그 영역: 546px (94%)                 로그 영역: 289px (50%)
  차트 영역:   0px  (0%)                 차트 영역: 285px (49%)
```

---

### 7-2. 상태 다이어그램 (State Transition)

```
                      페이지 로드
                           │
                           v
                ┌────────────────────┐
                │      RESTORED      │
                │  localStorage에서  │
                │  chartRatio 복원   │
                │  (없으면 0.30 기본) │
                └────────────────────┘
                           │
                    flexBasis 적용
                           v
              ┌────────────────────────┐
              │         IDLE           │
              │  현재 비율로 표시 중   │
              │  차트 + 핸들 + 로그    │
              └────────────────────────┘
              │            │            │
    [∧] 버튼  │            │ handle     │ [∧] 버튼
    클릭       │            │ mousedown  │ 클릭
    (ratio>0) │            │            │ (ratio=0)
              v            v            v
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │  COLLAPSED   │  │   DRAGGING   │  │   EXPANDED   │
    │              │  │              │  │  (ratio 복원) │
    │ chartSection │  │ mousemove로  │  │              │
    │ 헤더 28px 만 │  │ flexBasis    │  │ 저장 ratio로 │
    │ 핸들 최상단  │  │ 실시간 조절  │  │ 차트 복원    │
    └──────────────┘  └──────────────┘  └──────────────┘
              ^            │
              │            │ mouseup
    handle    │            v
    drag down │   ┌──────────────────┐
              │   │    SAVE_RATIO    │
              └───│  localStorage에  │
                  │  비율 저장       │
                  └──────────────────┘
                           │
                           v
                         IDLE

  snap 포인트 (선택 구현): 핸들 드래그 중 25%/50%/75% 근처 8px 이내에서 자석처럼 흡착
```

---

### 7-3. 인터랙션 타임라인 — 시나리오 스토리보드

**시나리오: "오전 분석 모드 → 오후 디버깅 모드 전환 → 다음날 복원"**

```
[Frame 1: 오전 — 분석 모드 (chartRatio=0.5)]
┌──────────────────────────────────────────┐
│ 요청 추이 (실시간)         [∧ 접기]      │
│ ▁▁▂▃▅▇██▇▆▄▃▂▁▂▃▄▅▅▄▃▂▁               │  <- 차트 크게 보며
│ ──────────────────────────────────────  │     트렌드 파악
│  ● prompt 42%   Hit Rate ████████  89% │
│  ● tool   38%   Cost w/o  $0.073       │
│  ● agent  20%   Saved     $0.042       │
│══════════════ DRAG HANDLE ═════════════│  <- 핸들 위치: 중간
│ 최근 요청  [search] [All][prompt]...   │
│ 14:32  tool  Read   sonnet  ...        │
│ 14:31  prompt Agent sonnet  ...        │
└──────────────────────────────────────────┘
           사용자: "오후에는 디버깅에 집중해야지"
                          │
                          v
[Frame 2: 핸들 위로 드래그 중 — 실시간 리사이즈]
┌──────────────────────────────────────────┐
│ 요청 추이 (실시간)         [∧ 접기]      │  <- 차트 축소 중
│ ▁▂▃▅▇█▆▄    ● 42%  Hit ████ 89%        │     (cursor: row-resize)
│══[handle dragging — cursor:row-resize]═│  <- 핸들 올라가는 중
│ 최근 요청  [search] [All][prompt]...   │     차트: 실시간 resize()
│ 14:32  tool  Read   sonnet  ...        │
│ 14:31  prompt Agent sonnet  ...        │
│ 14:31  tool  Write  sonnet  ...        │  <- 로그 행이 늘어남
│ 14:30  prompt  —    opus    ...        │
│ 14:29  tool  Bash   sonnet  ...        │
└──────────────────────────────────────────┘

[Frame 3: 드래그 완료 — 디버깅 모드 (chartRatio=0.10)]
┌──────────────────────────────────────────┐
│ 요청 추이 (실시간)         [∧]           │
│ ▁▂▃▅▇█▆▄  ● 42% ● 38%  Hit ████ 89%   │  <- 차트 최소화
│══════════════ DRAG HANDLE ═════════════│  <- 핸들 상단 근처
│ 최근 요청  [search] [All][prompt]...   │
│ 14:32  tool   Read    sonnet  ...      │
│ 14:31  prompt Agent   sonnet  ...      │
│ 14:31  tool   Write   sonnet  ...      │  <- 로그 공간 대폭 확보
│ 14:30  prompt  —      opus    ...      │
│ 14:29  tool   Bash    sonnet  ...      │
│ 14:28  system  —       —      ...      │
│ 14:27  prompt  —      sonnet  ...      │
│ 14:26  tool   Read    sonnet  ...      │
└──────────────────────────────────────────┘
           localStorage: chartRatio = 0.10 저장
                          │
                          v
[Frame 4: 다음날 재접속 — 설정 자동 복원]
┌──────────────────────────────────────────┐
│ 요청 추이 (실시간)         [∧]           │  <- chartRatio=0.10 복원
│ ▁▂▃▅▇█▆▄  ● 42% ● 38%  Hit ████ 72%   │     재설정 불필요
│══════════════ DRAG HANDLE ═════════════│
│ 최근 요청  [search] [All][prompt]...   │
│ ...                                    │
└──────────────────────────────────────────┘
           사용자: "어제 설정 그대로다"
```

---

### 7-4. 컴포넌트 해부도 — Drag Handle Anatomy

```
<right-panel> (position:relative, flex-direction:column)
  │
  ├── #chartSection  (flex: 0 0 <chartHeight>px)
  │   ├── .view-section-header  [∧ 버튼 포함]
  │   └── .charts-inner
  │
  ├── #resizeHandle  (flex: 0 0 6px)  ← 핵심 신규 요소
  │   │
  │   │  ┌── 시각적 구조 (확대) ─────────────────────────────────────────┐
  │   │  │                                                               │
  │   │  │  ╔═══════════════════════════════════════════════════════╗   │
  │   │  │  ║  실제 클릭 영역: height 6px                            ║   │
  │   │  │  ║  background: var(--border)                            ║   │
  │   │  │  ║  cursor: row-resize                                   ║   │
  │   │  │  ╚═══════════════════════════════════════════════════════╝   │
  │   │  │                                                               │
  │   │  │  ::after 가상요소 (투명 확장 영역):                          │
  │   │  │  ┌───────────────────────────────────────────────────────┐   │
  │   │  │  │  inset: -4px 0  →  실제 터치 가능 높이: 14px          │   │
  │   │  │  │  (위 4px + 본체 6px + 아래 4px)                       │   │
  │   │  │  └───────────────────────────────────────────────────────┘   │
  │   │  │                                                               │
  │   │  │  hover / .dragging 상태:                                     │
  │   │  │  ╔═══════════════════════════════════════════════════════╗   │
  │   │  │  ║  background: var(--accent-dim)  ← 강조 피드백         ║   │
  │   │  │  ╚═══════════════════════════════════════════════════════╝   │
  │   │  │                                                               │
  │   │  │  snap 포인트 (선택 구현):                                    │
  │   │  │    25% 위치에서 ±8px 이내 → 자동 흡착                       │
  │   │  │    50% 위치에서 ±8px 이내 → 자동 흡착                       │
  │   │  │    75% 위치에서 ±8px 이내 → 자동 흡착                       │
  │   │  └───────────────────────────────────────────────────────────────┘
  │   │
  │   └── 드래그 가이드라인 (선택 구현):
  │       드래그 중 전체 패널 너비에 걸친 점선 표시
  │       position:fixed, z-index:200, border-top: 1px dashed var(--accent)
  │
  └── .content-switcher  (flex: 1)
```

---

### 7-5. CSS / JS 핵심 속성 테이블

| 요소 | CSS 속성 | JS 상태 / 이벤트 |
|---|---|---|
| `#chartSection` (기본) | `flex: 0 0 <chartHeight>px` | `chartHeight = panel * 0.30` (초기값) |
| `#chartSection` (collapsed) | `flex: 0 0 28px` | `[∧] 클릭 → chartHeight = 28` |
| `#resizeHandle` | `flex: 0 0 6px; cursor:row-resize` | mousedown → startDrag() |
| `#resizeHandle::after` | `inset: -4px 0` (터치 영역 확장) | — |
| `#resizeHandle:hover` | `background: var(--accent-dim)` | — |
| `#resizeHandle.dragging` | `background: var(--accent-dim)` | class 토글로 표시 |
| `.content-switcher` | `flex: 1; min-height: 0` | 변경 없음 — 자동 fill |
| `document` (드래그 중) | `user-select: none` (텍스트 선택 방지) | mousemove → onDrag() |
| `timelineChart` | — | onDrag() 내 `chart.resize()` throttle 16ms |
| `typeChart` | — | onDrag() 내 `chart.resize()` throttle 16ms |
| `localStorage['chartRatio']` | — | mouseup → stopDrag() 에서 저장 |
| `localStorage['chartRatio']` | — | DOMContentLoaded 에서 복원 |

---

### 7-6. 핸들 드래그 UX 세부 — 커서·가이드라인·스냅

```
[드래그 시작 — mousedown]
┌──────────────────────────────────────────┐
│  charts-inner                            │
│  ▁▂▃▅▇█▆▄▃▂▁▂▃▄▅                       │
│                                          │
│ ·········· [handle: mousedown] ·········│  <- cursor: row-resize
│                                          │     .dragging 클래스 추가
│  feed-body                              │     background: accent-dim
│  Time   Action   Target   ...           │
└──────────────────────────────────────────┘

[드래그 진행 — mousemove (100px 위로 이동)]
┌──────────────────────────────────────────┐
│  charts-inner (축소 중)                  │
│  ▁▂▃▅▇█▆▄                              │
╌╌╌╌╌╌╌╌╌╌ [가이드라인: dashed] ╌╌╌╌╌╌╌╌│  <- position:fixed
│                                          │     z-index:200
│ ══════════ [handle 이동] ═══════════════ │     border-top:1px dashed var(--accent)
│                                          │
│  feed-body (확장 중)                     │
│  Time   Action   Target   ...           │
│  (행 추가됨)                             │
└──────────────────────────────────────────┘

[스냅 포인트 흡착 — 50% 근처 접근]
┌──────────────────────────────────────────┐
│  charts-inner                            │
│  (정확히 50% 높이)                       │
╌╌╌╌╌╌╌╌╌╌ [50% 스냅: 흡착] ╌╌╌╌╌╌╌╌╌╌╌│  <- ±8px 이내 진입 시
│ ══════════ [handle: snapped] ══════════ │     flexBasis = panelHeight * 0.5
│                                          │     (snap 피드백: 짧은 진동 or 색상)
│  feed-body                              │
│  (정확히 50% 높이)                       │
└──────────────────────────────────────────┘

[드래그 종료 — mouseup]
  → localStorage.setItem('chartRatio', 0.50)
  → .dragging 클래스 제거
  → 가이드라인 숨김
  → document.removeEventListener('mousemove', onDrag)
```
