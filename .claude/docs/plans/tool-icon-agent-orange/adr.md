# tool-icon-agent-orange ADR

## ADR-001: Agent/Skill/Task 아이콘 색상 --blue → --orange 변경

### 상태
**결정됨** (2026-04-20)

### 배경

`.tool-icon-agent` 클래스는 Agent, Skill, Task 계열 도구의 `◎` 아이콘에 `--blue`(`#60a5fa`)를 적용해 왔다.
그러나 `--blue`는 다음 컴포넌트에서도 동시에 사용 중이다.

- `.badge-cache` (캐시 히트 배지) — `--blue-bg-light` / `--blue-text`
- `.role-user` (role 배지) — `--blue-bg-light` / `--blue-text`
- `.cache-tooltip-value.read` — `--blue` 직접 사용

즉, `--blue`는 "캐시/읽기" 의미론으로 수렴되는 반면, Agent/Skill/Task는 "AI 하위 위임(delegation)"이라는 별개의 의미론을 가진다. 색상이 겹치면 사용자가 아이콘을 보고 의미를 즉시 구분하기 어렵다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| `--blue` 유지 | 현상 유지 | 변경 없음 | 캐시 배지와 의미 충돌, 시각 구분 불명확 |
| `--purple` 채택 | Task Gantt에서 이미 사용 중인 보라 | Task 일부와 일치 | Task Gantt 하드코딩(`#a78bfa`)과 불일치 잔존, --purple은 별도 이슈로 분리 필요 |
| `--orange` 채택 | accent 계열(`#f59e0b`) 사용 | accent 팔레트로 "AI 능동 행위자" 의미 강화, `--blue` 의미 충돌 해소 | Bash도 --orange 계열 — 단, Gantt 하드코딩 값이 달라 실질 충돌 없음 |

### 결정

`--orange`(`#f59e0b`) 채택.

### 이유

1. `--blue`는 캐시/읽기 의미론으로 이미 고정되어 있어 Agent 아이콘과 의미 충돌이 발생함.
2. `--orange`는 프로젝트 accent(`--accent: #d97757`) 계열로, "AI가 능동적으로 무언가를 위임·실행한다"는 맥락과 어울림.
3. `--orange` 토큰(`#f59e0b`)은 `design-tokens.css`에 이미 정의되어 있어 신규 토큰 추가 불필요.
4. Gantt/카드뷰의 Bash 하드코딩(`#fb923c`)은 별도 값이므로 실질적 시각 충돌 없음.
5. `--blue` 토큰 자체는 삭제하지 않아 기존 캐시/role 배지에 영향 없음.
