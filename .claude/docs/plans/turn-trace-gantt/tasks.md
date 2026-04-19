# turn-trace-gantt Tasks

> Feature: turn-trace-gantt
> 시작일: 2026-04-19
> 상태: 완료

## Tasks

### CSS

- [x] `packages/web/assets/css/turn-gantt.css` 신규 작성
  - [x] `.gantt-toolbar` 스타일 (flex, justify-content:space-between, padding, border-bottom, flex-shrink)
  - [x] `.gantt-hint` 스타일 (font-size:10px, color:var(--text-dim))
  - [x] `.gantt-legend` 스타일 (flex, gap:8px, flex-wrap:wrap)
  - [x] `.gantt-legend-item` 스타일 (inline-flex, align-items, gap, font-size, color)
  - [x] `.gantt-legend-dot` 스타일 (8px × 8px, border-radius:2px, flex-shrink)
  - [x] `.gantt-scroll` 스타일 (flex:1, overflow-y:auto, overflow-x:hidden, position:relative)
  - [x] `#turnGanttChart` 스타일 (display:block, width:100% — height는 JS 동적 설정)
  - [x] CSS 변수만 사용 검증 (하드코딩 색상 없음)

### HTML (index.html)

- [x] `<head>` 에 `turn-gantt.css` 링크 추가
- [x] `detailTabBar` 에 간트 탭 버튼 추가 (`tabTurn` 뒤에 삽입)
- [x] `detailTurnView` 뒤에 `detailGanttView` 컨테이너 삽입

### 검증

- [x] `npm run typecheck` 통과 확인

## 완료 기준

- [x] `turn-gantt.css` 파일 생성, CSS 변수만 사용
- [x] `index.html` 탭 버튼 / Gantt 컨테이너 / CSS 링크 추가 완료
- [x] `npm run typecheck` 오류 없음
