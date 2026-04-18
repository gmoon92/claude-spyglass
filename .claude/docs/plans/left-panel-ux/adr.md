# Left Panel UX Architecture Decision Records

> 작성일: 2026-04-18  
> 참여 전문가: 소프트웨어 아키텍트, UX 디자이너, 프론트엔드 엔지니어

---

## ADR-001: Grid 트랙을 고정 크기로 전환

### 상태
**결정됨** (2026-04-18)

### 배경

`.left-panel`의 `grid-template-rows: 1fr 1fr auto`에서 `auto` 트랙은 툴 통계 섹션의 `display: none` 상태일 때 0px를 점유한다. SSE로 데이터가 도착해 섹션이 나타나면 `1fr` 트랙들이 순간 재계산되어 레이아웃 점프가 발생한다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A: 고정 px 트랙 | `1fr 1fr 160px` | 예측 가능, 점프 없음 | 소형 뷰포트 압박 가능 |
| B: `auto + min-height` | `auto` 유지 + `min-height: 160px` | 유연 | Grid에서 `auto` 트랙은 여전히 수축 가능 |
| C: `minmax(0, 160px)` | 유연 범위 지정 | 유연 | 콘텐츠 없을 때 0으로 수축, 동일 문제 재발 |

### 결정

`grid-template-rows: 1fr 1fr 160px`으로 고정 트랙 사용.  
`--tool-stats-height: 160px` CSS 변수로 추출해 중복 값 단일화.

### 이유

1. 고정 픽셀 트랙은 데이터 유무와 무관하게 항상 동일한 공간을 점유 (아키텍트)
2. 레이아웃 예약이 없으면 스켈레톤 목적이 무효화됨 (UX 디자이너)
3. `max-height: 160px`와 동일한 값이 두 곳에 중복 → CSS 변수로 단일화 (프론트엔드)

### 대안 채택 시 영향

- 옵션 B/C 선택 시: 동일한 레이아웃 점프 재발 가능

---

## ADR-002: `display` 토글 제거 및 빈 상태 UI 도입

### 상태
**결정됨** (2026-04-18)

### 배경

`renderTools()`에서 `section.style.display = 'none'`으로 섹션 자체를 숨기는 방식은 예약된 Grid 트랙과 충돌한다. 인라인 스타일은 CSS 캐스케이드보다 우선순위가 높아 미디어 쿼리 등 다른 규칙을 무력화할 수 있다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A: 빈 상태 UI | 스켈레톤/텍스트로 빈 상태 표시 | 공간 의미 있게 채움 | 빈 상태 디자인 필요 |
| B: `visibility: hidden` | 공간 유지하며 숨김 | 공간 유지 | 접근성 이슈, 모바일 쿼리와 충돌 |
| C: 인라인 스타일 유지 | 현재 방식 | 변경 없음 | 레이아웃 점프 지속 |

### 결정

`display` 조작 코드를 완전히 제거하고, 빈 상태에서는 기존 스켈레톤 행을 표시한다.  
모바일 `display: none`은 미디어 쿼리에서 그대로 유지한다.

### 이유

1. JS의 `display` 조작은 CSS와 암묵적 계약을 형성해 유지보수 위험 (아키텍트)
2. 의미 있는 빈 상태 UI가 Nielsen 휴리스틱 #1(시스템 상태 가시성)을 충족 (UX 디자이너)
3. 클래스/상태 기반 관리가 CSS와 JS 관심사를 분리 (프론트엔드)

---

## ADR-004: `.error-banner` display:none → max-height:0 전환 + `.main-layout` 명시적 행

### 상태
**결정됨** (2026-04-18) — 2차 전문가 회의

### 배경

1차 수정(ADR-001~003) 후 테스트 결과, 프로젝트 전환 시 왼쪽 패널 전체 높이가 달라지는 문제가 발견됐다:
- rv-iso (세션 10개): mainLayout=643.5px ← 정상
- test (세션 2개): mainLayout=516px ← 비정상

측정으로 진짜 원인 파악:
```
body gridTemplateRows: "52px 42.5px 476px 195.5px 0px"
```
`.error-banner`가 `display:none`으로 grid에서 제외되어 body 5개 트랙에 visible 자식이 4개만 배치됨. 결과:
- Row 1 (auto): header=52px
- Row 2 (auto): summary-strip=42.5px  ← error-banner 건너뜀
- Row 3 (auto): main-layout=476px  ← **auto 트랙에 배치됨!**
- Row 4 (1fr): footer=195.5px  ← 1fr을 footer가 차지
- Row 5 (auto): 0px

`.main-layout`이 `1fr` 트랙이 아닌 `auto` 트랙에 배치되어 콘텐츠 기반으로 높이가 결정됨.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A: `display:none` → `max-height:0` | grid 참여 유지하며 시각적 숨김 | 근본 원인 해결, grid 순서 보존 | max-height transition 필요 시 추가 작업 |
| B: `grid-row: 4` 명시 | main-layout 위치 강제 지정 | 단순 | 행 번호 하드코딩, 구조 변경 시 취약 |
| C: error-banner를 body 밖으로 이동 | 구조적 해결 | 명확 | HTML 구조 변경 필요, 영향 범위 큼 |

### 결정

두 가지를 함께 적용:
1. `.error-banner`: `display:none` 제거 → `display:flex; max-height:0; overflow:hidden`으로 교체. `.visible` 시 `max-height:60px`
2. `.main-layout`: `grid-template-rows: 1fr` 추가 (내부 fr 계산에 definite height 제공)

### 이유

1. `display:none`은 grid layout에서 요소를 완전히 제거해 형제 요소의 grid 배치가 어긋남 — 이것이 실제 근본 원인 (2차 전문가 회의 공통 진단)
2. `max-height:0; overflow:hidden`은 시각적으로 숨기면서 grid 참여를 유지해 형제 배치 안정 (아키텍트)
3. `.main-layout`에 `grid-template-rows:1fr`을 추가해 내부 `.left-panel`이 definite 높이를 가질 수 있게 함 (프론트엔드)
4. 수정 후 전체 측정값: `"52px 0px 42.5px 643.5px 28px"` — main-layout이 1fr 트랙(643.5px)에 정확히 배치됨 ✓

### 결과 검증

3개 프로젝트 전환 후 측정:
- rv-iso: mainLayout=644px, leftPanel=644px ✓
- claude-code-system: mainLayout=644px, leftPanel=644px ✓
- test: mainLayout=644px, leftPanel=644px ✓

### 대안 채택 시 영향

- 옵션 B: 행 번호가 하드코딩되어 error-banner 외 다른 자식 추가 시 깨질 수 있음
- 옵션 C: HTML 구조 변경으로 JS 이벤트 핸들러, CSS 선택자 등 영향 범위 큼

---

## ADR-003: 반응형 처리 범위 한정

### 상태
**결정됨** (2026-04-18)

### 배경

모바일(`max-width: 768px`)에서 `.tool-stats-section { display: none }`이 이미 적용된다. 데스크탑 개선이 이 미디어 쿼리와 충돌하지 않아야 한다.

### 결정

모바일 미디어 쿼리 내 `display: none`은 변경하지 않는다.  
데스크탑에서만 고정 트랙 + 빈 상태 UI 방식을 적용한다.

### 이유

모바일 처리는 의도적 Progressive Disclosure이며 현재 개선 범위 밖이다.  
`display: none`을 JS에서 제거하더라도 CSS 미디어 쿼리의 `display: none`은 독립적으로 동작한다.
