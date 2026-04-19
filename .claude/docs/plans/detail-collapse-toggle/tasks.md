# detail-collapse-toggle Tasks

> Feature: detail-collapse-toggle
> 시작일: 2026-04-19
> 상태: 완료

## Tasks

- [x] T-01: [HTML] detail-header 버튼 영역을 `.detail-actions` 그룹으로 교체
- [x] T-02: [CSS] `.detail-actions` 버튼 그룹 스타일
- [x] T-03: [CSS] `.btn-toggle` 접기/펼치기 토글 버튼 스타일
- [x] T-04: [CSS] `.btn-close` 닫기 버튼 재설계
- [x] T-05: [CSS] `.detail-collapsed` 상태 정의
- [x] T-06: [JS] `toggleDetailCollapse()` 함수 추가
- [x] T-07: [JS] `#btnToggleDetail` click 이벤트 바인딩
- [x] T-08: [JS] 접힌 헤더 클릭 시 펼치기 이벤트
- [x] T-09: [JS] `closeDetail()` 호출 시 collapsed 상태 초기화
- [x] T-10: [DOCS] screen-inventory.md 화면 2-0 섹션 현행화

## 완료 기준

- [x] 접기 버튼 클릭 시 context-chart, tab-bar, controls-bar, detail-content 숨김
- [x] 접힌 상태에서 세션 ID·프로젝트명 보임
- [x] 펼치기: 토글 버튼 재클릭 또는 헤더 클릭으로 복원
- [x] 닫기 버튼은 별도 존재, closeDetail() 정상 호출
- [x] CSS 변수만 사용 (하드코딩 색상 없음)
- [x] 인라인 스타일 없음
- [x] screen-inventory.md 현행화 완료
