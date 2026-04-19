# detail-ux-improvements Tasks

> Feature: detail-ux-improvements
> 시작일: 2026-04-19
> 상태: 완료

## Tasks

### 개선 1 — 닫기 → 접기 버튼

- [x] `index.html` 281번째 줄: 버튼 텍스트 `닫기` → `‹ 접기` 변경
- [x] `detail-view.css` `.btn-close:hover`: `border-color: var(--red)` → `var(--text-muted)`, `color: var(--red)` → `var(--text-muted)` 변경

### 개선 2 — Context Growth 차트 기본 표시

- [x] `index.html` 285번째 줄: `style="display:none"` 인라인 스타일 제거
- [x] `index.html` 290번째 줄 아래: `.context-chart-empty` div 마크업 추가
- [x] `context-chart.css`: `.context-chart-empty` 빈 상태 스타일 추가
- [x] `context-chart.css`: `.context-chart-hidden` (canvas 숨김), `.context-chart-empty--visible` (empty 표시) 클래스 추가
- [x] `context-chart.js` `renderContextChart()`: `hasValid=false` 시 `section.style.display='none'` → 빈 상태 클래스 토글로 대체
- [x] `context-chart.js` `clearContextChart()`: `section.style.display='none'` → 빈 상태 클래스 토글로 대체

### 현행화

- [x] `screen-inventory.md`: 2-0 상세 헤더 btn-close 항목 현행화 (접기 버튼)
- [x] `screen-inventory.md`: 2-0에 Context Growth 섹션 명세 추가 (항상 표시, 빈 상태)
- [x] `screen-inventory.md`: 변경 이력 행 추가

## 완료 기준

- [x] 버튼 텍스트 "접기", 아이콘 `‹` 표시
- [x] hover 색상 `var(--text-muted)` 적용 (red 없음)
- [x] Context Growth 섹션 인라인 스타일 없음
- [x] 데이터 없을 때 `.context-chart-empty` 표시
- [x] 데이터 있을 때 canvas 정상 렌더링
- [x] CSS 변수만 사용 (하드코딩 색상 없음)
- [x] screen-inventory.md 현행화 완료
