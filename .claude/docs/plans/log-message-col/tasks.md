# Log Message Column — 원자성 작업 목록

> 작성일: 2026-04-18  
> 기반 문서: plan.md, adr.md

---

## 의존성 그래프

```
T-01 (상수/colspan)
  └─ T-02 (colgroup/thead)
       └─ T-03 (CSS)
            └─ T-04 (contextPreview 분리)
                 └─ T-05 (makeRequestRow)
                      └─ T-06 (확장 패널)
                           └─ T-07 (dead code 제거)
```

---

## T-01: FLAT_VIEW_COLS / RECENT_REQ_COLS 상수 및 colspan 갱신

**커밋 타입**: `refactor(web)`  
**선행 조건**: 없음  
**변경 파일**: `packages/web/index.html`

### 변경 내용

```javascript
// 상수 변경
const FLAT_VIEW_COLS  = 6;  // 5 → 6
const RECENT_REQ_COLS = 7;  // 6 → 7
```

하드코딩 직접 수정 (상수 미참조):
- 최근 요청 스켈레톤 행 3줄: `colspan="6"` → `colspan="7"`
- 플랫뷰 초기 빈 상태: `colspan="5"` → `colspan="6"`

### 완료 기준

```bash
grep -n 'colspan' packages/web/index.html
# 하드코딩 행 확인 — 모두 새 컬럼 수와 일치
grep -n 'FLAT_VIEW_COLS\|RECENT_REQ_COLS' packages/web/index.html
# 상수 값이 6, 7로 변경됨
```

---

## T-02: colgroup 및 thead 메시지 컬럼 삽입

**커밋 타입**: `feat(web)`  
**선행 조건**: T-01  
**변경 파일**: `packages/web/index.html`

### 변경 내용

최근 요청 테이블 colgroup:
```html
<colgroup>
  <col style="width:130px">  <!-- 시각 -->
  <col style="width:140px">  <!-- 행위 (auto → 140px 고정) -->
  <col>                       <!-- 메시지 (나머지 공간) -->
  <col style="width:58px"><col style="width:58px"><col style="width:72px"><col style="width:96px">
</colgroup>
```

최근 요청 테이블 thead:
```html
<tr><th>시각</th><th>행위</th><th>메시지</th><th style="text-align:right">입력</th>...</tr>
```

플랫뷰 colgroup:
```html
<colgroup>
  <col style="width:130px">
  <col style="width:140px">
  <col>
  <col style="width:58px"><col style="width:58px"><col style="width:72px">
</colgroup>
```

플랫뷰 thead:
```html
<tr><th>시각</th><th>행위</th><th>메시지</th><th style="text-align:right">입력</th>...</tr>
```

### 완료 기준

```bash
grep -n 'width:140px\|메시지' packages/web/index.html
# 두 테이블 모두에서 각각 1개씩 발견
```

---

## T-03: CSS — cell-msg, cell-action 정리, 확장 패널 개선

**커밋 타입**: `feat(web)`  
**선행 조건**: T-02  
**변경 파일**: `packages/web/index.html`

### 변경 내용

추가 CSS:
```css
/* ─── MESSAGE CELL ────────────────────────────────────────────── */
td.cell-msg {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  cursor: pointer;
}
td.cell-msg .prompt-preview {
  max-width: none;
  display: inline;
}
.cell-msg-empty { color: var(--text-dim); cursor: default; }

/* tool_call 메시지: monospace 폰트 */
tr[data-type="tool_call"] td.cell-msg .prompt-preview {
  font-family: monospace; font-size: 11px;
}

/* ─── EXPAND BOX 개선 ─────────────────────────────────────────── */
```

기존 `.prompt-expand-box`에 추가:
```css
.prompt-expand-box { max-height: 400px; overflow-y: auto; }
```

복사 버튼:
```css
.expand-copy-btn {
  float: right; background: none; border: 1px solid var(--border);
  color: var(--text-dim); padding: 2px 8px; border-radius: 4px;
  cursor: pointer; font-size: 10px; font-family: inherit;
}
.expand-copy-btn:hover { color: var(--text); }
```

제거 CSS:
- `.action-preview` 및 `.action-preview .prompt-preview` 규칙

`cell-action` 수정:
```css
/* display:flex는 배지 정렬 목적으로 유지, flex:1 자식 제거됨 */
.cell-action { display: flex; align-items: center; overflow: hidden; }
```

### 완료 기준

```bash
grep -n 'cell-msg\|expand-copy-btn\|action-preview' packages/web/index.html
# cell-msg CSS 존재, action-preview CSS 없음
```

---

## T-04: contextPreview() — displayText/cacheText 분리

**커밋 타입**: `refactor(web)`  
**선행 조건**: T-03  
**변경 파일**: `packages/web/index.html`

### 변경 내용

```javascript
function contextPreview(r, maxLen = 50) {
  const rawText = getContextText(r);
  if (!rawText) return '';
  if (_promptCache.size >= PROMPT_CACHE_MAX) {
    _promptCache.delete(_promptCache.keys().next().value);
  }
  _promptCache.set(r.id, rawText);  // 항상 raw 저장 (확장용)

  // 미리보기: tool_call은 파싱 결과, 나머지는 raw
  const displayText = r.type === 'tool_call'
    ? (parseToolDetail(rawText) ?? rawText)
    : rawText;

  const flat    = displayText.replace(/\n/g, ' ');
  const display = flat.slice(0, maxLen);
  const tooltip = rawText.length > 200
    ? rawText.slice(0, 200) + `… (총 ${rawText.length.toLocaleString('ko-KR')}자)`
    : rawText;
  return `<span class="prompt-preview" data-expand-id="${escHtml(r.id)}" title="${escHtml(tooltip)}">${escHtml(display)}${flat.length > maxLen ? '…' : ''}</span>`;
}
```

### 완료 기준

```
미리보기: tool_call → parseToolDetail 결과 표시
확장 시: raw tool_detail 전체 표시
```

---

## T-05: makeRequestRow() — 메시지 TD 추가, action-preview 제거

**커밋 타입**: `feat(web)`  
**선행 조건**: T-04  
**변경 파일**: `packages/web/index.html`

### 변경 내용

```javascript
function makeRequestRow(r, opts = {}) {
  const fmtTs = opts.fmtTime || fmtTimestamp;
  const sessTd = opts.showSession
    ? `<td class="cell-sess">...</td>`
    : '';
  const msgPreview = contextPreview(r, 60);
  const msgHtml = msgPreview
    ? msgPreview
    : `<span class="cell-msg-empty" aria-label="메시지 없음">—</span>`;

  return `<tr data-type="${escHtml(r.type||'')}">
    <td class="cell-time num">${fmtTs(r.timestamp)}</td>
    <td class="cell-action">${makeActionCell(r)}</td>
    <td class="cell-msg">${msgHtml}</td>
    <td class="cell-token num">...</td>
    <td class="cell-token num">...</td>
    <td class="cell-token num">...</td>
    ${sessTd}
  </tr>`;
}
```

(action-preview span 제거, cell-msg TD 추가)

### 완료 기준

```bash
grep -n 'action-preview' packages/web/index.html
# JS 호출부에서 action-preview 없음
grep -n 'cell-msg' packages/web/index.html
# makeRequestRow에서 사용됨
```

---

## T-06: togglePromptExpand — 복사 버튼 삽입

**커밋 타입**: `feat(web)`  
**선행 조건**: T-05  
**변경 파일**: `packages/web/index.html`

### 변경 내용

```javascript
function togglePromptExpand(rid, tr, cols) {
  document.querySelectorAll('[data-expand-for]').forEach(el => el.remove());
  if (tr.dataset.expanded === rid) { delete tr.dataset.expanded; return; }
  tr.dataset.expanded = rid;
  const text = _promptCache.get(rid) || '';
  const lengthHint = text.length > 500
    ? `\n─── 총 ${text.length.toLocaleString('ko-KR')}자 ───`
    : '';
  const fullDisplay = text + lengthHint;
  const colCount = cols
    ?? tr.closest('table')?.querySelector('thead tr')?.children?.length
    ?? FLAT_VIEW_COLS;
  const expandTr = document.createElement('tr');
  expandTr.dataset.expandFor = rid;
  expandTr.className = 'prompt-expand-row';
  expandTr.innerHTML = `<td colspan="${colCount}">
    <div class="prompt-expand-box">
      <button class="expand-copy-btn" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('pre').textContent)">복사</button>
      <pre>${escHtml(fullDisplay)}</pre>
    </div>
  </td>`;
  tr.after(expandTr);
}
```

### 완료 기준

```
클릭 확장 시 복사 버튼 표시
복사 버튼 클릭 시 전체 텍스트 클립보드 복사
max-height:400px 적용으로 대형 payload 시 스크롤
```

---

## T-07: promptPreview() dead code 제거

**커밋 타입**: `refactor(web)`  
**선행 조건**: T-06  
**변경 파일**: `packages/web/index.html`

### 변경 내용

`promptPreview()` 함수 정의 전체 제거.
(호출부 없음 — 이미 `contextPreview()`로 교체됨)

### 완료 기준

```bash
grep -n 'promptPreview' packages/web/index.html
# 함수 정의 없음, 호출 없음
```

---

## 예상 커밋 순서

| # | 타입 | 설명 |
|---|------|------|
| T-01 | refactor | 상수/colspan 갱신 |
| T-02 | feat | colgroup/thead 메시지 컬럼 삽입 |
| T-03 | feat | cell-msg CSS, 확장 패널 개선 CSS |
| T-04 | refactor | contextPreview displayText/cacheText 분리 |
| T-05 | feat | makeRequestRow 메시지 TD 추가 |
| T-06 | feat | togglePromptExpand 복사 버튼 |
| T-07 | refactor | promptPreview dead code 제거 |
