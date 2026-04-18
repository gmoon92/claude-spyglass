# Design System — claude-spyglass

## 색상 시스템 (CSS 변수, packages/web/index.html :root)

```css
:root {
  --accent:       #d97757;
  --accent-dim:   rgba(217, 119, 87, 0.1);
  --accent-hover: rgba(217, 119, 87, 0.15);
  --bg:           #0f0f0f;
  --surface:      #161616;
  --surface-alt:  #1c1c1c;
  --border:       #272727;
  --border-light: #333;
  --text:         #e8e8e8;
  --text-muted:   #888;
  --text-dim:     #505050;
  --green:        #4ade80;
  --green-dim:    rgba(74, 222, 128, 0.12);
  --orange:       #f59e0b;
  --orange-dim:   rgba(245, 158, 11, 0.12);
  --red:          #ef4444;
  --red-dim:      rgba(239, 68, 68, 0.12);
  --blue:         #60a5fa;
  --blue-dim:     rgba(96, 165, 250, 0.12);
}
```

## 타입 색상 (ADR-003 SSoT)

이 값들은 Web과 TUI가 공유하는 단일 진실 공급원입니다. 임의 변경 금지.

```
prompt   → text: #e8a07a  bg: rgba(217,119,87,0.18)
tool_call → text: #6ee7a0  bg: rgba(74,222,128,0.15)
system   → text: #fbbf24  bg: rgba(245,158,11,0.15)
```

## 레이아웃 변수

```css
--left-panel-width:    280px
--tool-stats-height:   160px
--project-panel-height: 215px
```

## Grid 구조 (Web)

```
body
  display: grid
  grid-template-rows: 52px 1px 40px 1fr 20px
  ← header | error-banner | summary-strip | main | footer

.main-layout
  display: grid
  grid-template-columns: 280px 1fr
  ← left-panel | right-panel

.left-panel
  display: grid
  grid-template-rows: 215px 1fr 160px
  ← projects | sessions | tools
```

## 반응형 브레이크포인트

```css
@media (max-width: 768px) { /* 2컬럼 → 재배치 */ }
@media (max-width: 480px) { /* summary strip 세로 정렬 */ }
```

## 타이포그래피

```css
font-family: 'SF Mono', 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;

/* 크기 계층 */
.logo:         16px / weight 800
body:          13px / line-height 1.5
.stat-value:   17px / weight 700
.section-label: 10px / weight 700 / uppercase / letter-spacing 0.5px
.type-badge:   10px / weight 600
```

## 컴포넌트 스펙

### 섹션 라벨
```css
.section-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim);
  padding: 6px 12px 4px;
}
```

### 타입 배지

약어 정의 (ADR-002, `index.html:987` `TYPE_ABBR`):
| 약어 | type 값    | 의미          |
|------|------------|---------------|
| `P`  | `prompt`   | 사용자 입력   |
| `T`  | `tool_call`| 도구 호출     |
| `S`  | `system`   | 시스템 메시지 |

```css
.type-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
}
.type-prompt    { color: #e8a07a; background: rgba(217,119,87,0.18); }
.type-tool_call { color: #6ee7a0; background: rgba(74,222,128,0.15); }
.type-system    { color: #fbbf24; background: rgba(245,158,11,0.15); }
```

### 테이블
```css
th { font-size: 10px; color: var(--text-dim); text-transform: uppercase; padding: 4px 8px; }
td { font-size: 12px; padding: 4px 8px; }
tr:hover { background: var(--accent-dim); cursor: pointer; }
tr.selected { border-left: 2px solid var(--accent); }
```

### 프로그레스 바
```
[████████░░░░░░░░░░] 45.2K / 100K
```
- fill: `var(--accent)`
- track: `var(--border)`
- 텍스트: right-align, monospace
- 애니메이션: `width transition 0.4s ease`

### 실시간 배지 (LIVE indicator)
```css
.live-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--green); /* connected */
  animation: pulse 1.8s ease-in-out infinite;
}
```

### 스켈레톤 로딩
```css
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, var(--surface) 25%, var(--surface-alt) 50%, var(--surface) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
  border-radius: 3px;
}
```

### 확장 패널 (expand panel)
- 클릭 시 행 아래로 슬라이드 확장
- 배경: `var(--surface)`, 테두리: `1px solid var(--border)`
- padding: 12px 16px
- 복사 버튼: 우상단 배치, hover 시만 표시

## TUI 디자인 규칙 (Ink)

- 레이아웃 기준: **80칼럼** 터미널
- Sidebar 너비: `25칼럼` 고정
- 색상: Ink `color` / `backgroundColor` prop 사용
- 테두리: Ink `borderStyle` prop (`single`, `round`)
- 탭 선택 표시: `[F1 Live]` 형태, 선택 시 accent 색상
- 프로그레스 바: `█` (filled) / `░` (empty) 문자 사용
