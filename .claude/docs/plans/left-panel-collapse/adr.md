# left-panel-collapse ADR

## ADR-001: Flex 레이아웃으로 변환하여 collapse 구현 (수정됨)

### 상태
**결정됨** (2026-04-20, **재검토 2026-04-20**)

### 배경
초기 결정(옵션 C)에서 `.left-panel`이 `display: grid`였고 `grid-template-rows: 215px 1fr 160px`로 고정되어 있었음. Grid children에 적용한 `flex: 0 0 auto` 속성은 **flex 속성이므로 grid 컨텍스트에서 무시됨**. 결과적으로:
- 접힌 섹션의 grid row가 여전히 원래 높이 유지 (215px 또는 160px)
- 빈 공간만 남아 접기 기능이 무용지물

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A: grid-rows auto로 변경 | CSS에서 `grid-template-rows: auto 1fr auto`로 고정 | 간단함. 접기/펼치기가 자동으로 작동 | 마지막 row가 콘텐츠 크기로 가변되어 UX 일관성 감소 |
| B: JS에서 CSS 변수 제어 | 접힘 상태에 따라 JS에서 `--project-panel-height` 등을 동적으로 갱신 | 정확한 높이 제어. 기존 변수 활용 가능 | 복잡함. 상태 관리 필요. panel-resize.js와 충돌 위험 |
| C (초기): Grid children에 flex 속성 | `.panel-section--collapsed { flex: 0 0 auto; }` 추가 | **실제로는 작동하지 않음** (flex 속성은 grid 자식에 무시됨) | **채택 불가** |
| D (최종): `.left-panel`을 flex로 변환 | `display: flex; flex-direction: column` + 각 섹션에 `flex: 0 0 [고정값]` 또는 `flex: 1 1 0` | **Flex 속성이 정상 작동**. 간단하고 명확함. 다른 모듈과 충돌 없음 | 초기 설계 변경 필요 |

### 최종 결정
**옵션 D: `.left-panel`을 `display: flex`로 변환하고 각 섹션의 flex basis 설정**

### 변경 사항
1. `.left-panel`: `display: grid` → `display: flex; flex-direction: column`
2. `grid-template-rows` 제거
3. 각 섹션의 flex basis 설정:
   - `#panelProjects`: `flex: 0 0 var(--project-panel-height)` (215px 고정)
   - `#panelSessions`: `flex: 1 1 0` (남은 공간 모두 차지)
   - `#panelTools`: `flex: 0 0 var(--tool-stats-height)` (160px 고정)
4. `.panel-section--collapsed`: `flex: 0 0 auto` (이제 정상 작동 → 헤더 높이만 차지)

### 이유
1. **정확한 동작**: Flex 속성이 grid가 아닌 flex children에서 정상 작동
2. **간결성**: 초기 결정보다 구현이 더 단순함
3. **확장성**: 향후 섹션 추가 시 flex basis 추가만으로 충분
4. **호환성**: `panel-resize.js`는 너비만 제어하므로 충돌 없음

### 구현 방식
```css
.left-panel {
  display: flex; flex-direction: column;
  overflow: hidden;
}
#panelProjects { flex: 0 0 var(--project-panel-height); }
#panelSessions { flex: 1 1 0; }
#panelTools { flex: 0 0 var(--tool-stats-height); }
.panel-section--collapsed { flex: 0 0 auto; }
```

---

## ADR-002: 토글 버튼 위치 및 마크업

### 상태
**결정됨** (2026-04-20)

### 배경
3개 섹션 중:
- 프로젝트: `<span class="panel-hint">클릭하여 세션 조회</span>` → 제거 예정
- 세션: `<span class="panel-hint" id="sessionPaneHint">프로젝트를 선택하세요</span>` → 동적 상태 텍스트 (유지 필수)
- 툴 통계: `<span class="panel-hint" id="toolCount">—</span>` → 동적 카운트 (유지 필수)

요구사항은 "hint가 있으면 hint 옆에, 없으면 단독" 배치.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A: 항상 hint 제거, 토글 버튼만 배치 | `.panel-hint` 삭제 후 `<button class="btn-panel-toggle">` 추가 | 간단함. 모든 섹션 일관됨 | 세션·툴 통계의 동적 상태 텍스트 손실 (요구사항 위반) |
| B: hint 유지, 토글 버튼을 flex 오른쪽에 배치 | `<div class="panel-header-right"><span class="panel-hint">...</span><button>...</button></div>` 구조 | 동적 텍스트 유지. 요구사항 충족 | 마크업 변경 범위 커짐 |
| C: hint는 있는 곳만 유지, 없는 곳(프로젝트)만 버튼 추가 | 프로젝트 hint만 제거, 토글 버튼 추가. 다른 2개는 hint 옆에 버튼 추가 | 최소 변경. 유지보수 용이 | 3개 섹션의 마크업 구조가 약간 다름 |

### 결정
**옵션 B: flex 레이아웃으로 hint와 토글 버튼을 오른쪽 영역에 배치**

### 이유
1. **일관성**: 모든 섹션의 마크업 구조가 동일
2. **요구사항 충족**: 동적 텍스트 유지 + 토글 버튼 배치
3. **유연성**: 향후 헤더에 추가 요소가 필요할 때 확장 가능
4. **레이아웃 안정성**: flexbox `justify-content: space-between`으로 간단하게 정렬

### 구현 방식
```html
<div class="panel-header">
  <span class="panel-label">프로젝트</span>
  <div class="panel-header-right">
    <span class="panel-hint">클릭하여 세션 조회</span> <!-- 또는 없음 -->
    <button class="btn-panel-toggle" aria-label="접기">...</button>
  </div>
</div>
```

---

## ADR-003: 토글 버튼 스타일 및 인터랙션

### 상태
**결정됨** (2026-04-20)

### 배경
이미 존재하는 detail-view의 `.btn-toggle` 스타일(lines 15-31)을 참고하여 왼쪽 패널용 토글 버튼도 동일 UX 패턴을 적용할 것 (화살표 회전, hover 액센트 컬러).

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A: detail-view의 `.btn-toggle` 클래스 재사용 | 같은 클래스 이름 사용 | 코드 중복 없음 | 의미가 명확하지 않을 수 있음 (좌측 vs 우측 패널) |
| B: `.btn-panel-toggle` 새 클래스 생성 | 왼쪽 패널 전용 클래스 이름 | 명확한 의도. 향후 커스터마이제이션 용이 | 스타일 약간 중복 |
| C: CSS 변수로 공통 스타일 추상화 | `.btn-toggle-base` + `--btn-toggle-icon-size` 등 | 최대 재사용성 | 오버엔지니어링 위험 |

### 결정
**옵션 B: `.btn-panel-toggle` 새 클래스 이름 사용, detail-view의 스타일 패턴 모방**

### 이유
1. **명확성**: left-panel 컨텍스트에서 역할이 명확함
2. **유지보수**: 향후 left-panel 토글과 detail-view 토글의 스타일을 다르게 조정할 필요가 생길 때 독립적 수정 가능
3. **코드 의도**: 같은 패턴이지만 다른 클래스명으로 의도를 명시

### 구현 방식
- CSS: left-panel.css에 `.btn-panel-toggle` 추가 (detail-view.css의 `.btn-toggle` 스타일 참조)
- SVG: 같은 `<` 화살표 (또는 `˅` 느낌의 회전)
- 상태: `.panel-section--collapsed`일 때 `transform: rotate(180deg)`

---

## ADR-004: localStorage 키 네이밍 및 상태 포맷

### 상태
**결정됨** (2026-04-20)

### 배경
3개 섹션의 접힘 상태를 localStorage에 저장하여 페이지 새로고침 후에도 유지해야 함.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A: 개별 키 3개 | `left-panel-collapsed-projects`, `-sessions`, `-tools` (JSON: `{collapsed: true/false}`) | 섹션별 독립 제어 가능 | localStorage 키 3개 필요 |
| B: 단일 JSON 객체 | `left-panel-state` (JSON: `{projects: boolean, sessions: boolean, tools: boolean}`) | 한 번에 로드/저장. 관리 간단 | 부분 업데이트 시 전체 객체 파싱 필요 |
| C: 비트 플래그 | `left-panel-collapsed` (숫자: 0b101 = projects, tools 접힘) | 공간 효율적 | 디버깅 어려움. 가독성 낮음 |

### 결정
**옵션 B: 단일 JSON 객체 `left-panel-state`에 3개 섹션 상태 포함**

### 이유
1. **관리 간편**: 한 번의 localStorage 쿼리로 모든 상태 로드
2. **확장성**: 향후 새 섹션 추가 시 객체 키만 추가하면 됨
3. **성능**: 개별 키 3개보다 단일 파싱이 효율적

### 구현 방식
```javascript
// 저장
const state = {
  projects: false,  // collapsed 여부
  sessions: false,
  tools: true       // 예: 툴 통계 접혀있음
};
localStorage.setItem('left-panel-state', JSON.stringify(state));

// 로드
const state = JSON.parse(localStorage.getItem('left-panel-state') || '{}');
```
