# tool-color-tokens 개발 계획

> Feature: tool-color-tokens
> 작성일: 2026-04-20
> 작성자: Claude Code

## 목표

간트 차트(`turn-gantt.js`)와 턴 카드(`session-detail.js`)에서 도구별 색상이 JS에 하드코딩되어 있어 CSS 토큰 시스템과 불일치한다. 공식 `--tool-*` CSS 토큰을 정의하고, 두 모듈이 동일 토큰을 런타임에 읽도록 교체하여 색상 SSoT를 `design-tokens.css`로 통일한다.

## 범위

### 포함
- `design-tokens.css`: `--tool-*` 토큰 7개 신설
- `turn-gantt.js`: `TOOL_COLORS` 하드코딩 → `initToolColors()` + `getCssVar` 패턴으로 교체, 330번 줄 `#f59e0b` 하드코딩 제거
- `session-detail.js`: `chipColors` 인라인 하드코딩 → `TOOL_COLORS` 모듈 공유 또는 동일 패턴 적용
- `badge-colors.md`: `--tool-*` 토큰 섹션 신설 및 현행화

### 제외
- `badges.css` 수정 (`.tool-icon-tool`, `.tool-icon-agent` 클래스는 이미 올바름)
- DB 스키마, 서버 API 로직
- `chart.js` 수정 (참조만)

## 핵심 색상 결정

| 토큰 | 값 | 용도 |
|------|-----|------|
| `--tool-agent` | `var(--orange)` (#f59e0b) | Agent, Skill |
| `--tool-task`  | `var(--blue)`  (#60a5fa) | Task |
| `--tool-fs`    | `#34d399`      | Read, Write, Edit, MultiEdit |
| `--tool-bash`  | `#fb923c`      | Bash |
| `--tool-search`| `#fbbf24`      | Grep, Glob |
| `--tool-web`   | `#f472b6`      | WebSearch, WebFetch |
| `--tool-default`| `#94a3b8`     | 그 외 |

**색상 분리 근거:**
- `--tool-bash` (`#fb923c`) vs `--orange` (`#f59e0b`): Bash는 시스템 명령 실행으로 Agent(AI 위임)와 의미 다름 → 별도 토큰 유지
- `--tool-fs` (`#34d399`) vs `--type-tool_call-color` (`#6ee7a0`): 전자는 Gantt/칩 시각화용, 후자는 타입 배지 텍스트/배경용 → 용도가 달라 별도 토큰 유지

## 단계별 계획

### 1단계: CSS 토큰 정의 (`design-tokens.css`)
`--tool-agent` ~ `--tool-default` 7개 토큰을 `:root`에 추가. `--purple` 주석도 현행화.

### 2단계: `turn-gantt.js` 교체
- 모듈 상단에 `TOOL_COLORS` 런타임 객체 선언 (초기값 = fallback 하드코딩)
- `initToolColors()` 함수 신설: `getComputedStyle` 로 7개 CSS 변수 읽어 `TOOL_COLORS` 갱신
- `initGantt()` 내에서 `initToolColors()` 호출
- 330번 줄 `#f59e0b` → `TOOL_COLORS.Agent` (anomaly 마커는 Agent와 동일 amber 색)

### 3단계: `session-detail.js` 교체
- `renderTurnCards()` 내 인라인 `chipColors` 객체 제거
- `turn-gantt.js`에서 `TOOL_COLORS` export → `session-detail.js`에서 import
- `chipColors[base]` 참조를 `TOOL_COLORS[base]` 로 교체

### 4단계: `badge-colors.md` 업데이트
`--tool-*` 토큰 표, Gantt/카드뷰 색상 섹션 신설. 기존 "도구 유형별 색상 팔레트" 섹션의 임시 상태 표현 현행화.

## 완료 기준

- [ ] `design-tokens.css`에 `--tool-*` 7개 토큰 존재
- [ ] `turn-gantt.js` `TOOL_COLORS`에 하드코딩 16진수 없음 (fallback 제외)
- [ ] `session-detail.js` `chipColors` 인라인 객체 없음
- [ ] `turn-gantt.js:330` `#f59e0b` 하드코딩 없음
- [ ] `badge-colors.md` `--tool-*` 섹션 존재
