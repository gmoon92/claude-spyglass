# Badge Colors — Web 대시보드

> SSoT: `packages/web/assets/css/design-tokens.css` + `packages/web/assets/css/badges.css`
> **임의 색상 하드코딩 금지** — 반드시 아래 CSS 변수를 사용하세요.

---

## 타입 배지 (type badge)

테이블 Action 컬럼의 `<span class="type-badge type-{type}">` 에 사용.

| type | 텍스트 색상 변수 | 배경 색상 변수 | 실제 색상 |
|------|----------------|--------------|-----------|
| `prompt` | `--type-prompt-color` | `--type-prompt-bg` | #e8a07a (주황) |
| `tool_call` | `--type-tool_call-color` | `--type-tool_call-bg` | #6ee7a0 (초록) |
| `system` | `--type-system-color` | `--type-system-bg` | #fbbf24 (노랑) |
| unknown | `--text-muted` | `rgba(80,80,80,0.2)` | — |

### 타입 배지 CSS 클래스

```css
.type-badge     /* 공통: padding 2px 7px, border-radius 4px, font-size 10px, font-weight 600 */
.type-prompt    /* 주황: var(--type-prompt-bg) bg, var(--type-prompt-color) text */
.type-tool_call /* 초록: var(--type-tool_call-bg) bg, var(--type-tool_call-color) text */
.type-system    /* 노랑: var(--type-system-bg) bg, var(--type-system-color) text */
.type-unknown   /* 회색: rgba(80,80,80,0.2) bg, var(--text-muted) text */
```

---

## 타입 필터 버튼 색상 대응

헤더 영역의 `<button class="type-filter-btn" data-filter="{type}">` 활성 상태에서 타입 색상을 반영할 때 참조.

| 버튼 | 비활성 색상 | 활성 색상 |
|------|------------|----------|
| All | `--text-dim` / `--border` | `--accent` / `--accent-dim` |
| prompt | `--text-dim` / `--border` | `--type-prompt-color` / `--type-prompt-bg` |
| tool_call | `--text-dim` / `--border` | `--type-tool_call-color` / `--type-tool_call-bg` |
| system | `--text-dim` / `--border` | `--type-system-color` / `--type-system-bg` |

> 현재 `.type-filter-btn.active`는 `--accent` 단일색만 적용됨. 타입별 색상 분기 구현 시 위 색상 참조.

---

## role 배지 (target role badge)

prompt/system 행의 Target 컬럼에 사용. `badges.css`의 `.target-role-badge` 컴포넌트.

| role | 클래스 | 색상 변수 | 실제 색상 |
|------|--------|----------|-----------|
| user | `.role-badge-user` | `--type-prompt-color` | #e8a07a (주황) |
| system | `.role-badge-system` | `--type-system-color` | #fbbf24 (노랑) |

### 마크업 패턴

```html
<span class="target-role-badge">
  <span class="role-icon">◉</span>
  <span class="role-badge-user">user</span>
</span>

<span class="target-role-badge">
  <span class="role-icon">◉</span>
  <span class="role-badge-system">system</span>
</span>
```

### 구현 규칙

- `.target-role-badge`: `display:inline-flex; align-items:center; gap:3px; font-size:12px; font-weight:500`
- 아이콘 `◉`: `.role-icon` (font-size 10px)
- role 텍스트: 타입 색상 변수 그대로 사용 (별도 bg 없음)

---

## 도구 아이콘 색상 (tool icon)

툴 통계 패널 및 Target 셀의 도구 식별 아이콘.

| 아이콘 | 클래스 | 색상 변수 | 실제 색상 | 해당 툴 |
|--------|--------|----------|-----------|---------|
| `◉` | `.tool-icon-tool` | `--type-tool_call-color` | #6ee7a0 (초록) | 일반 도구 (Bash, Read, Write, Edit, …) |
| `◎` | `.tool-icon-agent` | `--blue` | #60a5fa (파랑) | 에이전트/스킬/태스크 계열 (Agent, Skill, Task, …) |

### CSS 클래스

```css
.tool-icon-tool  { color: var(--type-tool_call-color); }  /* 초록 */
.tool-icon-agent { color: var(--blue); }                   /* 파랑 */
```

### 판별 로직 (renderers.js 참조)

```js
// tool_name이 Agent/Skill/Task 계열이면 ◎ (파랑), 나머지는 ◉ (초록)
const isAgent = /^(Agent|Skill|Task)/i.test(tool_name);
const icon  = isAgent ? '◎' : '◉';
const cls   = isAgent ? 'tool-icon-agent' : 'tool-icon-tool';
```

---

## 기타 미니 배지

`badges.css`의 `.mini-badge` 계열.

| 배지 | 클래스 | 색상 | 용도 |
|------|--------|------|------|
| 캐시 히트 | `.badge-cache` | `#93c5fd` (blue-300) | cache_read_tokens > 0 |
| 에러 | `.badge-error` | `#f87171` (red-400) | 요청 에러 표시 |

---

## 설계 원칙

1. **CSS 변수만 사용** — 16진수 색상 하드코딩 금지
2. **타입 색상은 `--type-*` 변수** — `design-tokens.css`의 ADR-003 선언 참조
3. **파란색은 `--blue`** — 에이전트/캐시 공용, role-badge-user에는 사용하지 않음
4. **새 배지 추가 시** — `design-tokens.css`에 변수 먼저 추가 → `badges.css`에 클래스 추가
