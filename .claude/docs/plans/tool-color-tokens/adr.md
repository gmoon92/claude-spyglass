# tool-color-tokens ADR

> Feature: tool-color-tokens
> 작성일: 2026-04-20
> 작성자: Claude Code

---

## ADR-001: --tool-* CSS 토큰 신설 (7개)

### 상태
**결정됨** (2026-04-20)

### 배경
`turn-gantt.js`의 `TOOL_COLORS` 객체와 `session-detail.js`의 `chipColors` 객체가 동일한 16진수 색상값을 각자 하드코딩하고 있다. CSS 토큰 시스템(`design-tokens.css`)과 완전히 분리되어 있어 색상 변경 시 JS 파일 2곳을 동시에 수정해야 하고, 불일치 위험이 항상 존재한다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | JS에 공통 상수 파일 신설 (`tool-colors.js`) | JS 모듈 내 SSoT | CSS 토큰 시스템과 여전히 분리 |
| B | `design-tokens.css`에 `--tool-*` 토큰 추가, JS는 `getComputedStyle`로 읽기 | CSS SSoT 달성, 테마 교체 시 CSS만 수정 | Canvas API가 직접 CSS 변수 미지원 → 초기화 함수 필요 |
| C | 기존 `--type-*`, `--orange`, `--blue` 등 공용 토큰 재사용 | 토큰 수 최소화 | 용도 혼용으로 의미론 훼손 (ADR-003 위반 우려) |

### 결정
옵션 B 채택. `design-tokens.css`에 `--tool-agent`, `--tool-task`, `--tool-fs`, `--tool-bash`, `--tool-search`, `--tool-web`, `--tool-default` 7개 토큰 추가. JS는 `initToolColors()` 함수에서 `getComputedStyle`로 런타임 읽기.

### 이유
1. CSS SSoT 원칙 달성 — 색상 변경 시 `design-tokens.css` 한 곳만 수정
2. `chart.js`의 `initTypeColors()` 패턴이 이미 동일 방식으로 검증됨
3. 용도별 토큰 분리로 의미론 유지 (타입 배지용 `--type-*`와 Gantt/칩용 `--tool-*` 구분)

---

## ADR-002: Agent/Skill = --orange, Task = --blue 색상 확정

### 상태
**결정됨** (2026-04-20)

### 배경
현재 `turn-gantt.js`에서 Agent와 Skill이 `#60a5fa`(파랑)으로 Task와 동일한 색상이고, Task는 `#a78bfa`(보라)로 설정되어 있다. `badge-colors.md`의 기존 `ADR-001`에서 Agent/Skill은 `--orange`로 결정되었으나 Gantt/카드뷰에 반영되지 않은 상태다.

### 고려한 옵션

| 옵션 | Agent/Skill | Task | 근거 |
|------|-------------|------|------|
| A (현행) | `--blue` (#60a5fa) | `--purple` (#a78bfa) | 변경 없음 |
| B (채택) | `--orange` (#f59e0b) | `--blue` (#60a5fa) | badge-colors.md ADR-001 일치 |
| C | `--orange` (#f59e0b) | `--orange` (#f59e0b) | Agent/Task 동일 취급 |

### 결정
옵션 B 채택. `--tool-agent = var(--orange)`, `--tool-task = var(--blue)`.

### 이유
1. `badge-colors.md` ADR-001 기존 결정(Agent/Skill/Task → `--orange`)에서 Task만 `--blue`로 분리하는 것이 이번 사용자 지시
2. `--orange`는 "AI 능동 위임(delegation)" 의미론으로 Agent/Skill에 적합
3. `--blue`는 Task(작업 단위, 계획된 실행)로 의미 구분 명확
4. `--purple`은 현재 Task 이외 사용처 없으므로 Gantt/카드뷰에서 퇴역

---

## ADR-003: --tool-bash를 --orange와 별도 토큰으로 유지

### 상태
**결정됨** (2026-04-20)

### 배경
`Bash`의 현행 색상 `#fb923c`(밝은 오렌지)와 `--orange` `#f59e0b`(amber)는 시각적으로 유사하지만 다른 값이다. 통일 여부를 결정해야 한다.

### 고려한 옵션

| 옵션 | 값 | 설명 |
|------|-----|------|
| A | `--tool-bash = var(--orange)` (#f59e0b) | --orange로 통일 |
| B (채택) | `--tool-bash = #fb923c` | 별도 토큰 유지 |

### 결정
옵션 B 채택. `--tool-bash = #fb923c` 별도 토큰 유지.

### 이유
1. Bash는 시스템 명령 실행(imperative execution), Agent는 AI 하위 에이전트 위임(delegation) — 의미론적으로 구분
2. 시각적으로 구분 가능한 차이(amber vs 밝은 오렌지)가 Gantt에서 도구 종류 식별에 도움
3. 향후 `--orange` 값 조정 시 Bash 색상이 의도치 않게 변경되는 것을 방지

---

## ADR-004: --tool-fs를 --type-tool_call-color와 별도 토큰으로 유지

### 상태
**결정됨** (2026-04-20)

### 배경
Read/Write/Edit/MultiEdit의 현행 색상 `#34d399`와 `--type-tool_call-color` `#6ee7a0`은 둘 다 초록 계열이지만 다른 값이다. 통일 여부를 결정해야 한다.

### 고려한 옵션

| 옵션 | 값 | 설명 |
|------|-----|------|
| A | `--tool-fs = var(--type-tool_call-color)` (#6ee7a0) | 기존 토큰 재사용 |
| B (채택) | `--tool-fs = #34d399` | 별도 토큰 유지 |

### 결정
옵션 B 채택. `--tool-fs = #34d399` 별도 토큰 유지.

### 이유
1. `--type-tool_call-color`는 ADR-003(design-tokens.css)에서 타입 배지 텍스트/배경용으로 정의됨 — Gantt/칩 시각화에 전용 용도 혼용 금지
2. `--type-tool_call-color` 값 변경 시 Gantt 색상이 연동 변경되는 의도치 않은 결합 방지
3. Gantt/칩에서 파일시스템 도구는 배지보다 약간 짙은 초록이 시각적으로 적합

---

## ADR-005: session-detail.js chipColors를 turn-gantt.js TOOL_COLORS import로 통일

### 상태
**결정됨** (2026-04-20)

### 배경
`session-detail.js`의 `renderTurnCards()` 내 인라인 `chipColors` 객체와 `turn-gantt.js`의 `TOOL_COLORS` 객체가 동일한 값을 각자 하드코딩하고 있다. 이중 관리로 불일치 위험이 있다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | 공통 모듈 신설 (`tool-colors.js`) | 순환 의존 없음 | 파일 추가 |
| B (채택) | `turn-gantt.js`에서 `TOOL_COLORS` export, `session-detail.js`에서 import | 기존 파일 재사용, 파일 추가 없음 | turn-gantt.js가 색상 SSoT 역할 겸임 |
| C | 각자 독립적으로 getCssVar 읽기 | 의존 없음 | 초기화 타이밍 2곳 관리 |

### 결정
옵션 B 채택. `turn-gantt.js`에서 `TOOL_COLORS`와 `initToolColors()`를 export하고, `session-detail.js`에서 import하여 사용.

### 이유
1. 파일 추가 없이 단일 소스 달성
2. `session-detail.js`는 이미 `turn-gantt.js`에서 `renderGantt`, `clearGantt`를 import하고 있어 의존 관계가 이미 존재함 — 추가 의존이 아님
3. `initToolColors()` 초기화 타이밍 관리를 한 곳으로 집중
