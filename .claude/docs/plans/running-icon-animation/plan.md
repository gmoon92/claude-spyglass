# running-icon-animation 개발 계획

> Feature: running-icon-animation
> 작성일: 2026-04-19
> 작성자: Claude Code

## 목표

tool_call 행의 pre_tool 상태(실행 중)일 때 표시되는 "실행 중" 텍스트 배지를 제거하고,
◎/◉ 아이콘 자체에 CSS 애니메이션을 적용하여 시각적으로 실행 중 상태를 직관적으로 표현한다.

## 배경

현재 `makeTargetCell` 함수는 `inProgress` 상태일 때 텍스트 배지(`실행 중`)를 렌더링한다.
사용자 피드백: "텍스트 배지가 복잡해 보인다, ◎ 아이콘을 활용해서 애니메이션으로 실행 중임을 표현하자"

## 범위

- 포함:
  - `.badge-running` 스타일 제거 (텍스트 배지 미사용)
  - `tool-icon-running` CSS 클래스 + `@keyframes` 애니메이션 추가 (badges.css)
  - `renderers.js` — pre_tool 상태 시 아이콘에 `tool-icon-running` 클래스 적용
  - `renderers.js` — 텍스트 배지 HTML(`badge-running`) 렌더링 코드 제거

- 제외:
  - DB/서버 API 로직
  - 다른 배지 스타일 변경
  - toolIconHtml 함수 시그니처 변경

## 단계별 계획

### 1단계: 문서화 (plan / adr / tasks)
- plan.md 작성 (현재)
- adr.md — 애니메이션 방식 결정
- tasks.md — 원자성 작업 분해

### 2단계: CSS 구현 (badges.css)
- `@keyframes tool-running-pulse` 정의 (맥동/스케일 조합)
- `.tool-icon-running` 클래스 — 애니메이션 적용
- `.badge-running` 규칙 제거

### 3단계: JS 렌더러 수정 (renderers.js)
- `toolIconHtml(toolName, inProgress?)` — 두 번째 인자로 실행 중 여부 수신
- `makeTargetCell` — `inProgress` 시 `toolIconHtml(r.tool_name, true)` 호출
- `statusBadge` 텍스트 배지 생성 코드 제거

### 4단계: 브라우저 검증
- 실행 중인 서버에서 대시보드 확인
- pre_tool 행 아이콘 애니메이션 동작 확인
- 완료 행 일반 아이콘 확인

## 완료 기준

- [ ] `.badge-running` 스타일 badges.css에서 제거
- [ ] `tool-icon-running` 클래스 CSS 애니메이션 구현
- [ ] pre_tool 상태 아이콘에 `tool-icon-running` 클래스 적용
- [ ] 텍스트 배지 HTML 렌더링 코드 제거
- [ ] 하드코딩 색상 없음 (CSS 변수만 사용)
- [ ] 완료 상태 행은 애니메이션 없음
