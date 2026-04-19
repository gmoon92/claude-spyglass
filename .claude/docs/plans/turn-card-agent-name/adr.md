# turn-card-agent-name ADR

## ADR-001: 턴 카드 chip에서 Agent/Skill 이름 표기 방식

### 상태
**결정됨** (2026-04-20)

### 배경
턴 카드(card view)의 도구 흐름 chip은 현재 `◎` 아이콘과 도구 이름(예: `Agent`, `Skill`)만 표시한다.
사용자는 어떤 서브에이전트가 호출됐는지 흐름을 파악하고 싶으나, `tool_detail` 필드에 담긴
서브에이전트명(예: `general-purpose`, `designer`, `data-engineer`)이 chip에 노출되지 않는다.

추가 제약:
- 이름이 길어질 경우 chip이 넓어져 레이아웃이 깨질 수 있음
- 개행(line-break) 처리 시 chip badge 높이가 깨짐
- `toolIconHtml()` 재사용 원칙 준수 필요 (CLAUDE.md)

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A (채택) | chip 내 `toolIconHtml()` + `agentName` span + truncate | 흐름 한눈에 파악, 기존 함수 재사용, 높이 유지 | chip 너비 가변 (max-width로 제어) |
| B | 아이콘 chip과 이름 badge 분리 표기 | 구조 명확 | 레이아웃 불안정, chip-arrow 흐름 가독성 저하 |
| C | `toolIconHtml()` 미사용, chip 내부에 직접 HTML 작성 | 구현 단순 | CLAUDE.md 단일책임·재사용 원칙 위반으로 즉시 기각 |

### 결정

**옵션 A 채택**: chip 내부에 `toolIconHtml(name)` 호출 결과 + `<span class="agent-chip-name">` 으로
서브에이전트명을 표기한다. `.agent-chip` 클래스를 `.tool-chip` 위에 추가 적용한다.

### 이유

1. `toolIconHtml()` 재사용 — CLAUDE.md 함수 재사용 원칙 준수
2. `max-width: 10ch` + `text-overflow: ellipsis` + `white-space: nowrap` 으로 개행 없이 truncate
3. `data-title` 속성으로 full name tooltip 제공 — 정보 손실 없음
4. 압축 키를 `name + '|' + agentName` 복합으로 변경해 서로 다른 에이전트(`designer` vs `general-purpose`)가 별개 chip으로 분리됨
5. Agent/Skill 계열만 변경, 일반 도구 chip(Bash/Read 등)에 영향 없음
6. CSS 변수만 사용 (`--tool-agent`, `--tool-agent-bg` 등), 하드코딩 색상 없음

### 구현 요약

**CSS (`turn-view.css`)**
- `.agent-chip`: `.tool-chip` 기반 확장, `display: inline-flex; align-items: center; gap: 3px`
- `.agent-chip .tool-icon`: `font-size: inherit` — 칩 내 아이콘 크기 정규화
- `.agent-chip-name`: `max-width: 10ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`
- Agent/Skill 배경: `background: var(--tool-agent-bg, rgba(245,158,11,0.10))`

**JS (`session-detail.js` — `renderTurnCards`)**
- `compressed` 배열 구조: `{ name, count, isAgent, agentName }` 으로 확장
- 압축 키: `name + '|' + (agentName || '')`
- `isAgent` 판단: `/^(Agent|Skill|Task)/.test(name)`
- `agentName`: `tc.tool_detail` 값 사용
- chip 렌더: isAgent이면 `.agent-chip` 클래스 + `toolIconHtml()` + `.agent-chip-name` span
