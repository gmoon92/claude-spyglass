# tooltip-supplement ADR

## ADR-001: Cache Panel 툴팁 구현 방식

### 상태
**결정됨** (2026-04-19)

### 배경
Cache Intelligence Panel의 Hit Rate 바, 비용 비교(without cache / actual cost / saved),
Creation/Read 비율 바는 수치 의미를 직관적으로 알기 어렵다.
기존에는 stat-tooltip.js(`data-stat-tooltip` 패턴)와 cache-tooltip.js(`.cache-cell` 패턴)
두 가지 커스텀 툴팁 시스템이 공존한다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | 신규 `cache-panel-tooltip.js` 파일 작성 | stat-tooltip 패턴 완전 재현, 관심사 분리 | 파일 1개 추가 |
| B | stat-tooltip.js의 `STAT_TOOLTIP_CONTENT` 맵에 키 추가 | 파일 추가 없음 | stat-card와 무관한 키가 혼재, 관심사 오염 |
| C | HTML `title` 속성만 사용 | 구현 최소화 | 브라우저 기본 스타일, 디자인 일관성 없음 |

### 결정
옵션 A — `cache-panel-tooltip.js` 신규 파일, `data-cache-panel-tooltip` 속성 패턴 사용.
CSS는 기존 `.stat-tooltip` 클래스 재사용(신규 CSS 클래스 추가 불필요).

### 이유
1. stat-tooltip.js 패턴을 그대로 따르므로 코드 가독성·유지보수 용이
2. `.stat-tooltip` CSS가 이미 모든 필요 스타일을 충족하므로 CSS 변경 없이 재사용 가능
3. 관심사 분리: cache-panel 전용 콘텐츠 맵을 독립 파일에서 관리

---

## ADR-002: Turn View / Detail Badges 툴팁 방식

### 상태
**결정됨** (2026-04-19)

### 배경
Turn View의 `.turn-meta`(`도구 N개 · IN N · OUT N · ⏱ N`)와 Detail Aggregate Badges
(`.detail-agg-badge`)는 JS 코드에서 동적으로 생성된다.
별도 커스텀 툴팁 시스템을 추가하면 초기화 코드와 JS 볼륨이 증가한다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | HTML `title` 속성 삽입 (JS 내 템플릿 문자열) | 구현 최소화, 파일 추가 없음 | 브라우저 기본 외형 |
| B | 커스텀 툴팁 신규 추가 | 디자인 통일 | 오버엔지니어링, 요소가 동적 생성이라 이벤트 위임 복잡도 증가 |

### 결정
옵션 A — `session-detail.js`의 렌더링 함수 내 `title` 속성 삽입.

### 이유
1. Turn meta·aggregate badges는 보조 정보 수준이므로 브라우저 기본 `title` 툴팁으로 충분
2. 커스텀 툴팁 추가 시 이벤트 위임 복잡도가 높아져 단일 책임 원칙에 반함
3. 변경 최소화 원칙: 기존 동작을 유지하면서 최소 코드만 수정

---

## ADR-003: 정적 HTML 요소 툴팁 방식

### 상태
**결정됨** (2026-04-19)

### 배경
`#liveBadge`, 날짜 필터 버튼(전체/오늘/이번주), 타입 필터 버튼(All/prompt/tool_call/system)은
index.html에 정적으로 선언된다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | HTML `title` 속성 직접 추가 | 가장 단순, JS 불필요 | 브라우저 기본 외형 |
| B | JS로 `title` 동적 주입 | 관리 집중화 | 정적 요소에 JS 주입은 불필요 복잡도 |

### 결정
옵션 A — `index.html`에 `title` 속성 직접 삽입.

### 이유
1. 정적 요소는 정적으로 처리하는 것이 단순하고 명확함
2. 날짜 필터 설명(로컬 시간 기준)처럼 변하지 않는 내용은 HTML에 고정하는 것이 적합
