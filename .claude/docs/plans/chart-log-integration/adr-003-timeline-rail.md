# ADR-003: Timeline Rail — 차트와 로그가 같은 시간축으로 묶인다

> Feature: chart-log-integration
> 상태: **제안됨** (2026-04-21)

---

## 1. 컨셉명과 핵심 메타포

**Timeline Rail** — "철도 노선도처럼, 상단 바에서 시간을 짚으면 로그가 그 지점으로 따라온다"

chartSection을 분리된 패널로 두지 않는다. 대신 `content-switcher` 상단에
**10–24px 높이의 수평 타임라인 바**를 고정 배치한다. 이 바에는 요청 밀도(히트맵)와
타입별 색상 스트라이프가 압축되어 표시된다. 바의 특정 지점을 클릭·드래그하면
피드 테이블이 해당 시간대로 즉시 점프한다. 도넛 차트와 Cache Intelligence는
헤더 우측의 컴팩트 뱃지 형태로 축약되어 항상 보인다.
이 안은 "차트를 어디에 배치할까"가 아니라 "차트와 로그를 하나로 합칠 수 없을까"라는
질문에서 출발한다.

---

## 2. 레이아웃 스케치

### 기본 상태 (로그 전체 + 상단 Rail)

```
┌─────────────────────────────────────────────────┐
│ RIGHT PANEL                                      │
│                                                  │
│ ┌─ 최근 요청 ─── ●42% ▪38% ▴20% │ 89%cache ──┐  │  ← 헤더 우측: 컴팩트 뱃지
│ ├──────────────────────────────────────────────┤  │
│ │▓▓░▓▓▓░░▓▓▓▓░▓▓▓░░░▓▓▓▓▓░░▓▓▓▓▓▓░░░░▓▓▓░░░│  │  ← Timeline Rail (16px)
│ │  13:50        14:00        14:10        14:20 │  │    시간 눈금 레이블
│ ├──────────────────────────────────────────────┤  │
│ │ [⌕ search]  [All][prompt][Agent][Skill]...  │  │
│ ├──────────────────────────────────────────────┤  │
│ │ Time   Action  Target  Model  Message  ...   │  │
│ │ 14:32  tool    Read    sonnet  ...           │  │
│ │ 14:31  prompt  Agent   sonnet  ...           │  │
│ │ 14:31  tool    Write   sonnet  ...           │  │  ← 피드 전체 높이
│ │ 14:30  prompt  —       opus    ...           │  │
│ │ ...                                          │  │
│ └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

타임라인 바 범례: `▓` = 높은 요청 밀도, `░` = 낮은 밀도 / 색상은 지배적 타입 반영

### 타임라인 구간 클릭/드래그 선택 시

```
┌─────────────────────────────────────────────────┐
│ ┌─ 최근 요청 ─── ●42% ▪38% ▴20% │ 89%cache ──┐  │
│ ├──────────────────────────────────────────────┤  │
│ │▓▓░▓▓▓░░▓▓[▓▓▓░▓▓▓░░░▓]▓▓▓░░░▓▓░░░░▓▓▓░░░│  │  ← 구간 하이라이트(선택)
│ │  13:50     14:02    14:10    14:18    14:25  │  │
│ ├──────────────────────────────────────────────┤  │
│ │ [⌕ search]  [All][prompt]...  ← 14:02–14:10 │  │  ← 선택 구간 필터 표시
│ ├──────────────────────────────────────────────┤  │
│ │ 14:09  tool    Bash    sonnet  ...           │  │  ← 선택 구간 행만 표시
│ │ 14:08  prompt  Agent   sonnet  ...           │  │
│ │ 14:07  tool    Read    opus    ...           │  │
│ │ 14:06  prompt  —       sonnet  ...           │  │
│ └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 타임라인 바 호버 시 (미니 팝오버)

```
│▓▓░▓▓▓░░▓▓▓▓░▓[14:05]░░▓▓▓▓░░░░▓▓▓░░░│
│             ┌──────────────┐           │
│             │ 14:05:32     │           │  ← 호버 팝오버 (hover tooltip)
│             │ prompt × 3   │           │
│             │ tool_call × 7│           │
│             └──────────────┘           │
```

---

## 3. 인터랙션 흐름

### 차트를 보고 싶을 때
1. 헤더 우측 뱃지(●42% ▪38%) 위에 호버 → 작은 도넛 팝오버 등장 (ADR-001 플로팅 패턴과 동일하게 처리 가능)
2. 타임라인 바 위에 마우스를 올리면 해당 시각의 툴팁(시간 + 요청 분류 요약) 표시
3. 전체 추이가 궁금하면 Rail 자체를 보면 됨 — 별도 차트 패널 없이도 밀도/타입 흐름 파악 가능

### 로그에 집중하고 싶을 때
- 기본 상태가 이미 로그 전체화면. Rail은 16px로 최소 공간만 차지.
- Rail 클릭/드래그로 오히려 로그를 **필터링**하는 도구로 활용 — "이 시간대 로그만 보기"

### 시간 구간 필터링 (이 안의 고유 기능)
1. 타임라인 바에서 드래그로 시간 범위 선택 → 피드 테이블이 해당 범위만 표시
2. 헤더에 "14:02 – 14:10" 구간 배지 표시 + × 버튼으로 해제
3. 세션 상세(detailView)로 전환 시: Accumulated Tokens Rail로 교체됨

### detailView(세션 상세) 전환 시
- Rail 내용이 세션 전체 타임라인(컨텍스트 토큰 누적 바)으로 교체
- 기존 `context-chart-section`(Accumulated Tokens Chart)은 Rail로 흡수 — 별도 섹션 제거 가능

---

## 4. 기술적 실현 방식

### DOM 구조

```
right-panel  (flex-direction: column)
  └── .content-switcher (flex: 1)
        └── #defaultView / #detailView  (right-view active)
              ├── .view-section-header   ← 컴팩트 뱃지 추가
              ├── #timelineRail          ← 신규: 16px 고정 높이  (★)
              ├── .feed-controls-bar     ← 기존 필터 영역
              └── .feed-body             ← 피드 테이블
```

기존 `#chartSection` 완전 제거. `right-panel` 레이아웃 단순화.

### Timeline Rail 렌더링

**옵션 A: Canvas 단일 렌더**
```js
// 30분 구간을 N개 버킷으로 분할
// 버킷별 요청 수 → 밀도(opacity) 계산
// 버킷별 지배 타입 → 색상(CSS 변수) 매핑
// requestAnimationFrame으로 SSE 수신 시마다 증분 업데이트
const ctx = railCanvas.getContext('2d');
// drawRect per bucket: x, y=0, w=bucketWidth, h=16
// color = typeColorMap[dominantType] with opacity = density/maxDensity
```

**옵션 B: SVG rect 배열** (DOM 업데이트 비용 있으나 CSS 스타일링 용이)

권장: **Canvas** — SSE 실시간 업데이트에 최적, Chart.js 의존성 없이 경량 구현 가능.

### 컴팩트 뱃지 (헤더 우측)

```html
<div class="rail-stat-badges">
  <span class="rail-badge" data-type="prompt">● <span id="railPct-prompt">42</span>%</span>
  <span class="rail-badge" data-type="tool">▪ <span id="railPct-tool">38</span>%</span>
  <span class="rail-badge cache">⚡ <span id="railCacheHit">89</span>%</span>
</div>
```

```css
.rail-badge { font-size: 10px; color: var(--text-dim); padding: 0 4px; }
.rail-badge[data-type="prompt"] { color: var(--type-prompt); }
```

### 시간 범위 필터링 로직

```js
let railSelection = null; // { startMs, endMs } | null
railCanvas.addEventListener('mousedown', startSelection);
// drag → update selection rect overlay
// mouseup → railSelection = { startMs, endMs }; rerenderFeed();
// × badge click → railSelection = null; rerenderFeed();
```

`rerenderFeed()`는 기존 `prependRequest` / 필터 로직에 `railSelection` 조건을 추가.

### CSS 레이아웃 변화

```css
#timelineRail {
  flex: 0 0 16px;
  position: relative;
  border-bottom: 1px solid var(--border);
  cursor: crosshair;
}
#timelineRail canvas {
  display: block;
  width: 100%;
  height: 16px;
}
```

---

## 5. 장점 / 단점 / 리스크

### 장점
1. **로그 공간 최대화**: chartSection(180–220px) 완전 제거. Rail 16px + 헤더 뱃지만 사용. 가장 많은 공간 확보.
2. **차트-로그 시간축 통합**: 독립된 두 UI 요소를 하나의 인터랙션으로 묶음. 시간대 필터링이라는 실용적 기능 제공.
3. **Chart.js 의존 제거 가능**: 타임라인/도넛 차트를 경량 Canvas 직접 렌더로 대체 — 번들 크기 감소, 라이프사이클 단순화.

### 단점
1. **구현 복잡도 최고**: 기존 Chart.js 3개 차트(timeline, donut, contextGrowth)를 모두 재구현하거나 Rail로 흡수해야 함. 개발 공수가 가장 큼.
2. **정보 손실 가능성**: 16px Rail이 기존 타임라인 차트(height=100) 수준의 세부 정보를 전달할 수 없음. 추이의 "형태"는 보이지만 Y축 스케일, 절대값 파악 불가.
3. **학습 비용**: Rail 드래그로 필터링하는 인터랙션이 직관적이지 않아 처음 접하는 사용자가 기능을 발견하지 못할 수 있음.

### 리스크
1. **기존 차트 코드 전면 재작성**: `timelineChart`, `typeChart`, `contextGrowthChart` 모두 영향. 리그레션 범위가 가장 넓음.
2. **시간 범위 필터와 기존 타입 필터 충돌**: 두 필터가 AND 조건으로 동작해야 하므로 `rerenderFeed()` 로직 재설계 필요.
3. **detailView Rail 교체 동기화**: defaultView(요청 밀도) ↔ detailView(컨텍스트 토큰) 전환 시 Rail 콘텐츠 교체 타이밍이 content-switcher 전환 애니메이션과 맞물려야 함.

---

## 6. 적합한 사용 시나리오

**이 안이 최적인 사용자 패턴:**
- "14시에 갑자기 요청이 폭발했는데 무슨 일이었지?"처럼 **시간축 탐색**을 자주 하는 유형
- 로그 피드를 스크롤로 내리는 대신 "타임라인을 짚어서 그 시점으로 점프"하고 싶은 유형
- 차트의 Y축 절대값보다 **패턴과 흐름**에 관심 있는 사용자
- 화면 공간을 극단적으로 아끼고 싶은 환경 (소형 모니터, 세로 분할 레이아웃)
- 장기적으로 claude-spyglass를 "로그 뷰어 + 경량 분석 도구"로 발전시키고 싶은 방향

**덜 적합한 경우:**
- 캐시 비용 절감 수치(Cost without / Actual / Saved)를 항상 한눈에 확인해야 하는 유형 (뱃지에 축약되면 정보 밀도 부족)
- 차트의 정확한 수치(요청 수 Y축, 비율 퍼센트)를 정기 보고에 활용하는 케이스

---

## 7. 시각화 보강 자료

### 7-1. Before / After 와이어프레임 (픽셀 비율 반영)

총 가용 높이 580px 기준.

```
[AS-IS: 현재 구조]                     [TO-BE: Timeline Rail]

┌──────────────────────┐               ┌──────────────────────┐
│  view-section-header │  28px         │  view-section-header │  28px
│  요청 추이 (실시간)  │               │  최근 요청           │
├──────────────────────┤               │  [●42% ▪38% ▴20%]   │
│  charts-inner        │ 180px         │  [89%cache]  [filter]│
│  ▁▂▃▅▇█▆▄  ● 42%   │               └──────────────────────┘
│  timeline    ● 38%  │               ← chartSection 완전 제거
│  Hit ████ 89%       │               
│  Saved    $0.042    │               ┌──────────────────────┐
├──────────────────────┤               │  #timelineRail       │  16px  <- 신규
│  feed-body           │ 372px         │  ▓▓░▓▓░░▓▓▓░▓▓░░▓▓  │
│  Time  Action  ...   │               └──────────────────────┘
│  14:32 tool   Read   │               ┌──────────────────────┐
│  14:31 prompt Agent  │               │  .feed-controls-bar  │  32px
│  14:31 tool   Write  │               │  [search] [filters]  │
│  14:30 prompt  —     │               └──────────────────────┘
│                      │               ┌──────────────────────┐
└──────────────────────┘               │  feed-body           │ 504px
                                       │  Time  Action  ...   │
  로그 영역: 372px (64%)               │  14:32 tool   Read   │
  차트 영역: 208px (36%)               │  14:31 prompt Agent  │
                                       │  14:31 tool   Write  │
                                       │  14:30 prompt  —     │
                                       │  14:29 tool   Bash   │
                                       │  14:28 system  —     │
                                       │  14:27 prompt  —     │
                                       │  14:26 tool   Read   │
                                       │  14:25 prompt  —     │
                                       │  14:24 tool   Glob   │
                                       └──────────────────────┘

                                         로그 영역: 504px (87%)
                                         Rail:        16px  (3%)
                                         헤더+컨트롤:  60px (10%)
                                         확보 증가: +132px (+35%)
```

---

### 7-2. 상태 다이어그램 (State Transition)

```
                      페이지 로드
                           │
                           v
              ┌────────────────────────┐
              │         IDLE           │
              │  Rail: 전체 구간 표시  │
              │  피드: 전체 표시       │
              │  선택 구간 없음        │
              └────────────────────────┘
                 │         │         │
      Rail       │         │ Rail    │ 뱃지
      hover      │         │ drag    │ hover
                 v         v         v
    ┌──────────────┐ ┌──────────┐ ┌────────────────┐
    │   TOOLTIP    │ │SELECTING │ │  BADGE_PEEK    │
    │              │ │          │ │                │
    │ 해당 시각의  │ │ 선택 중인 │ │ 도넛/캐시 팝   │
    │ 팝오버 표시  │ │ 구간 하이 │ │ 오버 표시      │
    │ (시간+분류)  │ │ 라이트    │ │ (ADR-001 패턴) │
    └──────────────┘ └──────────┘ └────────────────┘
      mouseleave        │ mouseup      mouseleave
          │             v                  │
          v    ┌────────────────────┐      v
        IDLE   │     FILTERED       │    IDLE
               │                   │
               │ Rail: 선택 구간    │
               │ 하이라이트 유지    │
               │ 피드: 해당 구간만  │
               │ 헤더: "14:02-14:10"│
               │ 배지 + × 버튼     │
               └────────────────────┘
                    │          │
               × 클릭          │ defaultView
               or Escape       │ <-> detailView
                    │          │ 전환
                    v          v
                  IDLE    RAIL_SWAP
                          │
                          v
                 ┌────────────────────┐
                 │   DETAIL_RAIL      │
                 │ Rail 내용 교체:    │
                 │ 요청밀도 → 토큰    │
                 │ 누적 바로 전환     │
                 └────────────────────┘
                          │
                  detailView 닫기
                          v
                        IDLE
```

---

### 7-3. 인터랙션 타임라인 — 시나리오 스토리보드

**시나리오: "14시 폭발 구간 발견 → Rail로 필터 → 원인 로그 탐색 → 필터 해제"**

```
[Frame 1: 평상시 — Rail로 전체 추이 파악]
┌──────────────────────────────────────────────┐
│ 최근 요청  [●42% ▪38% ▴20%] [89%cache]      │  <- 헤더: 컴팩트 뱃지
├──────────────────────────────────────────────┤
│▓░▓░▓▓░░▓░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░▓░░░░░▓░░░░░│  <- Rail
│ 13:50    14:00    14:10    14:20    14:30    │     14:00-14:15 구간에 밀도 몰림
├──────────────────────────────────────────────┤
│ [search] [All][prompt][Agent][Skill]...      │
├──────────────────────────────────────────────┤
│ 14:32  tool    Bash    sonnet  ...           │
│ 14:31  prompt  Agent   sonnet  ...           │
│ 14:30  tool    Read    sonnet  ...           │
│ ...                                          │
└──────────────────────────────────────────────┘
           사용자: "14시 초반에 밀도가 높네, 무슨 일?"
                             │
                             v
[Frame 2: Rail 위 호버 — 툴팁 확인]
┌──────────────────────────────────────────────┐
│ 최근 요청  [●42% ▪38% ▴20%] [89%cache]      │
├──────────────────────────────────────────────┤
│▓░▓░▓▓░░▓░░[14:05]▓▓▓▓▓▓▓▓▓░░░▓░░░░░▓░░░░░│  <- 마우스 14:05 위치
│          ┌────────────────┐                  │
│          │ 14:05          │                  │  <- 팝오버 등장
│          │ prompt × 3     │                  │
│          │ tool_call × 12 │                  │
│          │ agent × 2      │                  │
│          └────────────────┘                  │
├──────────────────────────────────────────────┤
│ 14:32  tool    Bash    sonnet  ...           │
│ ...                                          │
└──────────────────────────────────────────────┘
           사용자: "tool_call이 12개, 여기를 자세히 보자"
                             │
                             v
[Frame 3: Rail 드래그 — 14:03~14:10 선택 중]
┌──────────────────────────────────────────────┐
│ 최근 요청  [●42% ▪38% ▴20%] [89%cache]      │
├──────────────────────────────────────────────┤
│▓░▓░▓▓░░▓░[░░░░░░░░░░░░░░░░]░░░▓░░░░░▓░░░░░│  <- [ ] 드래그 선택 중
│ 13:50   14:00 ^14:03  14:10^  14:20          │     반투명 오버레이
├──────────────────────────────────────────────┤     cursor: crosshair → col-resize
│ [search] [All][prompt]... 선택 중: 14:03~    │
├──────────────────────────────────────────────┤
│ (피드는 아직 필터링 전 — mouseup 후 적용)    │
│ 14:32  tool    Bash    sonnet  ...           │
└──────────────────────────────────────────────┘

[Frame 4: mouseup — 필터 적용됨]
┌──────────────────────────────────────────────┐
│ 최근 요청  [●42% ▪38% ▴20%] [89%cache]      │
├──────────────────────────────────────────────┤
│▓░▓░▓▓░░▓░[▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓]░░░▓░░░░░▓░░░░░│  <- 선택 구간 하이라이트 유지
├──────────────────────────────────────────────┤
│ [search] [All]...  [14:03 - 14:10  x]        │  <- 구간 필터 배지
├──────────────────────────────────────────────┤
│ 14:09  tool    Bash    sonnet  tool 실행     │  <- 해당 구간 행만 표시
│ 14:08  tool_call Write  sonnet  파일 저장    │
│ 14:07  tool_call Read   sonnet  파일 읽기    │
│ 14:07  tool_call Read   sonnet  파일 읽기    │
│ 14:06  tool_call Glob   sonnet  패턴 검색    │
│ 14:05  prompt   Agent   sonnet  분석 요청    │
│ 14:04  tool_call Bash   sonnet  명령 실행    │
│ 14:03  prompt    —      sonnet  시작         │
└──────────────────────────────────────────────┘
           사용자: "이 구간에 tool_call이 집중됨 확인"
                             │
                             v
[Frame 5: × 클릭 — 필터 해제, 전체 피드 복원]
┌──────────────────────────────────────────────┐
│ 최근 요청  [●42% ▪38% ▴20%] [89%cache]      │
├──────────────────────────────────────────────┤
│▓░▓░▓▓░░▓░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░▓░░░░░▓░░░░░│  <- 하이라이트 제거
├──────────────────────────────────────────────┤
│ [search] [All][prompt][Agent]...             │  <- 구간 배지 제거
├──────────────────────────────────────────────┤
│ 14:32  tool    Bash    sonnet  ...           │  <- 전체 복원
│ ...                                          │
└──────────────────────────────────────────────┘
```

---

### 7-4. 컴포넌트 해부도 — Timeline Rail Anatomy

```
┌─ #timelineRail  (flex: 0 0 16px, position:relative) ──────────────────┐
│                                                                        │
│  ┌─ canvas#railCanvas (width:100%, height:16px) ───────────────────┐  │
│  │                                                                   │  │
│  │  버킷 구조 (30분 구간 → N개 버킷, 예: 180개 = 10초/버킷):       │  │
│  │                                                                   │  │
│  │  [B1][B2][B3][B4][B5][B6]...[BN]                                │  │
│  │   ^                                                               │  │
│  │   버킷 하나 = bucketWidth px, height 16px                        │  │
│  │   fill color = typeColorMap[dominantType]                        │  │
│  │   fill opacity = requestCount / maxBucketCount                   │  │
│  │   (0~1 범위, 최솟값 0.08 보장 — 완전 투명 방지)                  │  │
│  │                                                                   │  │
│  │  색상 매핑 (CSS 변수 기반):                                       │  │
│  │    prompt    → var(--type-prompt)                                 │  │
│  │    tool_call → var(--type-tool-call)                              │  │
│  │    agent     → var(--type-agent)                                  │  │
│  │    system    → var(--type-system)                                 │  │
│  │    혼합      → var(--text-dim)                                    │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌─ .rail-time-labels (position:absolute, bottom:0) ──────────────┐  │
│  │  13:50      14:00      14:10      14:20      14:30             │  │
│  │  (5분 간격 표시, font-size:8px, color:var(--text-dim))          │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌─ .rail-selection-overlay (position:absolute, display:none) ────┐  │
│  │  드래그 선택 시 표시:                                           │  │
│  │  background: var(--accent-dim)                                  │  │
│  │  opacity: 0.4                                                   │  │
│  │  left: <startX>px, width: <dragWidth>px, height:16px           │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌─ .rail-tooltip (position:absolute, z-index:50) ────────────────┐  │
│  │  hover 시 표시 (position:absolute, top:-60px):                  │  │
│  │  ┌──────────────┐                                               │  │
│  │  │ 14:05:32     │  background: var(--surface)                  │  │
│  │  │ prompt × 3   │  border: 1px solid var(--border)             │  │
│  │  │ tool_call × 7│  font-size: 10px                             │  │
│  │  └──────────────┘                                               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  cursor: default                                                       │
│  cursor (hover 시): crosshair                                          │
│  cursor (drag 시): col-resize                                          │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 7-5. CSS / JS 핵심 속성 테이블

| 요소 | CSS 속성 | JS 상태 / 이벤트 |
|---|---|---|
| `#chartSection` | `display: none` (완전 제거) | — |
| `#timelineRail` | `flex: 0 0 16px; cursor: crosshair` | — |
| `canvas#railCanvas` | `width:100%; height:16px` | SSE 수신 시 `rAF`로 증분 업데이트 |
| `.rail-selection-overlay` | `position:absolute; opacity:0.4` | mousedown → display:block |
| `.rail-tooltip` | `position:absolute; top:-60px; z-index:50` | mousemove → position 업데이트 |
| `.rail-time-labels` | `position:absolute; bottom:0; font-size:8px` | 초기 렌더 시 생성, 30분 슬라이딩 |
| `.rail-stat-badges` | `display:flex; gap:6px; font-size:10px` | SSE 수신 시 textContent 갱신 |
| `.rail-filter-badge` | `display:none` → `display:inline-flex` | 선택 확정 시 표시 |
| `railSelection` (JS 변수) | — | `null` or `{ startMs, endMs }` |
| `rerenderFeed()` | — | railSelection 조건 AND 타입필터 AND 검색어 |
| `detailView 전환 시` | — | railCanvas 내용 교체: 밀도맵 → 토큰 누적 바 |

---

### 7-6. Rail 시간 구간 선택 UX — Before / After 피드 필터링

```
[Rail Before: 선택 없음 (IDLE)]

  13:50            14:00            14:10            14:20
  │                │                │                │
  ▓░▓░▓▓░░▓░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░▓░░░░░▓░░░░░░░░░░░░░
  (전체 30분 구간, 선택 없음)

  피드 테이블: 전체 요청 표시 (최신순)
  ┌──────────────────────────────────────────┐
  │ 14:32  tool    Bash    sonnet  ...       │
  │ 14:31  prompt  Agent   sonnet  ...       │
  │ 14:30  tool    Read    sonnet  ...       │
  │ 14:29  prompt   —      opus    ...       │
  │ 14:15  tool    Write   sonnet  ...       │  <- 14:03 구간 항목도 섞여있음
  │ 14:07  tool_call Read  sonnet  ...       │
  │ 14:05  prompt  Agent   sonnet  ...       │
  │ ...                                      │
  └──────────────────────────────────────────┘

[Rail After: 14:03 ~ 14:10 선택 (FILTERED)]

  13:50            14:00            14:10            14:20
  │                │                │                │
  ▓░▓░▓▓░░▓░░[▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓]░░░▓░░░░░▓░░░░░░░░░░░
               ^^^^^^^^^^^^^^^^^^^
               선택 구간 (반투명 accent 오버레이)
               시작: mousedown X좌표 → startMs 계산
               끝:   mouseup X좌표   → endMs 계산

  피드 테이블: 14:03 ~ 14:10 구간만 표시 (오름차순 or 내림차순 유지)
  ┌──────────────────────────────────────────┐
  │ [14:03 - 14:10  x]  8개 요청 표시        │  <- 구간 배지 (× 클릭으로 해제)
  ├──────────────────────────────────────────┤
  │ 14:10  tool    Bash    sonnet  ...       │
  │ 14:09  tool_call Write  sonnet  ...      │
  │ 14:08  tool_call Read   sonnet  ...      │
  │ 14:07  tool_call Read   sonnet  ...      │
  │ 14:06  tool_call Glob   sonnet  ...      │
  │ 14:05  prompt   Agent   sonnet  ...      │
  │ 14:04  tool_call Bash   sonnet  ...      │
  │ 14:03  prompt    —      sonnet  ...      │
  └──────────────────────────────────────────┘
     14:03 이전 / 14:10 이후 행은 모두 숨김
     기존 타입 필터, 검색어와 AND 조건으로 동작

  × 클릭 → railSelection = null → rerenderFeed() → 전체 복원
```

---

## 슬라이드 안 검토 메모 (보류 이유)

> 사용자가 "슬라이드 일변도면 별로일 것 같다"고 명시했으나,
> 참고를 위해 트레이드오프를 기록한다.

**슬라이드 개념 요약**: chartSection과 content-switcher가 좌우 또는 상하로 슬라이드되어
한 번에 하나만 전체 화면을 차지. 탭 또는 스와이프로 전환.

**왜 독립 라운드로 채택하지 않았는가**:
- 차트와 로그를 동시에 볼 수 없어 두 정보의 **상관관계 파악 불가** — 모니터링 도구의 핵심 가치 훼손
- 전환 중 로그 실시간 업데이트가 눈에 띄지 않음 → SSE 피드를 놓치는 문제
- 모바일 앱에서 검증된 패턴이지만, 데스크탑 대시보드에서는 키보드/마우스 워크플로우와 맞지 않음
- 사용자 언급대로 "슬라이드 일변도"가 될 경우 정보 구조가 단순화되어 power user 요구를 충족 못 함

**슬라이드가 의미 있는 경우**: 모바일 반응형 뷰에서 차트/로그 전환용으로 제한적 활용은 가능.
