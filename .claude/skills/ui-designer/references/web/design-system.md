# Design System — Web 대시보드

> 공통 토큰: `../common/design-tokens.md` 참조

---

## CSS 변수 전체 (packages/web/assets/css/design-tokens.css)

```css
:root {
  /* 강조 */
  --accent:            #d97757;
  --accent-dim:        rgba(217,119,87,0.1);   /* 선택 행 배경 */
  --accent-bg-light:   rgba(217,119,87,0.04);  /* 일반 행 hover, 확장 패널 */
  --accent-bg-medium:  rgba(217,119,87,0.07);  /* clickable 행 hover */

  /* 배경 레이어 (깊이 순) */
  --bg:           #0f0f0f;   /* 최하층 */
  --surface:      #161616;   /* 패널 */
  --surface-alt:  #1c1c1c;   /* 헤더/푸터 */
  --border:       #272727;

  /* 역할 배지 배경 */
  --blue-bg-light: rgba(96,165,250,0.18);   /* role/cache 배지 */
  --red-bg-light:  rgba(239,68,68,0.18);    /* error/slow 배지 */
  --yellow-bg-light: rgba(251,191,36,0.15); /* spike 배지 */
  --sky-bg-light: rgba(147,197,253,0.12);   /* loop 배지 */

  /* 뱃지 텍스트 색상 */
  --blue-text: #93c5fd;   /* role-user, cache 배지 */
  --red-text:  #f87171;   /* error, slow 배지 */
  --sky-text:  #7dd3fc;   /* loop 배지 */

  /* 강조색 계열 (alpha 변형) */
  --accent-border: rgba(217,119,87,0.3);  /* border 강조 */
  --red-dim:       rgba(239,68,68,0.1);   /* error subtle 배경 */
  --red-border:    rgba(239,68,68,0.35);  /* error border */

  /* 흰색 계열 (subtle 배경) */
  --white-bg-subtle: rgba(255,255,255,0.03);  /* 약한 강조 배경 */

  /* Border Radius */
  --radius-sm: 4px;
  --radius-md: 6px;

  /* 텍스트 위계 */
  --text:         #e8e8e8;
  --text-muted:   #888;
  --text-dim:     #505050;

  /* 상태 색상 */
  --green:        #4ade80;
  --orange:       #f59e0b;
  --red:          #ef4444;
  --blue:         #60a5fa;

  /* 타입 색상 (ADR-003 SSoT) */
  --type-prompt-color:    #e8a07a;
  --type-tool_call-color: #6ee7a0;
  --type-system-color:    #fbbf24;

  /* 레이아웃 */
  --left-panel-width:     280px;
  --tool-stats-height:    160px;
  --project-panel-height: 215px;
}
```

---

## 레이아웃 그리드

### 전체 body

```
grid-template-rows: 52px 1px 40px 1fr 20px
← header | error-banner | summary-strip | main | footer
```

### main-layout

```
grid-template-columns: 280px 1fr
← left-panel | right-panel
```

### left-panel

```
grid-template-rows: 215px 1fr 160px
← projects | sessions | tool-stats
```

### 반응형 브레이크포인트

```css
@media (max-width: 768px) { /* 2컬럼 → 세로 재배치 */ }
@media (max-width: 480px) { /* summary-strip 세로 정렬 */ }
```

---

## 타이포그래피

```css
font-family: 'SF Mono', 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
```

| 용도 | 크기 | 굵기 | 색상 |
|------|------|------|------|
| 로고 | 16px | 800 | `--text` |
| 본문 | 13px | 400 | `--text` |
| 서브텍스트 | 12px | 400 | `--text` |
| 미리보기/힌트 | 11px | 400 | `--text-muted` |
| 배지/라벨 | 10px | 600–700 | 타입별 |
| 초소형 | 9px | 600 | `--text-dim` |

---

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

```html
<span class="type-badge type-prompt">P</span>
```

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
td { font-size: 12px; padding: 4px 8px; border-bottom: 1px solid var(--border); }
tr:hover td          { background: var(--accent-bg-light); }   /* 일반 행 */
tr.clickable:hover td { background: var(--accent-bg-medium); } /* 클릭 가능 행 */
tr.selected { border-left: 2px solid var(--accent); }
```

#### 행 타입 구분 (ADR-006)

```css
tr[data-type="prompt"]    td:first-child { border-left: 2px solid var(--type-prompt-color); }
tr[data-type="tool_call"] td:first-child { border-left: 2px solid var(--type-tool_call-color); }
tr[data-type="system"]    td:first-child { border-left: 2px solid var(--type-system-color); }
```

### 프로그레스 바

```
[████████░░░░░░░░░░] 45.2K / 100K
```

```css
.progress-fill  { background: var(--accent); transition: width 0.4s ease; }
.progress-track { background: var(--border); }
```

### LIVE 인디케이터

```css
.live-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--green);
  animation: pulse 1.8s ease-in-out infinite;
}
```

### 스켈레톤 로딩

```css
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, var(--surface) 25%, var(--surface-alt) 50%, var(--surface) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
  border-radius: 3px;
}
```

### 확장 패널

```css
.prompt-expand-box {
  background: var(--accent-bg-light);   /* rgba(217,119,87,0.04) */
  border-left: 2px solid var(--accent);
  padding: 8px 16px;
  font-size: 11px;
  line-height: 1.7;
}
```

---

## 구현 규칙

- CSS 변수만 사용 — 하드코딩 색상 금지
- 타입 컬러는 ADR-003 변수로만 참조
- 반응형 브레이크포인트 768px / 480px 유지
- `inline style` 사용 금지 (클래스로 처리)
- CSS 파일 위치: `packages/web/assets/css/`
