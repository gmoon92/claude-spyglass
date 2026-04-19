# left-panel-collapse 개발 계획

> Feature: left-panel-collapse
> 작성일: 2026-04-20
> 작성자: Claude Code

## 목표

웹 대시보드 왼쪽 패널의 3개 섹션(프로젝트 / 세션 / 툴 통계)에 접기/펼치기 토글 버튼을 추가하여, 사용자가 패널 영역을 동적으로 관리할 수 있도록 함. 상태는 localStorage에 영속화됨.

## 범위

### 포함
- 각 `.panel-section` 헤더에 `<` 화살표 토글 버튼 추가 (`.btn-panel-toggle` 클래스)
- 접힘 상태: `.panel-section--collapsed` 클래스 토글, `.panel-body` 숨김
- 화살표 회전: detail-view의 `.btn-toggle` 패턴 재사용 (180도 회전)
- localStorage 영속화: 3개 키 (`left-panel-collapsed-projects`, `-sessions`, `-tools`)
- 기존 동작 보존: `.panel-resize-handle`, 동적 텍스트 업데이트, 이벤트 위임

### 제외
- 다른 패널이나 뷰의 collapse 기능 변경
- 세션/툴 통계 섹션의 hint 텍스트 제거 (동적 콘텐츠이므로 유지)

## 단계별 계획

### 1단계: 기술 결정 (ADR 문서 작성)
- grid-template-rows 문제 해결 방안 결정 (auto vs JS 제어)
- 토글 버튼 위치 결정: hint가 있으면 옆에, 없으면 단독

### 2단계: CSS 수정
- `.btn-panel-toggle` 스타일 추가 (detail-view의 `.btn-toggle` 참조)
- `.panel-section--collapsed` 상태에서 `.panel-body` 숨김
- grid row 높이 조정 (ADR에서 선택한 방식에 따름)

### 3단계: HTML 구조 수정
- 프로젝트 섹션: hint 제거, 토글 버튼 추가
- 세션/툴 통계: hint 유지, 토글 버튼을 오른쪽에 추가

### 4단계: JavaScript 구현
- 토글 함수: `togglePanelSection(sectionId)` — 상태 토글 + localStorage 저장
- 초기화: 페이지 로드 시 localStorage에서 상태 복원
- 이벤트 위임: 각 토글 버튼에 클릭 핸들러 등록

### 5단계: 동작 테스트 및 검증
- 브라우저에서 각 섹션 접기/펼치기 확인
- localStorage 영속화 확인 (새로고침 후에도 상태 유지)
- `.panel-resize-handle` 충돌 확인
- 세션/툴 통계 동적 업데이트 로직 정상 동작 확인

## 완료 기준

- [ ] plan.md 작성 완료
- [ ] adr.md 작성 완료
- [ ] tasks.md 작성 완료
- [ ] CSS 수정 (left-panel.css)
- [ ] HTML 수정 (index.html)
- [ ] JavaScript 구현 (main.js)
- [ ] 브라우저 테스트 통과
- [ ] 요구사항 6개 모두 충족
