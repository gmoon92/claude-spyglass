# left-panel-collapse ADR (재작업)

## ADR-001: IDE 스타일 전체 패널 숨김 vs 섹션별 토글 (대체됨)

### 상태
**대체됨** (2026-04-20)

### 배경
초기 요구사항 해석이 잘못되어, 3개 섹션을 각각 접는 기능으로 구현함.
사용자의 정확한 요구사항: **전체 왼쪽 패널을 좌우로 접어서 완전히 숨기는 기능** (IDE 사이드바 패턴)

### 이전 결정
- 옵션 D: 섹션별 토글 (`.left-panel`을 flex로 변환 후 각 섹션의 flex basis 설정)
- 섹션별 토글 버튼 3개 추가
- localStorage에 `left-panel-state` JSON 객체로 3개 섹션 상태 저장

### 취소 사유
1. **요구사항 오해**: 섹션별이 아닌 전체 패널 토글이 필요함
2. **구현 롤백 필요**: HTML/CSS/JS의 섹션별 토글 코드 전부 제거
3. **새로운 설계**: 토글 버튼 1개, localStorage 키 1개로 단순화

---

## ADR-001: 왼쪽 패널 전체 숨김 메커니즘

### 상태
**결정됨** (2026-04-20)

### 배경
사용자가 필요에 따라 왼쪽 패널 전체를 숨기고 오른쪽 메인 컨텐츠 영역을 최대한 활용할 수 있어야 함.
현재 레이아웃: `.main-layout { display: grid; grid-template-columns: var(--left-panel-width) 1fr; }`

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A: grid-template-columns 동적 변경 | 숨김: `1fr`, 펼침: `var(--left-panel-width) 1fr` | 표준적. 다른 레이아웃 변경 없음 | CSS 클래스 토글로 제어 필요 |
| B: .left-panel에 display:none | 숨김: `.left-panel { display: none; }`, grid는 유지 | 간단함 | grid-template-columns 여전히 2열인데 첫 열 비어있음 (비효율) |
| C: transform: translateX | 숨김: `translate(-100%)`, 스크롤 가능 | 애니메이션 부드러움 | 패널 영역이 DOM에 남아 마우스 이벤트 가로챌 수 있음 |
| D: position absolute + 오버레이 | 패널을 absolute로 변경, 숨김 시 left:-100% | 모바일 친화적. 오버레이 패턴 | desktop 데스크톱에서 불필요한 복잡성 |

### 결정
**옵션 A: grid-template-columns 동적 변경 + .left-panel-hidden 클래스 토글**

### 이유
1. **표준 패턴**: IDE(VS Code, WebStorm 등)의 사이드바 토글 방식과 동일
2. **효율성**: 숨겨진 상태에서 오른쪽 패널이 전체 너비 차지
3. **간결성**: CSS 클래스 하나로 제어 가능
4. **레이아웃 안정성**: grid 구조 유지, 다른 모듈과 충돌 없음

### 구현 방식

**CSS (layout.css)**
```css
.main-layout {
  display: grid;
  grid-template-columns: var(--left-panel-width) 1fr;
}

.main-layout.left-panel-hidden {
  grid-template-columns: 1fr;
}

.main-layout.left-panel-hidden .left-panel {
  display: none;
}
```

**HTML (index.html .header-left에 추가)**
```html
<button class="btn-panel-collapse" id="btnPanelCollapse" 
        title="왼쪽 패널 숨기기" aria-label="왼쪽 패널 숨기기">
  <svg>...</svg>
</button>
```

**JavaScript (main.js)**
```javascript
function toggleLeftPanel() {
  const mainLayout = document.querySelector('.main-layout');
  mainLayout.classList.toggle('left-panel-hidden');
  savePanelHiddenState(mainLayout.classList.contains('left-panel-hidden'));
}

function savePanelHiddenState(isHidden) {
  localStorage.setItem('left-panel-hidden', JSON.stringify(isHidden));
}

function restorePanelHiddenState() {
  const isHidden = JSON.parse(localStorage.getItem('left-panel-hidden') || 'false');
  const mainLayout = document.querySelector('.main-layout');
  if (isHidden) {
    mainLayout.classList.add('left-panel-hidden');
  }
}

// 초기화 (페이지 로드 시)
restorePanelHiddenState();
document.getElementById('btnPanelCollapse').addEventListener('click', toggleLeftPanel);
```

---

## ADR-002: 토글 버튼 배치 위치

### 상태
**결정됨** (2026-04-20)

### 배경
토글 버튼이 `.left-panel` 안에 있으면, 패널을 숨겼을 때 버튼에 접근 불가능.
다시 펼치는 방법이 없어지는 UX 문제 발생.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A: .header 왼쪽 끝 (.header-left 내부) | 항상 보임. IDE 표준 패턴 | 항상 접근 가능. 다시 펼칠 수 있음. 가장 일반적 | 헤더가 약간 복잡해짐 |
| B: .right-panel 최상단 왼쪽 | 오른쪽 패널에 통합 | 오른쪽 컨텐츠와 함께 제어 | 헤더와 분리되어 UI 불일치 |
| C: 숨겨진 상태에서만 보이는 플로팅 버튼 | 숨김: floating 우측 하단, 펼침: 헤더 왼쪽 | 세련됨. 숨겨진 상태 강조 | 구현 복잡. 두 위치에 버튼 유지 필요 |

### 결정
**옵션 A: .header-left 내부에 배치**

### 이유
1. **접근성**: 항상 버튼이 보이므로 다시 펼칠 수 있음
2. **표준성**: VS Code, WebStorm 등 IDE의 사이드바 토글 버튼 위치와 동일
3. **일관성**: 헤더에 통합되어 다른 컨트롤(로고, 필터)과 함께 배치
4. **구현 단순**: 기존 헤더 구조에 버튼 추가만으로 충분

### 구현 위치
```html
<div class="header-left">
  <div class="logo">Claude<span>Spyglass</span></div>
  <button class="btn-panel-collapse" id="btnPanelCollapse" ...></button>
  <!-- 기타 헤더 요소 -->
</div>
```

---

## ADR-003: 토글 버튼 아이콘 스타일

### 상태
**결정됨** (2026-04-20)

### 배경
사용자가 버튼의 현재 상태(패널 열림/닫힘)를 시각적으로 인식해야 함.
아이콘이 상태에 따라 변해야 명확함.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A: 햄버거 메뉴 아이콘 (≡) | 숨김: 그대로, 펼침: 다른 아이콘 | 친숙함. 모바일 표준 | 좌우 패널 토글 의도 명확하지 않음 |
| B: 좌우 화살표 (‹ › 또는 ‹‹ ››) | 왼쪽 화살표: 패널 숨김, 오른쪽 화살표: 패널 펼침 | 방향성 명확. 상태 일치 | 회전 애니메이션보다 2개 아이콘 필요 |
| C: 세로 막대 + 화살표 (┃‹ / ┃›) | 왼쪽 막대: 패널 경계, 화살표: 방향 | IDE 스타일. 명확함 | SVG 약간 복잡 |
| D: Chevron left/right (‹ › 회전) | 펼침: ›, 숨김: ‹ (회전 또는 아이콘 변경) | 간단. 최소 SVG | 상태 변화가 눈에 띄지 않을 수 있음 |

### 결정
**옵션 C: 세로 막대 + 화살표 조합 (IDE 스타일)**

### 이유
1. **명확성**: 세로 막대로 패널 경계를 나타내고, 화살표로 펼침/숨김 상태 표현
2. **표준성**: VS Code, WebStorm의 사이드바 토글 아이콘과 유사
3. **시각적 피드백**: 아이콘이 변해서 상태 변화를 명확히 나타냄
4. **일관성**: 현재 detail-view의 화살표(`<` 방향) 패턴과 유사

### 구현 방식

```html
<!-- 펼침 상태 (패널 보임) -->
<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
  <path d="M2 2 L2 12" stroke="currentColor" stroke-width="1.5"/>
  <path d="M5 7 L2 10 L5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>

<!-- 숨김 상태 (패널 숨겨짐) -->
<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
  <path d="M2 2 L2 12" stroke="currentColor" stroke-width="1.5"/>
  <path d="M5 7 L2 4 L5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>
```

또는 CSS `transform: rotate()`으로 단일 SVG 회전 제어 가능.

---

## ADR-004: 토글 상태 저장소 및 키 네이밍

### 상태
**결정됨** (2026-04-20)

### 배경
사용자가 패널을 숨긴 후 페이지를 새로고침했을 때도 숨김 상태가 유지되어야 함.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A: localStorage boolean 문자열 | `localStorage.setItem('left-panel-hidden', 'true')` | 간단함. 직관적 | 타입 변환 필요 |
| B: localStorage JSON boolean | `localStorage.setItem('left-panel-hidden', JSON.stringify(true))` | 명확함. 확장성 있음 | 약간의 파싱 오버헤드 |
| C: sessionStorage | 탭/윈도우 닫으면 초기화 | 임시 상태에 적합 | 사용자 선호도 미반영 (문제) |
| D: IndexedDB | 복잡한 상태 저장 | 대용량 데이터 가능 | 오버엔지니어링 |

### 결정
**옵션 B: localStorage + JSON.stringify/parse, 키명: `left-panel-hidden`**

### 이유
1. **간결성**: 단일 boolean 값만 저장
2. **확장성**: 향후 구조 확장 필요 시 JSON 객체로 전환 용이
3. **표준성**: 다른 UI 상태 저장과 일관성 유지
4. **영속성**: localStorage는 브라우저 재시작 후에도 유지됨

### 구현 방식

```javascript
const PANEL_HIDDEN_KEY = 'left-panel-hidden';

function savePanelHiddenState(isHidden) {
  localStorage.setItem(PANEL_HIDDEN_KEY, JSON.stringify(isHidden));
}

function restorePanelHiddenState() {
  const isHidden = JSON.parse(localStorage.getItem(PANEL_HIDDEN_KEY) || 'false');
  return isHidden;
}
```

---

## ADR-005: Resize Handle과 토글 상태의 상호작용

### 상태
**결정됨** (2026-04-20)

### 배경
`.panel-resize-handle`은 현재 `.left-panel`의 오른쪽 가장자리에 위치.
패널을 숨길 때 resize handle도 함께 숨겨져야 하며, 그렇지 않으면:
1. 사용자가 실수로 resize를 시도할 수 있음
2. 오른쪽 패널 콘텐츠와 겹칠 수 있음

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A: resize handle도 display:none | 패널 숨김 시 자동 숨겨짐 | 간단함. CSS로 충분 | 특별한 로직 불필요 |
| B: resize handle은 보임, 비활성화 | 시각적 표시 유지, pointer-events:none | 패널 상태 표시 가능 | 불필요한 UI 요소 |
| C: JavaScript에서 명시적 제어 | toggle 함수에서 handle의 visibility 제어 | 명확한 의도 | 코드 증가 |

### 결정
**옵션 A: CSS로 자동 처리 (`.main-layout.left-panel-hidden .panel-resize-handle { display: none; }`)**

### 이유
1. **간결성**: CSS 추가 규칙으로 충분
2. **자동성**: JavaScript 로직 추가 없음
3. **일관성**: `.left-panel` 전체를 숨기므로 handle도 자동 숨겨짐

### 구현 방식

```css
.main-layout.left-panel-hidden .panel-resize-handle {
  display: none;
}
```

---

## 최종 정리

| 항목 | 결정 |
|------|------|
| 토글 범위 | 전체 왼쪽 패널 (섹션별 아님) |
| 메커니즘 | grid-template-columns 동적 변경 + .left-panel-hidden 클래스 |
| 버튼 위치 | .header-left 내부 |
| 버튼 아이콘 | 세로 막대 + 화살표 (상태에 따라 변함) |
| 저장소 | localStorage, 키: left-panel-hidden, 값: JSON boolean |
| Resize handle | 패널 숨김 시 함께 display:none |
| 이전 구현 | 섹션별 토글 코드 완전 롤백 |
