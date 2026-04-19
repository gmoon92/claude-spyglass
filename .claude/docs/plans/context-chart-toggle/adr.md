# context-chart-toggle ADR

## ADR-001: 접기/펼치기 CSS 애니메이션 구현 방식

### 상태
**결정됨** (2026-04-19)

### 배경
`context-chart-section`의 접기/펼치기에 `display: none` 토글을 사용하면 CSS transition이 동작하지 않아 화면이 급격히 전환된다. 부드러운 UX를 위해 transition-compatible한 방식이 필요하다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A. `max-height` | 0 ↔ 임의 큰 값(예: 200px) 전환 | 구현 단순 | 실제 높이를 추정해야 하며, easing이 실제 콘텐츠 높이가 아닌 max-height 기준으로 적용되어 부자연스러움 |
| B. `grid-template-rows: 0fr / 1fr` | Grid 래퍼로 감싸고 내부 요소에 `overflow: hidden` | 실제 콘텐츠 높이 기준으로 정확하게 동작, easing 자연스러움 | 래퍼 div 1개 추가 필요 |
| C. `clip-path` | `inset(0 0 100% 0)` ↔ `inset(0)` | 레이아웃 공간을 유지한 채 시각적으로만 숨김 | 공간이 사라지지 않아 접힌 상태에서도 빈 공간이 남음 |

### 결정
**옵션 B — `grid-template-rows: 0fr / 1fr`** 방식 채택.

`context-chart-section` 바로 아래에 `.context-chart-inner` 래퍼를 두고, section에 `display: grid`와 `grid-template-rows` transition을 적용한다.

```css
.context-chart-section {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows 0.3s ease-in-out;
}
.context-chart-section--collapsed {
  grid-template-rows: 0fr;
}
.context-chart-inner {
  overflow: hidden;
}
```

### 이유
1. 실제 콘텐츠 높이에 맞춰 정확히 동작하므로 easing이 자연스럽다.
2. max-height처럼 임의 값을 추정할 필요가 없다.
3. clip-path와 달리 레이아웃 공간도 함께 사라져 접힌 상태가 명확하다.
4. 브라우저 지원 범위(Chrome 107+, Firefox 116+, Safari 16+)가 현재 대상 환경에 충분하다.

---

## ADR-002: 접기 범위 축소 — 탭바·컨트롤바·콘텐츠 항상 표시

### 상태
**결정됨** (2026-04-19)

### 배경
기존 `.detail-collapsed` 상태는 탭바, 컨트롤바, 콘텐츠까지 전부 숨겨 차트를 접으면 세션 내용 자체를 볼 수 없었다. 사용자가 차트 영역만 접고 나머지 기능은 계속 사용할 수 있어야 한다.

### 고려한 옵션

| 옵션 | 설명 |
|------|------|
| A. 현행 유지 | 탭바·컨트롤바·콘텐츠까지 전부 숨김 |
| B. chart-only 접기 | `context-chart-section`만 접고 나머지는 항상 표시 |

### 결정
**옵션 B** 채택. `.detail-collapsed` 규칙에서 `.view-tab-bar`, `.detail-controls-bar`, `.detail-loading`, `.detail-content` 숨김 선언을 제거한다. `context-chart-section` 접기는 별도 클래스(`.context-chart-section--collapsed`)로 관리한다.

### 이유
1. 차트는 보조 정보이며, 탭·목록은 주요 기능이다. 차트 접기가 주요 기능을 방해해서는 안 된다.
2. 토글 버튼의 의미가 "차트 접기"로 명확해진다.

---

## ADR-003: `context-chart.js` canvas display 토글과 충돌 방지

### 상태
**결정됨** (2026-04-19)

### 배경
`context-chart.js`의 `setEmptyState()` 함수는 `#contextGrowthChart` canvas와 `.context-chart-empty` 요소의 `display`를 직접 클래스로 토글한다. section 자체에 grid transition을 적용할 경우 충돌 여부를 검토해야 한다.

### 결정
충돌 없음 — 별도 처리 불필요.

`setEmptyState()`는 section 내부의 canvas 요소와 empty 상태 div만 조작하며, section 자체(`context-chart-section`)의 display/grid 속성에는 접근하지 않는다. grid-template-rows transition은 section 레벨에서만 동작하므로 두 메커니즘이 독립적으로 공존한다.
