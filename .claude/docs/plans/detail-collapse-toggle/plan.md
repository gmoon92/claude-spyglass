# detail-collapse-toggle 개발 계획

> Feature: detail-collapse-toggle
> 작성일: 2026-04-19
> 작성자: Claude Code

## 목표

detailView의 접기/펼치기 기능을 재설계합니다. 현재 단일 "접기" 버튼은 실제로 `closeDetail()`을 호출하여 defaultView로 전환하는 **닫기** 기능만 수행합니다. 진짜 접기(detail-header만 남기고 콘텐츠 숨김)와 닫기를 분리하여 구현합니다.

## 범위

### 포함
- HTML: `.btn-close` 단일 버튼 → `.detail-actions` 버튼 그룹(접기 토글 + 닫기) 교체
- CSS: `.detail-collapsed` 상태 정의, 접기/펼치기 아이콘 rotate 애니메이션, 버튼 그룹 스타일
- JS: `toggleDetailCollapse()` 함수 추가, 접힌 헤더 클릭 시 펼치기
- screen-inventory.md 화면 2-0 섹션 현행화

### 제외
- DB/서버 API 변경 없음
- 기존 `closeDetail()` 함수 로직 변경 없음
- 접기 상태의 localStorage 저장 (이번 범위 아님)

## 현황

| 위치 | 현재 상태 |
|------|-----------|
| `index.html:281` | `<button class="btn-close" id="btnCloseDetail">&#x2039; 접기</button>` 단일 버튼 |
| `detail-view.css` | `.btn-close` 스타일만 존재, collapsed 상태 없음 |
| `main.js:135` | `closeDetail()` — `uiState.rightView = 'default'`로 전환 |
| `main.js:255` | `btnCloseDetail` → `closeDetail` 바인딩 |

## 단계별 계획

### 1단계: HTML 재설계 (`index.html`)

현재 단일 버튼을 버튼 그룹으로 교체합니다.

```html
<!-- 변경 전 -->
<button class="btn-close" id="btnCloseDetail">&#x2039; 접기</button>

<!-- 변경 후 -->
<div class="detail-actions">
  <button class="btn-toggle" id="btnToggleDetail" title="접기 / 펼치기" aria-label="접기">
    <span class="btn-toggle-icon">⌃</span>
  </button>
  <button class="btn-close" id="btnCloseDetail" title="세션 목록으로 닫기" aria-label="닫기">
    ✕
  </button>
</div>
```

### 2단계: CSS 구현 (`detail-view.css`)

- `.detail-actions`: 버튼 그룹 flex 컨테이너 (gap, align-items)
- `.btn-toggle`: 아이콘 전용 원형/사각 버튼, rotate transition
- `.btn-close` 재설계: 텍스트 제거, 아이콘 전용 닫기 버튼
- `.detail-collapsed` 상태:
  - `.context-chart-section`, `.view-tab-bar`, `.detail-controls-bar`, `.detail-content`, `.detail-loading` → `display: none`
  - `.detail-header` → `cursor: pointer` (클릭 유도)
  - `.btn-toggle-icon` → `transform: rotate(180deg)` (펼치기 방향)

### 3단계: JS 구현 (`main.js`)

```js
// 접기/펼치기 토글
function toggleDetailCollapse() {
  const detailView = document.getElementById('detailView');
  const btn = document.getElementById('btnToggleDetail');
  detailView.classList.toggle('detail-collapsed');
  const collapsed = detailView.classList.contains('detail-collapsed');
  btn.setAttribute('aria-label', collapsed ? '펼치기' : '접기');
}
```

이벤트 바인딩:
- `#btnToggleDetail` click → `toggleDetailCollapse()`
- `.detail-header` click (접힌 상태) → `toggleDetailCollapse()` (이벤트 위임)

### 4단계: screen-inventory.md 현행화

화면 2-0 헤더 테이블, 변경 이력 업데이트.

## 완료 기준

- [ ] 접기 버튼 클릭 시 context-chart, tab-bar, controls-bar, detail-content 숨김
- [ ] 접힌 상태에서 세션 ID·프로젝트명 보임
- [ ] 펼치기: 토글 버튼 재클릭 또는 헤더 클릭으로 복원
- [ ] 닫기 버튼은 별도 존재, `closeDetail()` 정상 호출
- [ ] CSS 변수만 사용 (하드코딩 색상 없음)
- [ ] 인라인 스타일 없음
- [ ] screen-inventory.md 현행화 완료
