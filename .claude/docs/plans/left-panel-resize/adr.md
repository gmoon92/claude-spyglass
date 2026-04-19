# ADR — left-panel-resize

## ADR-001: 패널 너비 업데이트 방식

### 상태
**결정됨** (2026-04-19)

### 배경
`.main-layout`이 `grid-template-columns: var(--left-panel-width) 1fr`로 정의되어 있어, CSS 변수 하나만 바꾸면 레이아웃 전체가 반응한다. 너비를 직접 DOM 스타일로 쓰는 방식과 CSS 변수 방식 중 선택이 필요했다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A — CSS 변수 | `document.documentElement.style.setProperty('--left-panel-width', px)` | 레이아웃 코드 변경 없음, 토큰 SSoT 유지 | 없음 |
| B — 인라인 스타일 | `panelEl.style.width = px` + `rightPanelEl.style.flex = '1'` | 직관적 | 그리드 구조 우회, 반응형 미디어 쿼리와 충돌 가능 |

### 결정
**옵션 A — CSS 변수 방식** 채택

### 이유
1. 기존 그리드 레이아웃 구조를 그대로 유지
2. 반응형 미디어 쿼리(`@media max-width: 768px`)와 충돌 없음
3. 디자인 토큰 SSoT 원칙 준수

---

## ADR-002: panel-resize.js 신규 파일 vs col-resize.js 확장

### 상태
**결정됨** (2026-04-19)

### 배경
이미 `col-resize.js`가 테이블 컬럼 드래그 리사이즈 로직을 담고 있다. 패널 리사이즈를 같은 파일에 추가할지 별도 파일로 분리할지 결정이 필요했다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A — 신규 파일 | `panel-resize.js` 별도 생성 | 관심사 분리, 독립 테스트 가능 | 파일 수 증가 |
| B — col-resize.js 확장 | 기존 파일에 패널 리사이즈 함수 추가 | 파일 수 유지 | 테이블 컬럼과 패널 리사이즈가 혼재, 책임 불명확 |

### 결정
**옵션 A — 신규 파일** 채택

### 이유
1. `col-resize.js`는 `<col>` / `<th>` DOM 구조에 특화된 로직 — 패널 리사이즈와 대상이 다름
2. 단일 책임 원칙: 파일명만 봐도 역할이 명확
3. 향후 Auto-fit 확장, 트리거 이벤트 추가 시 서로 영향 없음

---

## ADR-003: Auto-fit 너비 측정 방식

### 상태
**결정됨** (2026-04-19)

### 배경
더블클릭 Auto-fit 시 패널 내 콘텐츠의 실제 너비를 측정해야 한다. 여러 측정 방법이 존재한다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A — scrollWidth 스캔 | 패널 내 모든 텍스트 요소의 `scrollWidth` 수집 후 최대값 사용 | DOM 기반 실제 렌더링 너비, 구현 단순 | overflow:hidden인 요소는 잘린 너비만 반환 |
| B — Canvas measureText | 폰트 크기·패밀리로 문자열 픽셀 계산 | overflow 무관하게 정확 | 폰트 로딩 타이밍, 각 요소의 font 계산 복잡 |
| C — 임시 span 클론 | 요소를 hidden div에 복사 후 너비 측정 | 정확 | DOM 조작 비용 높음, 플리커 가능 |

### 결정
**옵션 A — scrollWidth 스캔** 채택, overflow:hidden 우회 보완 적용

### 이유
1. 구현이 단순하고 실제 렌더링 결과를 그대로 반영
2. overflow:hidden 문제는 측정 전 `overflow: visible` 임시 적용 후 복원으로 해결
3. 패널 내 요소는 고정 폰트(monospace)로 Canvas 계산과 실제 차이 미미

### 보완 방법
```js
// overflow 임시 해제 → scrollWidth 측정 → 복원
panelEl.style.overflow = 'visible';
const maxW = Math.max(...Array.from(panelEl.querySelectorAll('td, .sess-id, .tool-main'))
  .map(el => el.scrollWidth));
panelEl.style.overflow = '';
```

---

## ADR-004: Auto-fit 로직 공유 방식 (resize-utils.js)

### 상태
**결정됨** (2026-04-19)

### 배경
패널 너비 Auto-fit과 테이블 컬럼 Auto-fit 모두 "대상 요소들의 최대 scrollWidth 측정" 로직이 동일하다. 이 로직을 각 파일에 중복 작성할지 공통 모듈로 분리할지 결정이 필요했다.

`col-resize.js`에는 현재 더블클릭 Auto-fit이 없어 미완성 상태다. 이번 feature에서 함께 완성한다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A — 공통 유틸 분리 | `resize-utils.js`에 `measureMaxWidth()` 작성, 양쪽에서 import | 중복 제거, 버그 수정 시 한 곳만 | 파일 추가 |
| B — 각 파일에 중복 | `panel-resize.js`와 `col-resize.js` 각각 구현 | 파일 간 의존성 없음 | 로직 중복, 수정 시 누락 위험 |
| C — 주석으로 연결 | 각 파일에 구현하되 `// 관련: col-resize.js` 주석 삽입 | 최소 변경 | 중복 유지, 주석은 실행을 강제하지 않음 |

### 결정
**옵션 A — 공통 유틸 `resize-utils.js` 분리** 채택

### 이유
1. 동일한 측정 알고리즘(overflow 임시 해제 → scrollWidth → 복원)을 두 곳에 복사하면 한쪽을 수정할 때 다른 쪽이 누락될 위험이 있음
2. `measureMaxWidth(elements)`는 순수 함수(DOM 읽기만, 부수효과 없음)라 분리 비용이 낮음
3. 컬럼 Auto-fit / 패널 Auto-fit이 동일하게 동작함을 코드 레벨에서 보장

### 인터페이스 설계
```js
// resize-utils.js
/**
 * 주어진 요소 목록에서 가장 넓은 scrollWidth 반환.
 * overflow:hidden 요소도 정확히 측정하기 위해 임시로 visible로 변경 후 복원.
 */
export function measureMaxWidth(elements) {
  // 1. overflow: visible 임시 적용
  // 2. scrollWidth 최대값 수집
  // 3. overflow 복원
  // 4. 최대값 반환
}
```

---

## ADR-005: 너비 범위 및 저장 방식

### 상태
**결정됨** (2026-04-19)

### 배경
리사이즈 최소/최대 한계와 사용자 설정 저장 위치를 결정해야 한다.

### 결정
- **최소 너비**: `180px` — 세션 ID 8자 + 상태 배지가 잘리지 않는 최소값
- **최대 너비**: `480px` — 1280px 해상도에서 우측 패널이 800px 이상 유지되는 한계
- **저장**: `localStorage('spyglass:panel-width')` — 서버 왕복 불필요, 브라우저별 설정으로 충분

### 이유
1. 서버에 저장하면 API 추가 필요 — 설정값 하나에 비해 비용 과다
2. localStorage는 탭 간 공유되므로 같은 브라우저에서 일관된 UX 제공
3. 범위값은 CSS 변수(`--panel-resize-min`, `--panel-resize-max`)로 토큰화하여 추후 변경 용이
