# Log Message Column Architecture Decision Records

> 작성일: 2026-04-18  
> 참여 전문가: 소프트웨어 아키텍트, 프론트엔드 엔지니어, UI/UX 전문가

---

## ADR-008: 메시지 컬럼 추가 — 너비 배분

### 상태
**결정됨** (2026-04-18)

### 배경

행위(Action) 컬럼과 입력(tokens_input) 컬럼 사이에 메시지 컬럼을 추가한다.
행위 컬럼이 현재 `auto`이므로, 두 컬럼 모두 `auto`이면 50:50으로 공간이 분할되어
메시지 컬럼이 충분한 너비를 얻지 못한다.

### 고려한 옵션

| 옵션 | 행위 | 메시지 | 설명 |
|------|------|--------|------|
| A (채택) | 140px 고정 | auto | 메시지가 나머지 공간 전체 차지 |
| B | auto | auto | 50:50 균등 분할 |
| C | 160px 고정 | min 200px, flex | 최소 너비 보장 |

### 결정

```html
<colgroup>
  <col style="width:130px">  <!-- 시각 -->
  <col style="width:140px">  <!-- 행위 -->
  <col>                       <!-- 메시지 (나머지 공간) -->
  <col style="width:58px">   <!-- 입력 -->
  <col style="width:58px">   <!-- 출력 -->
  <col style="width:72px">   <!-- 응답시간 -->
  <col style="width:96px">   <!-- 세션 (최근 요청만) -->
</colgroup>
```

### 이유

1. 행위 셀 콘텐츠(배지 ~30px + 아이콘 ~14px + 툴명 최대 ~100px)는 140px에 수렴한다 (프론트엔드)
2. 메시지가 공간을 최대한 활용해야 미리보기 가독성이 높다 (UX)
3. `table-layout:fixed` 환경에서 단일 auto 컬럼이 나머지를 모두 차지하는 가장 안정적인 패턴이다 (아키텍트)

---

## ADR-009: action-preview 제거 → cell-msg 독립 TD

### 상태
**결정됨** (2026-04-18)

### 배경

현재 행위 셀 내에 `action-preview` span이 인라인으로 존재하고, 메시지 컬럼 추가로 중복이 발생한다.

### 결정

`action-preview`를 완전 제거하고, 독립 `<td class="cell-msg">`를 추가한다.

```html
<!-- 변경 전 -->
<td class="cell-action">${makeActionCell(r)}<span class="action-preview">${preview}</span></td>

<!-- 변경 후 -->
<td class="cell-action">${makeActionCell(r)}</td>
<td class="cell-msg">${msgHtml}</td>
```

```css
td.cell-msg {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  cursor: pointer;
}
td.cell-msg .prompt-preview {
  max-width: none;   /* 전역 200px 제약 해제 */
  display: inline;
}
```

메시지가 없는 경우: `<span class="cell-msg-empty" aria-label="메시지 없음">—</span>` + `cursor:default`

### 이유

1. 동일 정보를 두 위치에 표시하면 UX 혼란이 발생한다 (UX)
2. 제거가 코드 단순화에 유리하고 중복 렌더링 비용을 줄인다 (프론트엔드)
3. `makeRequestRow()` 단일 함수 수정으로 피드/플랫뷰/SSE 경로 모두 자동 반영된다 (아키텍트)

---

## ADR-010: contextPreview — displayText/cacheText 분리

### 상태
**결정됨** (2026-04-18)

### 배경

현재 `contextPreview()`는 `_promptCache`에 저장하는 텍스트(확장 시 표시)와
화면 미리보기 텍스트가 동일하다. tool_call에서 미리보기는 `parseToolDetail` 파싱 결과를,
확장 패널은 raw `tool_detail`을 보여야 하므로 두 경로를 분리해야 한다.

### 결정

```javascript
function contextPreview(r, maxLen = 50) {
  const rawText = getContextText(r);         // 확장용 원본 (항상 raw)
  if (!rawText) return '';
  _promptCache.set(r.id, rawText);           // 캐시는 항상 raw 저장
  
  // 미리보기용 텍스트: tool_call은 파싱 결과, 나머지는 raw
  const displayText = r.type === 'tool_call'
    ? (parseToolDetail(rawText) ?? rawText)
    : rawText;
  
  const flat = displayText.replace(/\n/g, ' ');
  const display = flat.slice(0, maxLen);
  // tooltip은 rawText 기준 (원본 확인 가능)
  const tooltip = rawText.length > 200 ? rawText.slice(0, 200) + `…` : rawText;
  return `<span class="prompt-preview" data-expand-id="${escHtml(r.id)}" title="${escHtml(tooltip)}">${escHtml(display)}${flat.length > maxLen ? '…' : ''}</span>`;
}
```

### 이유

1. 클릭 확장 시 전체 raw 원본 표시 요구사항을 만족한다 (아키텍트)
2. 함수 시그니처가 바뀌지 않으므로 모든 호출부 변경이 불필요하다 (프론트엔드)
3. `parseToolDetail`은 이미 구현되어 재활용 비용이 없다 (아키텍트)

---

## ADR-011: togglePromptExpand 재사용 + 확장 패널 개선

### 상태
**결정됨** (2026-04-18)

### 배경

메시지 셀에서도 클릭 확장이 필요하다. 신규 함수를 만들지, 기존 함수를 재사용할지 결정이 필요하다.

### 결정

기존 `togglePromptExpand(rid, tr, cols)` 재사용. 신규 함수 불필요.

이벤트 핸들러는 `[data-expand-id]` 속성을 가진 span을 대상으로 이미 위임 처리되어 있으므로,
`cell-msg` TD 안에 `contextPreview()`가 반환한 span을 넣으면 추가 핸들러 없이 동작한다.

확장 패널 개선:
```css
.prompt-expand-box {
  max-height: 400px;
  overflow-y: auto;
}
```

복사 버튼 추가:
```html
<div class="prompt-expand-box">
  <button class="expand-copy-btn" onclick="navigator.clipboard.writeText(this.nextSibling.textContent)">복사</button>
  <pre>${escHtml(fullDisplay)}</pre>
</div>
```

### 이유

1. `thead tr children.length` 자동 감지 로직이 컬럼 수 증가 후에도 자동 적응한다 (프론트엔드)
2. YAGNI — 신규 함수는 기능 중복이며 유지보수 지점을 늘린다 (아키텍트)
3. max-height 없이는 대형 payload 시 페이지 전체가 늘어나 다른 로그가 밀린다 (UX)
4. 복사 버튼은 tool_call 인자 재실행, 프롬프트 복사 등 전형적인 후속 작업을 지원한다 (UX)

---

## ADR-012: 미리보기 폰트 분리 (tool_call vs 자연어)

### 상태
**결정됨** (2026-04-18)

### 배경

tool_call의 `command: ls -la /path`와 prompt의 `파일을 분석해주세요`는 데이터 성격이 다르다.
같은 폰트로 렌더링하면 사용자가 스캔 단계에서 코드인지 자연어인지 구분하지 못한다.

### 결정

```css
tr[data-type="tool_call"] td.cell-msg .prompt-preview {
  font-family: monospace;
  font-size: 11px;
}
```

prompt/system 타입은 기존 본문 폰트 유지.

### 이유

타입 배지([T]/[P]/[S])와 함께 폰트 변화가 두 번째 시각적 구분 신호가 된다 (UX).

---

## ADR-013: 턴 뷰 이번 스코프 제외

### 상태
**결정됨** (2026-04-18)

### 배경

플랫뷰/피드는 `<table>` 기반이고 턴 뷰는 `<div>` + CSS grid 구조로 구현 방식이 다르다.
`grid-template-columns` 수정, 각 `.turn-row` 변형별 검증이 별도로 필요하다.

### 결정

이번 구현 범위에서 턴 뷰 제외. `.tool-sub` span은 현재대로 유지.

### 이유

위험 대비 가치가 낮다. 별도 feature로 추진한다 (아키텍트, 프론트엔드).

---

## ADR-014: promptPreview() dead code 제거

### 상태
**결정됨** (2026-04-18)

### 배경

`promptPreview()` 함수는 정의만 있고 호출부가 없는 dead code이다.
모든 호출부가 `contextPreview()`로 교체된 상태.

### 결정

이번 PR에서 `promptPreview()` 함수 정의를 제거한다.

### 이유

코드 정합성 유지. 미래 혼란 방지 (프론트엔드, 아키텍트).

---

## ADR-015: FLAT_VIEW_COLS/RECENT_REQ_COLS 변경 및 colspan 전수 수정

### 상태
**결정됨** (2026-04-18)

### 배경

컬럼이 1개 추가되므로 두 상수와 하드코딩된 colspan을 모두 갱신해야 한다.

### 결정

```javascript
const FLAT_VIEW_COLS  = 6;  // 5 → 6
const RECENT_REQ_COLS = 7;  // 6 → 7
```

하드코딩 직접 수정 위치:
- 피드 스켈레톤 행 3줄: `colspan="6"` → `colspan="7"`
- 플랫뷰 초기 빈 상태 행: `colspan="5"` → `colspan="6"`

### 이유

상수만 올려서는 해결되지 않는 잠복 버그가 존재한다 (아키텍트, 프론트엔드).

---

## 적용 범위 요약

| 화면 | 변경 내용 |
|------|----------|
| 최근 요청 테이블 (`makeRequestRow`) | 메시지 컬럼 추가, action-preview 제거 |
| 플랫 뷰 (`renderDetailRequests`) | 동일 (makeRequestRow 공유) |
| SSE 실시간 피드 | 동일 (makeRequestRow 공유) |
| 턴 뷰 (`renderTurnView`) | 이번 스코프 제외 |
| 확장 패널 (`togglePromptExpand`) | max-height + 복사 버튼 추가 |

## 구현 체크리스트

- [ ] colgroup 2곳: 행위 `width:auto` → `width:140px`, 메시지 col 삽입
- [ ] thead 2곳: `<th>메시지</th>` 삽입
- [ ] `FLAT_VIEW_COLS` 5→6, `RECENT_REQ_COLS` 6→7
- [ ] 스켈레톤 colspan 6→7 (3줄), 빈 상태 colspan 5→6 (1줄)
- [ ] `makeRequestRow()`: action-preview 제거, cell-msg TD 추가
- [ ] `contextPreview()`: displayText/cacheText 분리
- [ ] `promptPreview()` dead code 제거
- [ ] CSS: `td.cell-msg`, `.cell-msg-empty`, monospace 규칙 추가
- [ ] `.cell-action`: `display:flex` 유지 (배지 정렬 목적), `action-preview` 관련 CSS 제거
- [ ] `.prompt-expand-box`: max-height:400px, 복사 버튼
- [ ] `td.cell-msg .prompt-preview`: `max-width:none`, `display:inline`
