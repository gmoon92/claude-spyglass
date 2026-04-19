# feed-controls-layout ADR

## ADR-001: detailView 컨트롤 영역 분리 방식

### 상태
**결정됨** (2026-04-19)

### 배경

detailView의 `view-tab-bar` 안에 탭 버튼(플랫/턴뷰/간트)과 feed-search, typeFilterBtns가 모두 혼재해 있다.
검색창이 탭 버튼 사이에 끼어 있어 탭 영역의 의미가 희석되고,
defaultView의 [레이블 | 컨트롤] 분리 패턴과 구조적으로 불일치한다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A. 탭 바 내 2분할 | `view-tab-bar`를 flex로 유지하되 탭 그룹/컨트롤 그룹을 명시적으로 래핑 | 행 수 동일, 높이 최소화 | 탭과 컨트롤이 같은 행에 공존 → 시각적 구분 여전히 약함 |
| B. 별도 컨트롤 행 추가 | `view-tab-bar` 아래에 `detail-controls-bar` 행을 독립적으로 추가 | defaultView `view-section-header` 패턴과 완전 일치, 탭 순도 유지 | 행 하나 추가 → 상하 공간 소비 약간 증가 |
| C. 탭 바 상단 이동 | 컨트롤을 `detail-header` 영역으로 올림 | 행 수 감소 | 세션 메타 정보와 혼재, 의미 충돌 |

### 결정

**옵션 B — 별도 컨트롤 행(`detail-controls-bar`) 추가**

### 이유

1. defaultView의 `view-section-header` + `.feed-controls` 패턴과 1:1로 대응되어 레이아웃 멘탈 모델이 통일된다.
2. 탭 바는 탭 내비게이션만 담당하고, 컨트롤 바는 필터링만 담당 — 단일 책임 원칙 준수.
3. `.view-section-header` CSS 클래스를 변형 없이 재사용할 수 있어 스타일 중복을 최소화한다.
4. 추가되는 행 높이(약 34px)는 세션 상세 뷰의 콘텐츠 밀도 대비 수용 가능한 수준이다.

---

## ADR-002: 인라인 스타일 제거 방침

### 상태
**결정됨** (2026-04-19)

### 배경

`#detailTypeFilterBtns`에 `margin-left:auto`, `padding:4px 0`, `border-left:1px solid var(--border)`, `padding-left:12px` 등이
인라인 스타일로 직접 기입되어 있어 CSS 파일 단독으로 스타일을 추론·수정하기 어렵다.

### 결정

해당 인라인 스타일을 모두 제거하고 `.detail-controls-bar .feed-controls` 컨텍스트 선택자로 `default-view.css`에 이관한다.

### 이유

1. 디자인 토큰 변경 시 단일 CSS 파일만 수정하면 된다.
2. 인라인 스타일은 CSS 변수 상속을 방해할 수 있어 다크/라이트 테마 전환 안정성을 높인다.
3. CLAUDE.md 개발 원칙(CSS 변수만 사용, 하드코딩 금지)과 일치한다.
