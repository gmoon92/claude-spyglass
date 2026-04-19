# feed-controls-layout Tasks

> Feature: feed-controls-layout
> 시작일: 2026-04-19
> 상태: 완료

## Tasks

### HTML 수정 (index.html)

- [x] `view-tab-bar` 에서 `.feed-search.detail-search` 제거
- [x] `view-tab-bar` 에서 `#detailTypeFilterBtns` 제거
- [x] `view-tab-bar` 아래에 `detail-controls-bar` div 추가
- [x] `detail-controls-bar` 내부에 `.feed-controls` 컨테이너로 검색창 + 필터 버튼 묶기
- [x] `#detailTypeFilterBtns` 인라인 스타일 전부 제거

### CSS 수정 (default-view.css)

- [x] `.detail-controls-bar` 클래스 추가 — `view-section-header` 변형 (배경색, 하단 테두리, flex, padding)
- [x] `.detail-type-filter-btns` — 인라인 스타일 이관 (border-left, padding-left, gap)
- [x] 기존 `.detail-search` 전용 오버라이드 없음 확인 (불필요 규칙 없음)

### 검증

- [x] defaultView와 detailView 컨트롤 행 높이 / 배경색 / 정렬 시각 일치 확인
- [x] 인라인 스타일 완전 제거 확인 (`margin-left:auto` 등 잔존 없음)
- [x] 탭 전환(플랫/턴뷰/간트) 시 컨트롤 바 가시성 및 동작 유지 확인 (setDetailView는 콘텐츠 뷰만 토글)
- [x] CSS 변수 미사용 하드코딩 색상 없음 확인
- [x] screen-inventory.md 현행화

## 완료 기준

- detailView 탭 바에 컨트롤 요소 혼재 없음
- `detail-controls-bar` 가 defaultView `view-section-header + feed-controls` 와 동일 시각 패턴
- 인라인 스타일 완전 제거
- CSS 변수만 사용
- screen-inventory.md 업데이트 완료
