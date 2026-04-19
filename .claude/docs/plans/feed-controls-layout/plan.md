# feed-controls-layout 개발 계획

> Feature: feed-controls-layout
> 작성일: 2026-04-19
> 작성자: Claude Code

## 목표

defaultView와 detailView 두 로그 뷰 간 feed-controls(검색창 + 타입 필터 버튼) 배치 불일치를 해소하여,
일관된 레이아웃 패턴을 통해 사용자 멘탈 모델을 통일한다.

## 현황 분석

### defaultView
- `view-section-header` 안에 [패널 레이블 | feed-controls] 구조
- `justify-content: space-between` → 컨트롤이 헤더 오른쪽 끝에 묶여 있음
- 검색 + 필터가 `.feed-controls` 컨테이너로 묶여 있음 (clean)

### detailView
- `view-tab-bar` 안에 탭 버튼 3개 + 검색창 + 필터 버튼이 모두 혼재
- 검색창이 탭 중간에 삽입된 형태 (탭 UX 저해)
- 필터 버튼은 `margin-left:auto` 인라인 스타일로 임시 분리
- 탭 영역과 컨트롤 영역의 시각적 경계 불명확

## 개선 방향

detailView에 `view-section-header` 성격의 **별도 컨트롤 행**을 추가하여 defaultView와 동일한 [레이블/탭 | 컨트롤] 2분할 패턴을 적용한다.

### 확정 구조 (after)

```
detailView
├── detail-header          (세션 메타 + 닫기 버튼) — 기존 유지
├── context-chart-section  (Context Growth) — 기존 유지
├── view-tab-bar           (플랫 | 턴 뷰 | 간트) — 탭만 남김
├── detail-controls-bar    (NEW) feed-search + typeFilterBtns (묶음)
├── detail-loading
└── detail-content / turn-view / gantt-view
```

### 적용 패턴
- `detail-controls-bar`를 `.view-section-header` 변형으로 스타일링
  - `background: var(--surface-alt)`, `border-bottom: 1px solid var(--border)`
  - 내부: `.feed-controls` 컨테이너로 검색 + 필터 묶음 → `margin-left: auto`로 우측 정렬

## 범위

- 포함:
  - `index.html` — detailView 내 탭 바 구조 수정, `detail-controls-bar` 추가
  - `default-view.css` — `.detail-controls-bar` 스타일 추가
  - 인라인 스타일 제거 (`margin-left:auto`, `padding:4px 0`, `border-left` 등)
- 제외:
  - defaultView 구조 변경 (이미 정합)
  - JS 로직 변경 (이벤트 핸들러 동작 유지)
  - DB / 서버 / 비즈니스 로직

## 단계별 계획

### 1단계: ADR 작성
- 레이아웃 분리 방식(별도 행 vs 탭 바 내 2분할) 결정 기록

### 2단계: Tasks 분해
- 원자성 작업 목록 작성

### 3단계: HTML 수정
- `view-tab-bar` 에서 `.feed-search.detail-search`와 `#detailTypeFilterBtns` 분리
- `detail-controls-bar` div 추가, 내부에 `.feed-controls` 패턴 적용

### 4단계: CSS 수정
- `.detail-controls-bar` 클래스 추가 (`.view-section-header` 변형)
- `.detail-search` 전용 오버라이드 정리

### 5단계: 검증
- 두 뷰 나란히 비교: 헤더/컨트롤 행 높이, 배경색, 정렬 일치 확인
- 인라인 스타일 완전 제거 확인
- 탭 전환 시 컨트롤 가시성 확인

## 완료 기준

- [ ] detailView 탭 바에 컨트롤 요소 혼재 없음
- [ ] `detail-controls-bar` 가 defaultView의 `view-section-header + feed-controls` 와 동일 시각 패턴
- [ ] `#detailTypeFilterBtns` 의 인라인 스타일(`margin-left:auto` 등) 완전 제거
- [ ] CSS 변수만 사용, 하드코딩 색상 없음
- [ ] screen-inventory.md 현행화 완료
