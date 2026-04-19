# context-chart-toggle Tasks

> Feature: context-chart-toggle
> 시작일: 2026-04-19
> 상태: 완료

## Tasks

- [x] T-01: `detail-view.css` — `.detail-collapsed` 규칙에서 `.view-tab-bar`, `.detail-controls-bar`, `.detail-loading`, `.detail-content` 숨김 4줄 제거
- [x] T-02: `index.html` — `context-chart-section` 내부에 `.context-chart-inner` 래퍼 div 추가
- [x] T-03: `context-chart.css` — `context-chart-section`에 `display: grid` + `grid-template-rows` transition 추가, `.context-chart-section--collapsed` 클래스 정의
- [x] T-04: `main.js` — `toggleDetailCollapse()`에서 `context-chart-section`에 `--collapsed` 클래스 토글 추가
- [x] T-05: `screen-inventory.md` 현행화

## 완료 기준

- [x] 접힘 상태에서 탭바·컨트롤바·콘텐츠가 정상 표시됨
- [x] `context-chart-section`이 부드럽게 접힘/펼침 (ease-in-out transition)
- [x] chevron 아이콘 rotate 정상 동작 유지
- [x] CSS 변수만 사용, 하드코딩 색상 없음
- [x] `screen-inventory.md` 현행화 완료
