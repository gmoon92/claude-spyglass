# 웹 대시보드 Formatter 모듈화 및 UI/UX 개선 - 작업 목록

> 기반 문서: plan.md, adr.md  
> 작성일: 2026-04-18  
> 총 태스크: 5개

---

## 의존성 그래프

```
T-01 ─────────────────────── T-02 (배지 CSS 변수 먼저)
     └──────────────────────── T-05 (banner 색상 변수 참조)
T-03 ─── T-04 (cache 먼저, promptPreview에서 사용)
```

---

## 태스크 목록

| ID | 태스크 | 선행 | 커밋 타입 |
|----|--------|------|----------|
| T-01 | CSS 타입별 변수 SSoT 추가 | - | feat |
| T-02 | typeBadge P/T/S 약어 + title 툴팁 | T-01 | feat |
| T-03 | _promptCache Object → Map 교체 | - | refactor |
| T-04 | promptPreview r.preview 우선 사용 | T-03 | feat |
| T-05 | Scroll Lock 구현 | T-01 | feat |

---

## T-01: CSS 타입별 변수 SSoT 추가

**선행 조건**: 없음

### 작업 내용
`index.html` CSS `:root` 블록에 타입별 색상 변수를 명시적으로 추가한다.
기존 `.type-prompt`, `.type-tool_call`, `.type-system` CSS 클래스가 이 변수를 참조하도록 교체한다.
JS `TYPE_COLORS` 객체는 CSS 변수에서 읽도록 전환한다.

### 구현 범위
- `packages/web/index.html` CSS `:root` 블록 (line ~28):
  ```css
  --type-prompt-color:    #e8a07a;
  --type-prompt-bg:       rgba(217,119,87,0.18);
  --type-tool_call-color: #6ee7a0;
  --type-tool_call-bg:    rgba(74,222,128,0.15);
  --type-system-color:    #fbbf24;
  --type-system-bg:       rgba(245,158,11,0.15);
  ```
- 기존 `.type-badge` 색상 클래스 (line ~258-261) → CSS 변수 참조로 교체:
  ```css
  .type-prompt    { background: var(--type-prompt-bg);    color: var(--type-prompt-color); }
  .type-tool_call { background: var(--type-tool_call-bg); color: var(--type-tool_call-color); }
  .type-system    { background: var(--type-system-bg);    color: var(--type-system-color); }
  ```
- JS `TYPE_COLORS` (line ~681-685) → `getComputedStyle` 기반으로 전환:
  ```js
  function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  // init() 호출 후 채워짐
  const TYPE_COLORS = {};
  function initTypeColors() {
    TYPE_COLORS.prompt    = getCssVar('--type-prompt-color') || '#e8a07a';
    TYPE_COLORS.tool_call = getCssVar('--type-tool_call-color') || '#6ee7a0';
    TYPE_COLORS.system    = getCssVar('--type-system-color') || '#fbbf24';
  }
  ```
  `init()` 함수 내에서 `initTypeColors()` 첫 줄 호출.

### 커밋 메시지
```
feat(web): CSS 타입 색상 변수 SSoT 추가
```

### 검증
- 도넛 차트 색상이 기존과 동일하게 표시
- 배지 색상 변경 없음 (CSS 변수 교체이므로 시각적 동일)
- `prompt / tool_call / system` 필터 버튼 색상 유지

### 완료 기준
- [ ] `:root`에 6개 타입 CSS 변수 추가됨
- [ ] `.type-prompt`, `.type-tool_call`, `.type-system` 하드코딩 제거
- [ ] `TYPE_COLORS` JS 객체가 CSS 변수에서 읽음 (fallback 포함)
- [ ] 도넛 차트 정상 렌더링 확인

---

## T-02: typeBadge P/T/S 약어 + title 툴팁

**선행 조건**: T-01 (CSS 변수 추가 완료)

### 작업 내용
전체 타입명 텍스트 배지("prompt", "tool_call", "system")를 약어(P/T/S)로 변경하고,
`title` 속성으로 전체 타입명을 툴팁 제공한다.
3곳의 인라인 배지가 있어 모두 수정한다.

### 구현 범위

**1. `typeBadge()` 함수 (line ~908-912)**
```js
const TYPE_ABBR = { prompt: 'P', tool_call: 'T', system: 'S' };

function typeBadge(type) {
  const known = ['prompt', 'tool_call', 'system'];
  const cls = known.includes(type) ? type : 'unknown';
  const abbr = TYPE_ABBR[type] ?? type.slice(0, 1).toUpperCase();
  let html = `<span class="type-badge type-${cls}" title="${escHtml(type)}">${abbr}</span>`;
  if (type === 'prompt') html += `<span class="mini-badge role-badge role-user">user</span>`;
  return html;
}
```

**2. `.type-badge` CSS min-width 추가 (line ~253-256)**
```css
.type-badge {
  ...
  min-width: 20px;
  text-align: center;
}
```

**3. subtotal 행 인라인 배지 (line ~1324-1328) — `typeBadge()` 호출로 통일**
현재:
```js
return `<span class="type-badge type-${cls}">${type}</span>&nbsp;${count}건`;
```
변경 후:
```js
return `${typeBadge(type)}&nbsp;${count}건`;
```

**4. 턴 뷰 promptRow 인라인 배지 (line ~1406)**
현재:
```js
`<span class="type-badge type-prompt">prompt</span><span class="mini-badge role-badge role-user">user</span>`
```
변경 후:
```js
`${typeBadge(turn.prompt?.type || 'prompt')}`
```

### 커밋 메시지
```
feat(web): 타입 배지 P/T/S 약어 및 title 툴팁 적용
```

### 검증
- 최근 요청 피드의 타입 컬럼에 P/T/S 배지 + 마우스 호버 시 툴팁 표시
- 세션 상세 플랫뷰 하단 subtotal 행에서도 P/T/S 표시
- 턴 뷰에서 prompt 행의 배지도 P 약어 표시
- 테이블 컬럼 정렬이 이전보다 좁아짐 (도구 컬럼에 공간 확보)

### 완료 기준
- [ ] 최근 요청 피드 배지: prompt→P, tool_call→T, system→S
- [ ] 각 배지에 `title` 속성으로 원래 타입명 포함
- [ ] subtotal 행 배지 동일 적용
- [ ] 턴 뷰 promptRow 배지 동일 적용
- [ ] user role 배지는 그대로 표시

---

## T-03: _promptCache Object → Map 교체

**선행 조건**: 없음

### 작업 내용
`_promptCache`를 `Map()`으로 교체하여 삽입 순서 기반 LRU가 올바르게 동작하도록 수정한다.

### 구현 범위
`packages/web/index.html` JavaScript 섹션 (line ~951-971):

```js
// 변경 전
const _promptCache = {};
if (Object.keys(_promptCache).length >= PROMPT_CACHE_MAX) {
  const oldest = Object.keys(_promptCache)[0];
  delete _promptCache[oldest];
}
_promptCache[r.id] = text;
// ...
const text = _promptCache[rid] || '';

// 변경 후
const _promptCache = new Map();
if (_promptCache.size >= PROMPT_CACHE_MAX) {
  const oldest = _promptCache.keys().next().value;
  _promptCache.delete(oldest);
}
_promptCache.set(r.id, text);
// ...
const text = _promptCache.get(rid) || '';
```

### 커밋 메시지
```
refactor(web): _promptCache Object → Map 교체 (삽입 순서 보장)
```

### 검증
- promptPreview 클릭 시 expand 박스 정상 표시
- 500개 초과 시 가장 오래된 항목이 삭제됨 (기능 동일)

### 완료 기준
- [ ] `_promptCache = new Map()` 선언
- [ ] 4개 Map API 전환: `.size`, `.delete()`, `.set()`, `.get()`
- [ ] `Object.keys()` 참조 완전 제거
- [ ] click expand 정상 동작

---

## T-04: promptPreview r.preview 우선 사용

**선행 조건**: T-03 (_promptCache Map 교체 완료)

### 작업 내용
`promptPreview()` 함수를 수정하여 `r.preview` DB 필드를 우선 사용하고,
없을 경우 기존 `r.payload` JSON 파싱으로 폴백한다.
`title` 속성에 200자 원문을 설정하여 hover 시 더 긴 텍스트 확인 가능하게 한다.

### 구현 범위
`packages/web/index.html` `promptPreview()` 함수 (line ~952-966):

```js
function promptPreview(r, maxLen = 60, tooltipLen = 200) {
  // 1순위: r.preview DB 필드
  let text = (r.preview && typeof r.preview === 'string') ? r.preview : null;

  // 2순위: payload JSON 파싱 폴백
  if (!text && r.payload) {
    try {
      const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
      text = p?.prompt ?? p?.content ?? p?.tool_input ?? (typeof p === 'string' ? p : '') || null;
    } catch {}
  }
  if (!text) return '';

  // 캐시 등록
  if (_promptCache.size >= PROMPT_CACHE_MAX) {
    const oldest = _promptCache.keys().next().value;
    _promptCache.delete(oldest);
  }
  _promptCache.set(r.id, text);

  const flat = text.replace(/\n/g, ' ');
  const displayText = flat.slice(0, maxLen);
  const isTruncated = flat.length > maxLen;

  // 툴팁: 200자 (hover 시 더 긴 내용 확인)
  const tooltipText = text.length > tooltipLen
    ? text.slice(0, tooltipLen) + `… (총 ${text.length.toLocaleString('ko-KR')}자)`
    : text;

  return `<span class="prompt-preview" data-expand-id="${escHtml(r.id)}" title="${escHtml(tooltipText)}">${escHtml(displayText)}${isTruncated ? '…' : ''}</span>`;
}
```

`extractFirstPrompt()` 함수도 동일하게 `preview` 필드 우선 확인:
```js
function extractFirstPrompt(payload) {
  if (!payload) return '';
  function clean(text) {
    return text.replace(/<[^>]+>/g, '').replace(/[\n\r]+/g, ' ').trim().slice(0, 60);
  }
  try {
    const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
    // preview 필드 우선
    const text = p?.preview ?? p?.prompt ?? p?.content ?? (typeof p === 'string' ? p : '');
    return text ? clean(text) : '';
  } catch {
    const m = typeof payload === 'string' && payload.match(/"prompt"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) return clean(m[1].replace(/\\n/g, ' '));
    return '';
  }
}
```

### 커밋 메시지
```
feat(web): promptPreview r.preview 필드 우선 사용 + 200자 툴팁
```

### 검증
- `preview` 필드가 있는 요청에서 해당 값이 표시됨
- `preview` 없는 구 데이터에서 payload 파싱으로 폴백
- 마우스 호버 시 200자 툴팁 표시
- 클릭 expand 동작 이전과 동일

### 완료 기준
- [ ] `r.preview` 필드 우선 확인 로직 추가
- [ ] `r.payload` 폴백 유지
- [ ] `title` 속성에 200자 텍스트 설정
- [ ] `extractFirstPrompt()`에도 preview 우선 적용
- [ ] 클릭 expand 정상 동작

---

## T-05: Scroll Lock 구현

**선행 조건**: 없음

### 작업 내용
실시간 피드에서 사용자가 위로 스크롤 중일 때 새 요청이 들어와도 스크롤 위치가 유지되도록 한다.
하단 80px 이내 → 기존처럼 auto-scroll, 그 외 → 삽입 후 scrollTop 보정.
새 요청 카운트 배너 표시.

### 구현 범위

**1. CSS 추가 (styles 섹션)**
```css
/* ─── SCROLL LOCK BANNER ───────────────────────────── */
.scroll-lock-banner {
  position: sticky;
  top: 0;
  z-index: 10;
  display: none;
  padding: 5px 12px;
  background: rgba(217,119,87,0.12);
  border-bottom: 1px solid rgba(217,119,87,0.3);
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  cursor: pointer;
  user-select: none;
}
.scroll-lock-banner.visible { display: block; }
```

**2. HTML 추가 (feed-body 내부 맨 위)**
```html
<div class="feed-body">
  <div class="scroll-lock-banner" id="scrollLockBanner"></div>
  <table>...
```

**3. JS 상태 변수 추가**
```js
let isScrollLocked = false;
let scrollLockNewCount = 0;
```

**4. `prependRequest()` 함수 수정**
```js
function prependRequest(r) {
  const body = document.getElementById('requestsBody');
  const feedBody = document.querySelector('.feed-body');
  const isNearBottom = feedBody.scrollHeight - feedBody.scrollTop - feedBody.clientHeight < 80;

  const prevScrollTop = feedBody.scrollTop;
  const prevScrollHeight = feedBody.scrollHeight;

  while (body.rows.length >= 10) body.deleteRow(body.rows.length - 1);
  const tmp = document.createElement('tbody');
  tmp.innerHTML = makeRequestRow(r, { showSession: true });
  body.insertBefore(tmp.firstElementChild, body.firstChild);

  if (!isNearBottom) {
    // 삽입된 높이만큼 scrollTop 보정 (시각 위치 고정)
    const addedHeight = feedBody.scrollHeight - prevScrollHeight;
    feedBody.scrollTop = prevScrollTop + addedHeight;
    scrollLockNewCount++;
    updateScrollLockBanner();
  } else {
    // 하단 근처: 기존처럼 최상단으로 스크롤
    isScrollLocked = false;
    scrollLockNewCount = 0;
    updateScrollLockBanner();
  }
}
```

**5. 배너 업데이트/클릭 함수**
```js
function updateScrollLockBanner() {
  const banner = document.getElementById('scrollLockBanner');
  if (scrollLockNewCount > 0) {
    banner.textContent = `↓ 새 요청 ${scrollLockNewCount}개 — 클릭하여 최신으로 이동`;
    banner.classList.add('visible');
  } else {
    banner.classList.remove('visible');
  }
}

function jumpToLatest() {
  const feedBody = document.querySelector('.feed-body');
  feedBody.scrollTo({ top: 0, behavior: 'smooth' });
  scrollLockNewCount = 0;
  isScrollLocked = false;
  updateScrollLockBanner();
}
```

**6. `initEventDelegation()` 에 배너 클릭 추가**
```js
document.getElementById('scrollLockBanner').addEventListener('click', jumpToLatest);
```

### 커밋 메시지
```
feat(web): 실시간 피드 scroll lock 구현
```

### 검증
- 피드에서 위로 스크롤 후 새 요청 SSE 이벤트 발생 시 스크롤 위치 유지
- 배너에 "↓ 새 요청 N개" 표시
- 배너 클릭 시 최상단으로 이동하며 배너 숨김
- 피드 하단 근처에서는 기존처럼 새 요청이 자동으로 맨 위에 표시

### 완료 기준
- [ ] CSS `.scroll-lock-banner` 추가
- [ ] HTML 배너 요소 추가
- [ ] 상태 변수: `scrollLockNewCount`
- [ ] `prependRequest()` scrollTop 보정 로직
- [ ] 배너 클릭 → `jumpToLatest()`
- [ ] SSE 연결 해제 시 카운트 초기화

---

## 완료 기준

- [x] T-01: CSS 변수 SSoT 추가
- [x] T-02: P/T/S 배지 + 툴팁
- [x] T-03: _promptCache Map 교체
- [x] T-04: preview 필드 우선 사용
- [x] T-05: Scroll Lock 구현
- [ ] 기능 회귀 없음 (SSE, 도넛 차트, 세션 상세, 클릭 expand)
