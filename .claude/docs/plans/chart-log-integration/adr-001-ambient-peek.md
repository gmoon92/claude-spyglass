# ADR-001: Ambient Peek — 로그 최우선, 차트는 배경 존재

> Feature: chart-log-integration
> 상태: **제안됨** (2026-04-21)

---

## 1. 컨셉명과 핵심 메타포

**Ambient Peek** — "심박 모니터처럼, 평소엔 작게 뛰다가 이상 징후에 눈길을 준다"

차트는 로그 영역을 침범하지 않는다. 평소에는 피드 헤더 우측에 스파크라인(20px 높이)과
숫자 뱃지만 보여준다. 사용자가 그 위에 호버하거나 클릭하면 플로팅 패널이 펼쳐져
전체 차트를 보여준다. 로그 피드가 항상 전체 높이를 점유하는 것이 원칙이다.

---

## 2. 레이아웃 스케치

### 기본 상태 (로그 최우선)

```
┌─────────────────────────────────────────────────┐
│ RIGHT PANEL                                      │
│                                                  │
│ ┌─ 최근 요청 ─────────── [⌕ search] [필터] ──┐  │
│ │  ████ sparkline (20px) │ 247req │ 89%cache │  │  ← 헤더에 인라인
│ ├──────────────────────────────────────────────┤  │
│ │ Time   Action  Target  Model  Message  ...   │  │
│ │ 14:32  tool    Read    sonnet  ...           │  │
│ │ 14:31  prompt  Agent   sonnet  ...           │  │
│ │ 14:31  tool    Write   sonnet  ...           │  │
│ │ 14:30  prompt  —       opus    ...           │  │
│ │ ...                                          │  │
│ │ ...                                          │  │
│ │ ...                (전체 높이 사용)           │  │
│ └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 차트 호버/클릭 시 (플로팅 오버레이)

```
┌─────────────────────────────────────────────────┐
│ RIGHT PANEL                                      │
│                                                  │
│ ┌─ 최근 요청 ──────────────────────────────────┐ │
│ │  ████ sparkline │ 247req │ 89%cache          │ │
│ ├──────────────────────────────────────────────┤ │
│ │ Time   Action  Target  ┌──────────────────┐  │ │
│ │ 14:32  tool    Read    │ 요청 추이 (30분)  │  │ │
│ │ 14:31  prompt  Agent   │ ▁▂▃▅▇█▆▄▃▂      │  │ │
│ │ 14:31  tool    Write   │──────────────────│  │ │
│ │ 14:30  prompt  —       │ ● prompt  42%    │  │ │
│ │ ...                    │ ● tool    38%    │  │ │  ← 우측 상단 플로팅
│ │ ...                    │ ● agent   20%    │  │ │
│ │ ...                    ├──────────────────┤  │ │
│ │ ...                    │ Hit Rate ████ 89%│  │ │
│ │ ...                    │ Saved    $0.042  │  │ │
│ │ ...                    └──────────────────┘  │ │
│ └──────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

스파크라인: 피드 헤더 좌측 영역에 `<canvas>` 20px 높이 인라인 삽입.
플로팅 패널: `position: fixed` 또는 `position: absolute` + `z-index` 상위 레이어.
클릭으로 고정(pin), 바깥 클릭으로 닫기.

---

## 3. 인터랙션 흐름

### 차트를 보고 싶을 때
1. 피드 헤더의 스파크라인/숫자 영역에 **호버** → 플로팅 패널이 0.2s ease-out으로 등장
2. 패널 안에서 마우스를 움직이는 동안 패널 유지
3. 마우스가 패널과 트리거 영역 밖으로 나가면 0.3s 후 자동 닫힘
4. 클릭하면 **pin 상태**로 고정 — 다시 클릭하거나 패널 우상단 × 버튼으로 닫기

### 로그에 집중하고 싶을 때
- 아무것도 하지 않는다. 기본 상태가 이미 로그 전체화면이므로 별도 조작 불필요.
- 플로팅 패널이 열려 있다면 × 또는 바깥 클릭으로 닫으면 끝.

### detailView(세션 상세) 전환 시
- 스파크라인이 해당 세션의 Accumulated Tokens 미니 라인으로 교체
- 플로팅 패널 내용도 세션 컨텍스트 차트로 전환

---

## 4. 기술적 실현 방식

### 스파크라인 인라인 캔버스
```
view-section-header
  ├── span.panel-label "최근 요청"
  ├── canvas#sparklineInline  (width: 60px, height: 20px)  ← 신규
  ├── span.sparkline-stat "247 req"                         ← 신규
  ├── span.sparkline-stat "89% cache"                       ← 신규
  └── div.feed-controls (기존 유지)
```
- Chart.js `type: 'line'`로 미니 렌더, `responsive: false`, `animation: false`
- 기존 `timelineChart` 데이터를 공유하여 별도 API 호출 없음

### 플로팅 패널
```css
.chart-float-panel {
  position: absolute;          /* right-panel 기준 */
  top: 36px; right: 8px;
  width: 320px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,.35);
  z-index: 100;
  opacity: 0;
  transform: translateY(-6px);
  transition: opacity .2s ease, transform .2s ease;
  pointer-events: none;
}
.chart-float-panel.visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}
```

### 상태 관리 (JS)
- `chartFloatState`: `'hidden' | 'hover' | 'pinned'`
- mouseenter/mouseleave 이벤트 + `setTimeout` 300ms 지연으로 자연스러운 닫힘
- 기존 `#btnToggleChart` 로직 제거 or 하위 호환 유지 선택 가능

### CSS 레이아웃 변화
- `#chartSection` 완전 제거 (DOM에서 삭제 또는 `display: none`)
- `right-panel`의 flex 구조는 `content-switcher` 하나만 남아 100% 사용
- 변경 범위: `default-view.css`의 `#chartSection` 블록 전면 재작성

---

## 5. 장점 / 단점 / 리스크

### 장점
1. **로그 영역 최대화**: chartSection 제거로 약 180–220px 추가 확보. 10개 이상 행이 항상 보임.
2. **인지 부하 최소**: 차트 정보가 필요 없을 때 완전히 시야에서 제거. 모니터링 집중 모드.
3. **컨텍스트 보존**: 호버 시 로그 스크롤 위치 유지 — 차트를 보다가 돌아와도 피드 위치 그대로.

### 단점
1. **차트 발견성 저하**: 스파크라인이 너무 작아 신규 사용자가 전체 차트 존재를 모를 수 있음.
2. **호버 인터랙션 불안정**: 마우스 이동 경로에 따라 패널이 깜빡이는 문제 발생 가능 (트리거-패널 사이 gap).
3. **모바일/터치 불리**: hover 기반이므로 터치 환경에서 차트 접근이 클릭 전용으로만 가능.

### 리스크
1. **Chart.js 이중 인스턴스**: 스파크라인과 플로팅 패널이 동일 데이터를 서로 다른 canvas에 그릴 때 메모리 관리 주의.
2. **기존 `btnToggleChart` 로직 충돌**: 현재 chart-collapsed CSS 전환 로직과 공존하려면 상태 분리 작업 필요.
3. **플로팅 패널 z-index 경합**: detailView의 툴팁, 간트 차트 레이어와 z-index 충돌 가능성.

---

## 6. 적합한 사용 시나리오

**이 안이 최적인 사용자 패턴:**
- 하루 종일 claude-spyglass를 사이드 모니터에 열어두고 **로그 흐름을 주시**하는 유형
- 차트는 "뭔가 이상하다" 싶을 때만 확인 — 평소에는 피드 텍스트 정보로 충분
- 화면 세로 공간이 제한적인 13–14인치 노트북 사용자
- 실시간 디버깅 중 메시지/토큰/duration 수치를 빠르게 훑는 워크플로우

**덜 적합한 경우:**
- 차트와 로그를 동시에 비교 분석하는 성능 튜닝 워크플로우
- 대시보드를 제3자에게 공유하거나 스크린샷으로 보고서를 만드는 케이스 (차트가 잘 안 보임)

---

## 7. 시각화 보강 자료

### 7-1. Before / After 와이어프레임 (픽셀 비율 반영)

총 가용 높이를 580px 기준으로 비율 표현 (노트북 환경 기준).

```
[AS-IS: 현재 구조]                    [TO-BE: Ambient Peek]
                                      
┌──────────────────────┐              ┌──────────────────────┐
│   view-section-header│  28px        │   view-section-header│  28px
│   요청 추이 (실시간) │              │   최근 요청          │
│   ───────────────── │              │   ████ spark │247req │
├──────────────────────┤              │   89%cache  [filter] │
│   charts-inner       │ 180px        └──────────────────────┘
│   ▁▂▃▅▇█▆▄  ● 42%  │              ← chartSection 완전 제거
│   timeline   ● 38%  │              
│             ● 20%   │              ┌──────────────────────┐
│   Hit ████ 89%      │              │   feed-body          │ 552px
│   Saved    $0.042   │              │   Time  Action  ...  │
├──────────────────────┤              │   14:32 tool   Read  │
│   feed-body          │ 372px        │   14:31 prompt Agent │
│   Time  Action  ...  │              │   14:31 tool   Write │
│   14:32 tool   Read  │              │   14:30 prompt  —    │
│   14:31 prompt Agent │              │   14:29 tool   Bash  │
│   14:31 tool   Write │              │   14:29 tool   Read  │
│   14:30 prompt  —    │              │   14:28 prompt  —    │
│                      │              │   14:27 tool   Write │
└──────────────────────┘              │   14:26 tool   Glob  │
                                      │   14:25 prompt  —    │
  로그 영역: 372px (64%)              │   14:24 tool   Bash  │
  차트 영역: 208px (36%)              │   14:23 tool   Read  │
                                      │   14:22 prompt  —    │
                                      └──────────────────────┘
                                      
                                        로그 영역: 552px (95%)
                                        차트 트리거: 28px ( 5%)
                                        확보 증가: +180px (+48%)
```

---

### 7-2. 상태 다이어그램 (State Transition)

```
                     페이지 로드
                          │
                          v
              ┌─────────────────────┐
              │       HIDDEN        │
              │  (기본 상태)         │
              │  로그 전체화면       │
              └─────────────────────┘
                    │         ^
         mouseenter │         │ mouseleave
         (트리거 영역)│         │ (300ms 지연)
                    v         │
              ┌─────────────────────┐
              │       HOVER         │
              │  플로팅 패널 표시    │
              │  opacity: 0→1       │
              │  translateY(-6px→0) │
              └─────────────────────┘
                    │         ^
              click │         │ click
              (패널  │         │ (패널 내부
               내부) │         │  다시 클릭)
                    v         │
              ┌─────────────────────┐      클릭 외부
              │      PINNED         │ ─────────────────> HIDDEN
              │  패널 고정 유지      │
              │  × 버튼 표시         │      × 버튼 클릭
              │  로그 스크롤 가능    │ ─────────────────> HIDDEN
              └─────────────────────┘

  HIDDEN  → HOVER  : mouseenter (sparkline/stat 영역)
  HOVER   → HIDDEN : mouseleave + setTimeout(300ms) — 패널↔트리거 이동 중 유지
  HOVER   → PINNED : click (패널 내부)
  PINNED  → HIDDEN : click (바깥) | × 버튼 | Escape 키
  PINNED  → HIDDEN : detailView 전환 시 자동 닫힘
```

---

### 7-3. 인터랙션 타임라인 — 시나리오 스토리보드

**시나리오: "이상 신호 감지 → 차트 확인 → 원인 로그 특정 → 복귀"**

```
[Frame 1: 평상시 — 로그 모니터링 중]
┌──────────────────────────────────────┐
│ 최근 요청  ████ 247req  89%cache     │  <- 수치가 평소와 다름
│           [All][prompt][Agent]...    │     89% → 갑자기 낮아짐 감지
├──────────────────────────────────────┤
│ 14:32  tool    Read   sonnet  ...    │
│ 14:31  prompt  Agent  sonnet  ...    │
│ 14:31  tool    Write  sonnet  ...    │
│ 14:30  prompt  —      opus    ...    │
│ ...                                  │
└──────────────────────────────────────┘
           사용자: "cache 수치가 낮네?"
                      │
                      v
[Frame 2: 스파크라인에 호버 — 패널 등장]
┌──────────────────────────────────────┐
│ 최근 요청  ████ 247req [89%cache]    │  <- 마우스 올림 (호버 트리거)
│           [All][prompt][Agent]...    │
├──────────────────────────────────────┤
│ 14:32  tool   ┌────────────────────┐ │
│ 14:31  prompt │ 요청 추이 (30분)   │ │  <- 패널 등장 (0.2s ease-out)
│ 14:31  tool   │ ▁▂▃▅▇█▆▄▃▂▁▂▄▆   │ │
│ 14:30  prompt │────────────────────│ │
│ ...           │ prompt  42%        │ │
│               │ tool    38%        │ │
│               │ agent   20%        │ │
│               │────────────────────│ │
│               │ Hit Rate ████  61% │ │  <- 61%로 급락 확인
│               │ Saved    $0.018    │ │
│               └────────────────────┘ │
└──────────────────────────────────────┘
           사용자: "14:28 이후 Hit Rate 급락"
                      │
                      v
[Frame 3: 패널 클릭으로 pin — 차트 고정 후 로그 탐색]
┌──────────────────────────────────────┐
│ 최근 요청  ████ 247req  61%cache    │
│           [All][prompt][Agent]...    │
├──────────────────────────────────────┤
│ 14:32  tool   ┌────────────────────┐ │
│ 14:31  prompt │ 요청 추이 (30분) X │ │  <- pin 상태, × 표시
│ 14:30  prompt │ ▁▂▃▅▇█▆▄▃▂▁▂▄▆   │ │
│ 14:29  tool   │────────────────────│ │
│ 14:28  system │ Hit Rate ████  61% │ │  <- 14:28 system 행 발견
│ 14:27  tool   └────────────────────┘ │     (컨텍스트 주입 이벤트)
│ 14:26  prompt  —      sonnet  ...    │
│ ...                                  │
└──────────────────────────────────────┘
           사용자: "14:28 system 이벤트가 원인"
                      │
                      v
[Frame 4: × 클릭으로 패널 닫기 — 로그 집중 복귀]
┌──────────────────────────────────────┐
│ 최근 요청  ████ 247req  61%cache     │
│           [All][system]              │  <- system 필터 선택
├──────────────────────────────────────┤
│ 14:28  system  —  —  context inject  │  <- 원인 확인
│ 13:55  system  —  —  context inject  │
│ ...                                  │
│                                      │
│           (로그 전체화면 복귀)        │
└──────────────────────────────────────┘
```

---

### 7-4. 컴포넌트 해부도 — Peek Panel Anatomy

```
┌─ .view-section-header (28px 고정) ──────────────────────────────────┐
│                                                                      │
│  [panel-label]      [sparkline trigger zone ↓]      [feed-controls] │
│  "최근 요청"   ┌────────────────────────────────┐   [search][filter] │
│               │ canvas#sparklineInline          │                   │
│               │ width:60px  height:20px         │                   │
│               │ Chart.js line, responsive:false │                   │
│               └────────────────────────────────┘                   │
│               [span.sparkline-stat "247 req"]                       │
│               [span.sparkline-stat "89% cache"]                     │
│                                                                      │
│               <-- 이 영역 전체가 mouseenter 트리거 -->               │
└──────────────────────────────────────────────────────────────────────┘
         │
         │ hover / click
         v
┌─ .chart-float-panel (position:absolute, z-index:100) ─────────────┐
│  top:36px  right:8px  width:320px                                  │
│                                                                    │
│  ┌─ 패널 헤더 ──────────────────────────────────────────────────┐  │
│  │  "요청 추이 (30분)"                        [pin-icon] [×]   │  │
│  │   ^                                         ^         ^     │  │
│  │   panel-title                          pinned 표시  닫기    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─ 차트 영역 (grid 2fr / 1fr) ──────────────────────────────────┐  │
│  │                           │                                  │  │
│  │  canvas#timelineChart     │  canvas#typeChart  (90x90)       │  │
│  │  (재사용 / resize)        │  + #typeLegend                   │  │
│  │                           │                                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─ cache-panel (기존 구조 재사용) ──────────────────────────────┐  │
│  │  Hit Rate [████████░░] 89%                                   │  │
│  │  without cache  $0.073  │  actual  $0.031  │  saved  $0.042  │  │
│  │  Creation [███░░░░░░░]  Read [░░░░██████░]                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  border-radius:8px   box-shadow: 0 8px 24px rgba(0,0,0,.35)       │
│  transition: opacity .2s ease, transform .2s ease                 │
└────────────────────────────────────────────────────────────────────┘
```

---

### 7-5. CSS / JS 핵심 속성 테이블

| 요소 | CSS 속성 | JS 상태 / 이벤트 |
|---|---|---|
| `.chart-float-panel` (기본) | `opacity:0; transform:translateY(-6px); pointer-events:none` | state = `'hidden'` |
| `.chart-float-panel.visible` | `opacity:1; transform:translateY(0); pointer-events:auto` | state = `'hover'` or `'pinned'` |
| `.chart-float-panel.pinned` | `outline: 1px solid var(--accent-dim)` (고정 시각 피드백) | state = `'pinned'` |
| `#sparklineInline` | `width:60px; height:20px; cursor:pointer` | mouseenter → showPanel() |
| `.sparkline-stat` | `font-size:10px; color:var(--text-dim); cursor:pointer` | mouseenter → showPanel() |
| `#btnPinPanel` | `display:none` (hidden) → `display:block` (pinned) | click → togglePin() |
| `#btnClosePanel` | `cursor:pointer` | click → hidePanel() |
| `.sparkline-trigger-zone` | `display:flex; align-items:center; gap:6px` | mouseleave + setTimeout(300) → maybeHide() |
| `right-panel` | `position:relative` (float panel 기준점) | window resize → chart.resize() |
| `#chartSection` | `display:none` (완전 제거) | — |

---

### 7-6. 플로팅 패널 등장 애니메이션 — 3컷 프레임

```
[컷 1: t=0ms — 트리거 직전]
┌─────────────────────────────┐
│ ████ 247req  89%cache       │  <- 마우스가 spark 영역에 진입
│                             │     패널 아직 없음
│ Time   Action  Target  ...  │
│ 14:32  tool    Read    ...  │
│ 14:31  prompt  Agent   ...  │
│ ...                         │
└─────────────────────────────┘

[컷 2: t=100ms — 등장 중 (transition 진행)]
┌─────────────────────────────┐
│ ████ 247req  89%cache       │
│            ┌─────────────┐  │  <- opacity:0.5, translateY(-3px)
│ Time  Act  │ (차트 페이드 │  │     절반쯤 등장한 상태
│ 14:32 tool │  인 중...)   │  │
│ 14:31 prmt │             │  │
│ ...        └─────────────┘  │
└─────────────────────────────┘

[컷 3: t=200ms — 완전 등장]
┌─────────────────────────────┐
│ ████ 247req  89%cache       │
│            ┌─────────────┐  │  <- opacity:1, translateY(0)
│ Time  Act  │ 요청 추이   │  │     완전히 선명, 상호작용 가능
│ 14:32 tool │ ▁▂▃▅▇█▆▄▃▂ │  │
│ 14:31 prmt │─────────────│  │
│ 14:30 tool │ prompt  42% │  │
│ 14:29 prmt │ tool    38% │  │
│ ...        │ Hit ████ 89%│  │
│            └─────────────┘  │
└─────────────────────────────┘

  transition: opacity .2s ease, transform .2s ease
  keyframe 요약:
    t=0    : opacity 0,   translateY(-6px)
    t=100ms: opacity 0.5, translateY(-3px)   <- 중간 보간
    t=200ms: opacity 1,   translateY(0)
```
