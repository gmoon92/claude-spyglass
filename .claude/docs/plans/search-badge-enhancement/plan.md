# search-badge-enhancement 개발 계획

> Feature: search-badge-enhancement
> 작성일: 2026-04-19
> 작성자: Claude Code

## 목표

타입 필터 버튼의 색상 구분이 `defaultView`(최근 요청 피드)에만 적용되고, `detailView`(세션 상세 - 플랫/턴 뷰)에는 누락된 문제를 수정한다. 아울러 관련 CSS를 공통 파일(`badges.css`)로 이동하여 두 뷰에서 중복 없이 동일한 색상 시스템을 공유한다. 세션 상세 뷰에도 텍스트 검색 기능을 추가해 일관된 UX를 제공한다.

## 배경 / 원인

- `index.html`의 `#typeFilterBtns` 버튼들에는 `type-filter-prompt`, `type-filter-tool_call`, `type-filter-system` 색상 클래스가 있음
- `#detailTypeFilterBtns` 버튼들에는 위 클래스가 없어 색상 구분이 없음
- 색상 CSS 규칙이 `default-view.css`에만 있어 뷰 간 공유가 불명확

## 범위

**포함:**
- `#detailTypeFilterBtns` 버튼들에 `type-filter-prompt`, `type-filter-tool_call`, `type-filter-system` 클래스 추가 (HTML)
- 타입 필터 색상 CSS(`default-view.css` 79-85번 줄)를 `badges.css`로 이동
- 세션 상세 뷰(플랫/턴)에 텍스트 검색 인풋 추가 (`session-detail.js`)

**제외:**
- JS 공통 함수로 버튼 동적 생성 (불필요한 복잡도 증가)
- `data-filter` / `data-detail-filter` 속성 통합 (이벤트 구조 변경은 범위 외)
- 플랫/턴 뷰 외 기타 페이지

## 단계별 계획

### 1단계: CSS 이동 — `default-view.css` → `badges.css`

**수정 대상:** `packages/web/assets/css/default-view.css`

이동할 CSS 블록 (79-85번 줄):
```css
/* 타입별 색상 구분 (활성 + hover) */
.type-filter-prompt.active     { color: var(--type-prompt-color);    border-color: var(--type-prompt-color);    background: var(--type-prompt-bg); }
.type-filter-tool_call.active  { color: var(--type-tool_call-color); border-color: var(--type-tool_call-color); background: var(--type-tool_call-bg); }
.type-filter-system.active     { color: var(--type-system-color);    border-color: var(--type-system-color);    background: var(--type-system-bg); }
.type-filter-prompt:hover      { color: var(--type-prompt-color);    border-color: var(--type-prompt-color); }
.type-filter-tool_call:hover   { color: var(--type-tool_call-color); border-color: var(--type-tool_call-color); }
.type-filter-system:hover      { color: var(--type-system-color);    border-color: var(--type-system-color); }
```

이동 위치: `packages/web/assets/css/badges.css` 하단 (기존 배지 색상 토큰 블록 이후)

### 2단계: HTML 클래스 추가 — `#detailTypeFilterBtns`

**수정 대상:** `packages/web/index.html`

`#detailTypeFilterBtns` 내 버튼 3개에 색상 클래스 추가:

```html
<!-- 현재 (수정 전) -->
<button class="type-filter-btn" data-detail-filter="prompt">prompt</button>
<button class="type-filter-btn" data-detail-filter="tool_call">tool_call</button>
<button class="type-filter-btn" data-detail-filter="system">system</button>

<!-- 변경 후 -->
<button class="type-filter-btn type-filter-prompt" data-detail-filter="prompt">prompt</button>
<button class="type-filter-btn type-filter-tool_call" data-detail-filter="tool_call">tool_call</button>
<button class="type-filter-btn type-filter-system" data-detail-filter="system">system</button>
```

**주의:** `All` 버튼은 색상 클래스 추가하지 않음 (의도적으로 중립 색상 유지)

### 3단계: 세션 상세 뷰 텍스트 검색 기능 추가

**수정 대상:** `packages/web/index.html`, `packages/web/assets/js/session-detail.js`

**HTML 변경:**
`detailView`의 탭 바(`#detailTabBar`) 우측에 검색 인풋 추가:
```html
<div class="feed-search detail-search">
  <span class="feed-search-icon">⌕</span>
  <input id="detailSearchInput" class="feed-search-input" type="text"
         placeholder="tool / message" autocomplete="off" />
  <button class="feed-search-clear" id="detailSearchClear" aria-label="검색어 지우기">×</button>
</div>
```

배치 위치: `#detailTypeFilterBtns` 앞에 삽입 (탭 바 내 순서: 탭들 | 검색 | 필터)

**JS 변경 (`session-detail.js`):**
- `_detailSearchQuery` 상태 변수 추가
- `applyDetailFilter()` 내에서 검색어 필터 조건 추가 (플랫 뷰만; 턴 뷰는 검색 대상 아님)
- `initDetailSearch()` 함수 추가 — 이벤트 바인딩
- `loadSessionDetail()` 호출 시 검색어 초기화

```js
// 플랫 뷰 검색 필터 적용 패턴 (main.js의 applyFeedSearch() 참조)
function applyDetailSearch(rows, query) {
  rows.forEach(tr => {
    if (!query) { tr.style.display = ''; return; }
    const text = [
      tr.querySelector('.action-name')?.textContent,
      tr.querySelector('.prompt-preview')?.textContent,
      tr.querySelector('.target-role-badge')?.textContent,
    ].filter(Boolean).join(' ').toLowerCase();
    tr.style.display = text.includes(query) ? '' : 'none';
  });
}
```

## 완료 기준

- [ ] `detailView` 타입 필터 버튼이 `defaultView`와 동일한 색상 구분 동작
- [ ] 타입 필터 색상 CSS가 `badges.css`에 위치
- [ ] `default-view.css`에서 해당 블록 제거됨 (중복 없음)
- [ ] 세션 상세 뷰(플랫)에서 텍스트 검색 가능
- [ ] 세션 선택 시 검색어 초기화

## 디자이너 실수 방지 지침

### 절대 변경 금지
1. `data-filter` / `data-detail-filter` 속성 — 이벤트 핸들러가 이 속성으로 동작함
2. `#typeFilterBtns` / `#detailTypeFilterBtns` ID — main.js/session-detail.js가 직접 참조
3. `--type-prompt-color`, `--type-tool_call-color`, `--type-system-color` 토큰 값 — design-tokens.css SSoT

### CSS 작업 주의사항
- `.type-filter-btn` 기본 스타일(`default-view.css` 71-77번 줄)은 이동하지 말 것 — `default-view.css`에 유지
- `.type-filter-prompt`, `.type-filter-tool_call`, `.type-filter-system` 색상 규칙만 `badges.css`로 이동
- 이동 후 `default-view.css`의 주석(`/* 타입별 색상 구분 (활성 + hover) */`)도 함께 삭제

### HTML 작업 주의사항
- `All` 버튼(`data-detail-filter="all"`)에는 색상 클래스 추가하지 말 것
- `type-filter-tool_call` 클래스명에 언더스코어(`_`) 포함 — 오타 주의
- 세션 상세 검색 인풋 ID는 반드시 `detailSearchInput` (main.js의 `feedSearchInput`과 구분)

### JS 작업 주의사항
- `applyDetailFilter()` 내 검색 필터는 플랫 뷰 행(`#detailRequestsBody tr`)에만 적용
- 턴 뷰(`#turnListBody`)는 검색 대상 아님
- `makeRequestRow()`, `typeBadge()` 등 기존 렌더링 함수는 수정하지 말 것
- 검색 로직은 `session-detail.js` 내에 배치 (새 파일 생성 불필요)
