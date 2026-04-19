# tool-icon-agent-orange 개발 계획

> Feature: tool-icon-agent-orange
> 작성일: 2026-04-20
> 작성자: Claude Code

## 목표

Agent/Skill/Task 계열 도구 아이콘(`◎`)의 색상을 `--blue`(`#60a5fa`)에서 `--orange`(`#f59e0b`)로 변경한다.

현재 `--blue`는 캐시 배지(`.badge-cache`)와 role-user 배지(`.role-user`)에서도 사용 중이므로,
**토큰 자체는 유지**하고 `.tool-icon-agent` 클래스의 참조 변수만 교체한다.

## 범위

- **포함**
  - `packages/web/assets/css/badges.css` — `.tool-icon-agent` 색상 변수 교체
  - `.claude/skills/ui-designer/references/web/badge-colors.md` — 문서 현행화
    - 도구 아이콘 색상 테이블
    - 도구 유형별 색상 팔레트 (Agent/Skill/Task 항목)
    - 판별 로직 주석
    - 설계 원칙

- **제외**
  - `design-tokens.css` — `--blue` / `--orange` 토큰 값 변경 없음
  - Gantt/카드뷰 하드코딩 값 (`turn-gantt.js`, `session-detail.js`) — 별도 이슈
  - Task 보라색(`--purple`) Gantt 불일치 해소 — 별도 이슈

## 단계별 계획

### 1단계: CSS 수정
`badges.css` 102번째 줄 `.tool-icon-agent` 색상 변수를 `var(--blue)` → `var(--orange)` 로 교체.

### 2단계: 문서 현행화
`badge-colors.md` 의 Agent/Skill/Task 색상 관련 4개 구간을 오렌지 기준으로 업데이트.

## 완료 기준

- [ ] `.tool-icon-agent { color: var(--orange); }` 로 변경됨
- [ ] `badge-colors.md` 도구 아이콘 테이블 오렌지 반영
- [ ] `badge-colors.md` 도구 유형별 팔레트 Agent/Skill/Task 오렌지 반영
- [ ] `--blue` 토큰을 사용하는 다른 클래스(`.badge-cache`, `.role-user`, `.cache-tooltip-value.read`) 영향 없음
