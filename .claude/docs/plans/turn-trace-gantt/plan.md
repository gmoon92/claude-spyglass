# turn-trace-gantt 개발 계획

> Feature: turn-trace-gantt
> 작성일: 2026-04-19
> 작성자: Claude Code

## 목표

세션 상세 뷰에 "간트" 탭을 추가하여 세션 전체의 tool_call 실행 타임라인을 Canvas Gantt 차트로 시각화한다.
서버/DB/TypeScript 파일은 수정하지 않고, 순수 CSS/HTML 레이어만 작성한다.

## 범위

- 포함:
  - `packages/web/assets/css/turn-gantt.css` 신규 작성 (CSS 변수 전용, 하드코딩 색상 없음)
  - `packages/web/index.html` 수정 — 간트 탭 버튼, Gantt 컨테이너 HTML, CSS 링크 추가
- 제외:
  - 서버/DB/TypeScript 코드 변경
  - Gantt Canvas 렌더링 JS 로직 (별도 feature에서 처리)
  - turn-view.css, detail-view.css 변경

## 단계별 계획

### 1단계: CSS 파일 작성
- `packages/web/assets/css/turn-gantt.css` 신규 생성
- 툴바, 힌트, 범례, 스크롤 컨테이너, Canvas 요소 스타일 작성
- CSS 변수(`var(--border)`, `var(--text-dim)` 등)만 사용

### 2단계: index.html 수정
- `<head>` 에 `turn-gantt.css` 링크 추가
- `detailTabBar` 에 간트 탭 버튼 추가 (`tabTurn` 뒤)
- `detailTurnView` 뒤에 `detailGanttView` 컨테이너 삽입

### 3단계: typecheck 검증
- `npm run typecheck` 실행하여 오류 없는지 확인

## 완료 기준

- [ ] `turn-gantt.css` 파일 생성 완료
- [ ] CSS 변수만 사용 (하드코딩 색상 없음)
- [ ] index.html 탭 버튼 추가 완료
- [ ] index.html Gantt 컨테이너 추가 완료
- [ ] index.html CSS 링크 추가 완료
- [ ] `npm run typecheck` 통과
