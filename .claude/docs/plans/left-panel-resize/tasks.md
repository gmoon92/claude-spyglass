# left-panel-resize Tasks

> Feature: left-panel-resize
> 시작일: 2026-04-19
> 상태: 완료

## Tasks

### 공통 유틸 (먼저 작성)
- [x] `resize-utils.js` **신규** — `measureMaxWidth(elements)` 구현
  - overflow:hidden 임시 해제 → scrollWidth 최대값 수집 → 복원 → 반환
  - panel-resize.js와 col-resize.js 양쪽에서 import하여 사용

### 왼쪽 패널 리사이즈
- [x] `design-tokens.css` — `--panel-resize-min: 180px`, `--panel-resize-max: 480px`, `--panel-resize-handle-width: 4px` 변수 추가
- [x] `left-panel.css` — `.panel-resize-handle` 스타일 추가 (position:absolute, 우측 끝 4px, hover/dragging accent 색상, cursor:col-resize)
- [x] `index.html` — `.left-panel` 내 `<div class="panel-resize-handle"></div>` 삽입 + `panel-resize.js` import
- [x] `panel-resize.js` **신규** — `initPanelResize(panelEl, handleEl)` 구현
  - [x] 드래그 리사이즈 (mousedown → mousemove → mouseup)
  - [x] 더블클릭 Auto-fit (dblclick → `measureMaxWidth()` 호출 → CSS 변수 적용)
  - [x] localStorage 저장/복원 (`spyglass:panel-width`)
  - [x] 범위 제한 (min 180px / max 480px)
  - [x] 드래그 중 텍스트 선택 방지 (`user-select: none`)
- [x] `main.js` — `initPanelResize` import 후 DOMContentLoaded에서 호출

### 테이블 컬럼 Auto-fit 보완 (col-resize.js)
> ⚠️ col-resize.js에 드래그 리사이즈는 있으나 더블클릭 Auto-fit이 없음 — 이번에 함께 완성
- [x] `col-resize.js` 수정 — 각 핸들에 `dblclick` 이벤트 추가
  - `measureMaxWidth(해당 컬럼 td 목록)` 호출 → `cols[i].style.width` 적용

### 문서 현행화
- [x] `screen-inventory.md` — 좌측 패널 섹션에 리사이즈 동작 명세 추가
- [x] `screen-inventory.md` — 테이블 컬럼 리사이즈/Auto-fit 인터랙션 추가

## 완료 기준

- [x] 드래그로 180px~480px 범위에서 너비 자유 조절
- [x] 핸들 더블클릭 시 콘텐츠 길이에 맞게 Auto-fit 동작
- [x] 새로고침 후 마지막 너비 복원 (localStorage)
- [x] 768px 이하에서 핸들 미표시 (반응형 유지)
- [x] 드래그 중 텍스트 선택 방지
- [x] 핸들 hover/dragging 시 시각 피드백 (accent 색상)
- [x] 기존 `col-resize.js` 동작에 영향 없음
