# context-chart-toggle 개발 계획

> Feature: context-chart-toggle
> 작성일: 2026-04-19
> 작성자: Claude Code

## 목표

detailView의 접기/펼치기 토글 대상을 `context-chart-section` 영역만으로 축소하고,
`display: none` 방식을 CSS transition 기반 애니메이션으로 교체하여 자연스러운 UX를 제공한다.

## 배경

현재 `.detail-collapsed` 상태는 탭바·컨트롤바·콘텐츠까지 모두 숨겨 사용성이 떨어진다.
사용자는 차트를 접어도 탭 전환·검색·목록 조회를 계속할 수 있어야 한다.
또한 `display: none` 토글은 CSS transition이 적용되지 않아 급격한 화면 전환이 발생한다.

## 범위

### 포함

- `.detail-collapsed` CSS 규칙에서 탭바·컨트롤바·콘텐츠 숨김 제거
- `context-chart-section` 전용 접기/펼치기 CSS transition 구현 (max-height 또는 grid-template-rows 방식)
- chevron 아이콘 rotate 유지 (기존 `.btn-toggle svg` 동작 보존)
- `context-chart.js`의 canvas 빈/채움 상태 토글과 CSS transition 충돌 방지 검토
- `main.js` `toggleDetailCollapse()` 함수 수정 필요 여부 검토
- `screen-inventory.md` 현행화

### 제외

- 탭바 UI 변경
- 콘텐츠 영역 레이아웃 변경
- 서버 API·DB 스키마 수정

## 단계별 계획

### 1단계: 현황 파악 및 ADR 작성
- `detail-view.css`, `context-chart.css`, `context-chart.js`, `main.js` 코드 분석
- 애니메이션 구현 방식(max-height vs grid-template-rows) 결정
- `adr.md` 작성

### 2단계: tasks.md 작성
- 원자성 작업 분해 및 `tasks.md` 작성

### 3단계: CSS 수정 (`detail-view.css`)
- `.detail-collapsed` 규칙에서 탭바·컨트롤바·콘텐츠 숨김 3줄 제거
- `.detail-header`의 `border-bottom: none` 처리 방식 재검토

### 4단계: CSS 수정 (`context-chart.css`)
- `context-chart-section` wrapper 또는 inner 요소에 transition 속성 추가
- 접힘/펼침 상태 클래스 정의 (`.context-chart-section--collapsed`)

### 5단계: JS 수정 (`main.js`)
- `toggleDetailCollapse()`에서 `context-chart-section`에 collapsed 클래스 토글
- `context-chart.js` 충돌 여부 최종 확인

### 6단계: screen-inventory.md 현행화

## 완료 기준

- [ ] 탭바·컨트롤바·콘텐츠는 접힘 상태에서도 항상 표시됨
- [ ] `context-chart-section`만 부드럽게 접힘/펼침 (transition 동작 확인)
- [ ] chevron 아이콘 방향 전환 정상 동작
- [ ] `context-chart.js` 캔버스 렌더링과 충돌 없음
- [ ] CSS 변수만 사용, 하드코딩 색상 없음
- [ ] `screen-inventory.md` 현행화 완료
