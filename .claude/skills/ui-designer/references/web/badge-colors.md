# Badge Colors — Web 대시보드

> SSoT: `packages/web/assets/css/design-tokens.css` + `packages/web/assets/css/badges.css`
> **임의 색상 하드코딩 금지** — 반드시 아래 CSS 변수를 사용하세요.

---

## 타입 배지 (type badge)

테이블 Action 컬럼의 `<span class="type-badge type-{type}">` 에 사용.

> **`type` vs `event_type` 구분 주의**
> - `type` (`request_type` 컬럼): 요청 종류 — `prompt` / `tool_call` / `system`. 배지와 필터 버튼이 이 값을 기준으로 렌더링됨.
> - `event_type` 컬럼: 도구 실행 단계 — `pre_tool` (시작) / `tool` (완료) / `null` (비도구 요청). 서버-스토리지 레이어의 내부 처리 상태이며, UI 배지나 필터 버튼에 직접 노출되지 않음.
> - `event_type='tool'`은 `type='tool_call'` 레코드가 PostToolUse로 완성된 상태일 뿐, 별도의 배지 타입이 아님.

| type | 텍스트 색상 변수 | 배경 색상 변수 | 실제 색상 |
|------|----------------|--------------|-----------|
| `prompt` | `--type-prompt-color` | `--type-prompt-bg` | #e8a07a (주황) |
| `tool_call` | `--type-tool_call-color` | `--type-tool_call-bg` | #6ee7a0 (초록) |
| `system` | `--type-system-color` | `--type-system-bg` | #fbbf24 (노랑) |
| unknown | `--text-muted` | `--unknown-bg` | — |

### 타입 배지 CSS 클래스

```css
.type-badge     /* 공통: padding 2px 7px, border-radius 4px, font-size 10px, font-weight 600 */
.type-prompt    /* 주황: var(--type-prompt-bg) bg, var(--type-prompt-color) text */
.type-tool_call /* 초록: var(--type-tool_call-bg) bg, var(--type-tool_call-color) text */
.type-system    /* 노랑: var(--type-system-bg) bg, var(--type-system-color) text */
.type-unknown   /* 회색: var(--unknown-bg) bg, var(--text-muted) text */
```

---

## 타입 필터 버튼 색상 대응

헤더 영역의 `<button class="type-filter-btn" data-filter="{type}">` 활성 상태에서 타입 색상을 반영할 때 참조.

버튼 순서: `All | prompt | Agent | Skill | MCP | tool_call | system`

| 버튼 | 비활성 색상 | 활성 색상 | 실제 색상 |
|------|------------|----------|-----------|
| All | `--text-dim` / `--border` | `--accent` / `--accent-dim` | #d97757 |
| prompt | `--text-dim` / `--border` | `--type-prompt-color` / `--type-prompt-bg` | #e8a07a (주황) |
| Agent | `--text-dim` / `--border` | `--type-agent-color` / `--type-agent-bg` | `var(--orange)` = #f59e0b |
| Skill | `--text-dim` / `--border` | `--type-skill-color` / `--type-skill-bg` | `var(--orange)` = #f59e0b |
| MCP | `--text-dim` / `--border` | `--type-mcp-color` / `--type-mcp-bg` | #22d3ee (cyan) |
| tool_call | `--text-dim` / `--border` | `--type-tool_call-color` / `--type-tool_call-bg` | #6ee7a0 (초록) |
| system | `--text-dim` / `--border` | `--type-system-color` / `--type-system-bg` | #fbbf24 (노랑) |

> **Agent/Skill = `--orange`**: badge-colors.md ADR-002 (2026-04-20) — `.tool-icon-agent` 아이콘과 동일 색으로 "AI 위임" 의미론 일관.
> **MCP = cyan `#22d3ee`**: type-filter-expansion ADR-002-R1 (2026-04-21) 신규 결정. orange(Agent/Skill/Bash), green(tool_call), yellow(system), pink(WebFetch) 와 모두 구분.
> **클라이언트 필터 전용**: Agent/Skill/MCP는 `tool_name` 기반 서브분류로 서버 재조회 없이 `data-sub-type` 속성으로 필터링.

---

## role 배지 (target role badge)

prompt/system 행의 Target 컬럼에 사용. `badges.css`의 `.target-role-badge` 컴포넌트.

| role | 클래스 | 색상 변수 | 실제 색상 |
|------|--------|----------|-----------|
| user | `.role-badge-user` | `--type-prompt-color` | #e8a07a (주황) |
| system | `.role-badge-system` | `--type-system-color` | #fbbf24 (노랑) |

### 마크업 패턴

`role-badge-user` / `role-badge-system` 클래스는 `target-role-badge`와 **같은 요소**에 부여하며, role 텍스트는 별도 `<span>` 없이 직접 텍스트 노드로 들어간다 (`renderers.js` 기준).

```html
<span class="target-role-badge role-badge-user"><span class="role-icon">◉</span>user</span>

<span class="target-role-badge role-badge-system"><span class="role-icon">◉</span>system</span>
```

### 구현 규칙

- `.target-role-badge`: `display:inline-flex; align-items:center; gap:3px; font-size:12px; font-weight:500`
- 아이콘 `◉`: `.role-icon` (font-size 10px)
- role 텍스트: 타입 색상 변수 그대로 사용 (별도 bg 없음)
- `role-badge-*` 클래스는 래퍼(`target-role-badge`)와 동일 요소에 부여 — 중첩 `<span>` 구조 사용 금지

---

## 도구 아이콘 색상 (tool icon)

툴 통계 패널 및 Target 셀의 도구 식별 아이콘.

| 아이콘 | 클래스 | 색상 변수 | 실제 색상 | 해당 툴 |
|--------|--------|----------|-----------|---------|
| `◉` | `.tool-icon-tool` | `--type-tool_call-color` | #6ee7a0 (초록) | 일반 도구 (Bash, Read, Write, Edit, …) |
| `◎` | `.tool-icon-agent` | `--orange` | #f59e0b (오렌지) | Agent, Skill, Task |

### CSS 클래스

```css
.tool-icon-tool  { color: var(--type-tool_call-color); }  /* 초록 */
.tool-icon-agent { color: var(--orange); }                 /* 오렌지 */
```

### 판별 로직 (renderers.js 참조)

```js
// tool_name이 Agent/Skill/Task 계열이면 ◎ (오렌지), 나머지는 ◉ (초록)
const isAgent = /^(Agent|Skill|Task)/i.test(tool_name);
const icon  = isAgent ? '◎' : '◉';
const cls   = isAgent ? 'tool-icon-agent' : 'tool-icon-tool';
```

> **설계 결정 (ADR-002, 2026-04-20)**: 아이콘 색상은 Agent/Skill/Task 모두 `.tool-icon-agent` 클래스 → `--orange`.
> Gantt/칩 색상(`--tool-*`)은 별개: Agent/Skill = `--tool-agent`(오렌지), Task = `--tool-task`(파랑).
> 아이콘과 Gantt/칩은 용도가 달라 색상 값이 달라도 무방하다.

---

## 도구 유형별 색상 토큰 (Gantt · 카드뷰 공용)

Gantt(`turn-gantt.js`)와 카드뷰(`session-detail.js`)가 공유하는 `--tool-*` CSS 토큰.
Canvas API는 CSS 변수를 직접 읽을 수 없으므로 `initToolColors()`에서 `getComputedStyle`로 런타임 읽기.

> **ADR-001 (2026-04-20)**: `design-tokens.css` SSoT. JS 하드코딩 금지.

| 토큰 | 실제 색상 | 용도 |
|------|----------|------|
| `--tool-agent` | `var(--orange)` = #f59e0b | Agent, Skill |
| `--tool-task`  | `var(--blue)`  = #60a5fa | Task |
| `--tool-fs`    | #34d399 | Read, Write, Edit, MultiEdit |
| `--tool-bash`  | #fb923c | Bash |
| `--tool-search`| #fbbf24 | Grep, Glob |
| `--tool-web`   | #f472b6 | WebSearch, WebFetch |
| `--tool-default`| #94a3b8 | 그 외 |

**색상 분리 결정 근거:**
- **`--tool-bash` (#fb923c) vs `--orange` (#f59e0b)**: Bash는 시스템 명령 실행, Agent는 AI 위임으로 의미론 구분. 별도 토큰 유지. (ADR-003)
- **`--tool-fs` (#34d399) vs `--type-tool_call-color` (#6ee7a0)**: 전자는 Gantt/칩 시각화용, 후자는 타입 배지 텍스트용. 용도가 달라 별도 토큰 유지. (ADR-004)

### JS 사용 패턴

```js
// turn-gantt.js — initToolColors() 로 런타임 읽기 (chart.js initTypeColors() 동일 패턴)
export const TOOL_COLORS = { /* fallback 하드코딩 */ };
export function initToolColors() {
  const s = getComputedStyle(document.documentElement);
  const get = v => s.getPropertyValue(v).trim();
  TOOL_COLORS.Agent = TOOL_COLORS.Skill = get('--tool-agent') || TOOL_COLORS.Agent;
  TOOL_COLORS.Task  = get('--tool-task')    || TOOL_COLORS.Task;
  // … 나머지 동일 패턴
}

// session-detail.js — turn-gantt.js 에서 import
import { TOOL_COLORS } from './turn-gantt.js';
const color = TOOL_COLORS[base] || TOOL_COLORS.default;
```

---

## 기타 미니 배지

`badges.css`의 `.mini-badge` 계열.

| 배지 | 클래스 | 배경 토큰 | 텍스트 토큰 | 실제 색상 | 용도 |
|------|--------|----------|-------------|-----------|------|
| 캐시 히트 | `.badge-cache` | `--blue-bg-light` | `--blue-text` | #93c5fd | cache_read_tokens > 0 |
| 에러 | `.badge-error` | `--red-bg-light` | `--red-text` | #f87171 | 요청 에러 표시 |
| 토큰 스파이크 | `.badge-spike` | `--yellow-bg-light` | `--type-system-color` | #fbbf24 | 세션 평균 대비 2배 초과 |
| 루프 감지 | `.badge-loop` | `--sky-bg-light` | `--sky-text` | #7dd3fc | 동일 툴 연속 3회+ 호출 |
| 느린 실행 | `.badge-slow` | `--red-bg-light` | `--red-text` | #f87171 | duration_ms > P95 |

`.role-user` 배지 배경도 `--blue-bg-light` 동일 토큰 사용.

---

## Border Radius 규칙

| 컴포넌트 | 토큰 | 값 |
|----------|------|-----|
| `.type-badge` | `--radius-sm` | 4px |
| `.mini-badge` | `--radius-sm` | 4px |
| `.expand-copy-btn` | `--radius-sm` | 4px |
| `.cache-tooltip` | `--radius-md` | 6px |

---

## 설계 원칙

1. **CSS 변수만 사용** — 16진수 색상 하드코딩 금지
2. **타입 색상은 `--type-*` 변수** — `design-tokens.css`의 ADR-003 선언 참조
3. **파란색은 `--blue`** — 캐시 배지·role-user 배지·Task 도구(`--tool-task`) 전용
4. **오렌지는 `--orange`** — Agent/Skill 아이콘(`.tool-icon-agent`) 및 `--tool-agent` 전용. "AI 위임" 의미론
5. **Gantt/칩 도구 색상은 `--tool-*` 토큰** — `--type-*` 토큰과 혼용 금지
6. **새 배지 추가 시** — `design-tokens.css`에 변수 먼저 추가 → `badges.css`에 클래스 추가
7. **border-radius는 `--radius-sm`/`--radius-md` 토큰** — 직접 px 값 사용 금지
