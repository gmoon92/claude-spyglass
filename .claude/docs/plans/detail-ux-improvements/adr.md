# ADR — detail-ux-improvements

> Feature: detail-ux-improvements
> 작성일: 2026-04-19

---

## ADR-001: 접기 버튼 아이콘 선택

### 상태
**결정됨** (2026-04-19)

### 배경
"닫기" 버튼의 기능은 detailView를 닫고 defaultView로 돌아가는 것이다.
"닫기"라는 레이블은 내용을 제거한다는 의미로 오해될 수 있으며,
실제 동작인 "패널 접기/복귀" 의미와 맞지 않는다.
아이콘을 추가해 직관성을 높이고 레이블을 "접기"로 교체한다.

### 고려한 옵션

| 옵션 | 문자 | 설명 | 장점 | 단점 |
|------|------|------|------|------|
| A | `‹` | 좌향 꺽쇠 (single) | 심플, 접기 방향 명확 | 폰트에 따라 작게 보일 수 있음 |
| B | `←` | 좌향 화살표 | 의미 명확 | 이동보다는 뒤로 가기 느낌 |
| C | `⌃` | 위 방향 꺽쇠 (caret) | 패널 접기 느낌 | 방향이 모호 (위 = 접기 아닐 수도) |

### 결정
옵션 A: `‹` (U+2039 SINGLE LEFT-POINTING ANGLE QUOTATION MARK) 사용.
버튼 텍스트: `‹ 접기`

### 이유
1. 좌향 꺽쇠(‹)는 "이전으로 돌아가기/패널 접기" 의미를 직관적으로 전달
2. 화살표(←)보다 소형화된 아이콘으로 버튼 크기에 자연스럽게 어울림
3. 기존 11px font-size와 맞고 추가 CSS 없이 인라인 문자로 처리 가능

---

## ADR-002: 접기 버튼 hover 색상 결정

### 상태
**결정됨** (2026-04-19)

### 배경
현재 `.btn-close:hover`는 `var(--red)` / `var(--red)` 로 강조된다.
"접기"로 의미가 바뀐 상황에서 red hover는 삭제/위험 동작 연상을 일으켜 부적절하다.
중립적이고 자연스러운 색상으로 교체한다.

### 고려한 옵션

| 옵션 | 색상 | 설명 | 장점 | 단점 |
|------|------|------|------|------|
| A | `var(--text-muted)` (#888) | 중간 회색 | 중립적, 기본 텍스트 계열 | 강조 약할 수 있음 |
| B | `var(--accent)` (#d97757) | 브랜드 accent | 일관된 인터랙션 색상 | 중요 동작처럼 보일 수 있음 |
| C | `var(--text)` (#e8e8e8) | 밝은 기본 텍스트 | 자연스러운 밝아짐 | 강조 다소 약함 |

### 결정
옵션 A: `var(--text-muted)` 로 border-color 및 color 동시 변경.

### 이유
1. 중립적 회색(#888)은 "닫기/삭제" 연상을 주는 red보다 접기(collapse)에 의미적으로 적합
2. accent 색상은 주요 인터랙션 포인트에 집중하는 디자인 원칙에 부합하지 않음
3. text-muted는 기존 design-tokens.css에 이미 정의된 변수로 하드코딩 없음

---

## ADR-003: Context Growth 빈 상태 UI 구현 방식 결정

### 상태
**결정됨** (2026-04-19)

### 배경
현재 유효 데이터 없으면 Context Growth 섹션 전체가 `display:none` 처리된다.
세션마다 차트 유무가 달라져 레이아웃 일관성이 깨진다.
항상 섹션을 표시하되, 데이터 없을 때는 빈 상태(empty state) UI로 대체한다.

### 고려한 옵션

| 옵션 | 방식 | 설명 | 장점 | 단점 |
|------|------|------|------|------|
| A | 캔버스 위 overlay div | canvas 위에 absolute positioned div | 기존 canvas 마크업 유지 | z-index/positioning 복잡 |
| B | 별도 `.context-chart-empty` div | canvas 숨기고 empty div 표시 | 구조 단순, CSS 클래스 토글 | canvas/empty 두 요소 관리 |
| C | footer 영역에 메시지 | canvas height 0, footer에 안내 | 최소 변경 | 시각적 빈 영역 어색함 |

### 결정
옵션 B: 별도 `.context-chart-empty` div를 HTML에 추가하고
데이터 유무에 따라 canvas / empty div를 CSS 클래스 토글로 전환한다.

빈 상태 표시 전략:
- `hasValid === false` → canvas에 `.context-chart-hidden` 추가, empty div에 `.context-chart-empty--visible` 추가
- `hasValid === true` → 반대로 토글
- `clearContextChart()` 도 동일 패턴으로 빈 상태 표시

### 이유
1. 구조가 단순하고 CSS 클래스 토글만으로 상태 전환 가능 — JS 조작 최소화
2. canvas와 empty div가 명확히 분리되어 유지보수 용이
3. `display:none` 인라인 스타일 완전 제거 가능 — 모든 상태가 CSS로 관리됨
4. index.html의 `style="display:none"` 제거 → 기본 표시로 CSS 이관
