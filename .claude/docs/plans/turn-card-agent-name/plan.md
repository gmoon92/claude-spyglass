# turn-card-agent-name 개발 계획

> Feature: turn-card-agent-name
> 작성일: 2026-04-20
> 작성자: Claude Code

## 목표

턴 카드(card view)의 도구 흐름 chip에서 Agent/Skill 호출 시 서브에이전트 이름을 함께 표기한다.
현재 `◎` 아이콘만 표시되어 어떤 에이전트가 호출됐는지 흐름을 파악할 수 없는 문제를 해결한다.

## 배경

- 플랫 뷰(flat view)의 `makeTargetCell()`은 `r.tool_detail`을 통해 `Agent(tool_detail)` 형태로 이미 이름을 표시함
- 턴 카드 뷰(`renderTurnCards()`)는 `tool_name`의 base만 칩 레이블로 사용하여 서브에이전트명 누락
- 사용자는 에이전트 호출 흐름을 한눈에 파악하길 원함

## 범위

- 포함:
  - `renderTurnCards()` 내 Agent/Skill 칩 레이블에 서브에이전트명 추가
  - `.agent-chip` CSS 클래스 추가 (truncate + tooltip)
  - `toolIconHtml()` 재사용 원칙 준수
- 제외:
  - 플랫 뷰 수정 (이미 이름 표시됨)
  - Gantt 뷰 수정
  - Bash/Read 등 일반 도구 칩 변경
  - `toolIconHtml()` 함수 내부 수정

## 단계별 계획

### 1단계: CSS 추가 — turn-view.css

`.agent-chip` 클래스를 `.tool-chip` 기반으로 확장:
- `max-width: 10ch` — 긴 이름 truncate
- `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`
- Agent/Skill 계열 시각적 강조: `background: var(--tool-agent-bg, rgba(245,158,11,0.10))`
- 기존 칩 높이/패딩/border-radius 유지

### 2단계: JS 수정 — session-detail.js renderTurnCards()

`compressed` 배열 생성 후 칩 렌더링 부분 수정:
- `tc.tool_name`이 `Agent` 또는 `Skill`인지 판단
- `isAgent`이면 `tc.tool_detail` (서브에이전트명) 추출하여 레이블에 포함
- `data-title` 속성으로 full name 설정 (tooltip 대응)
- `.agent-chip` 클래스 추가

`compressed` 배열 구조 확장: `{ name, count, isAgent, agentName }`

### 3단계: 검증

- Agent/Skill 칩에 이름 표시 확인
- 긴 이름(20자 이상) truncate + ellipsis 확인
- 일반 도구 칩(Bash, Read 등) 변경 없음 확인
- 기존 칩 높이/레이아웃 변화 없음 확인

## 완료 기준

- [ ] Agent/Skill 칩에 서브에이전트명 표기 (예: `◎ designer`, `◎ general-pur…`)
- [ ] 이름 12자 초과 시 ellipsis 처리
- [ ] 일반 도구 칩 레이아웃 변화 없음
- [ ] CSS 변수만 사용 (하드코딩 색상 없음)
- [ ] `toolIconHtml()` 재사용 원칙 준수
