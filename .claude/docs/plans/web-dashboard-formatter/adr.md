# 웹 대시보드 Formatter 모듈화 및 UI/UX 개선 ADR

> 작성일: 2026-04-18  
> 참여 전문가: 소프트웨어 아키텍트, 프론트엔드 엔지니어, UX 엔지니어  
> 라운드: 5라운드

---

## ADR-001: 빌드 시스템 및 모듈화 방식

### 상태
**결정됨** (2026-04-18)

### 배경
현재 웹 대시보드는 단일 `index.html` 파일(~1670줄)로 CSS, JavaScript, HTML이 인라인으로 존재한다.
TUI에서 진행한 formatter 모듈화 작업(`packages/tui/src/formatters/`)을 웹에도 적용하는 방향이 요구됐다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | `<script type="module">` 파일 분리 | 빌드 없음, 서버 변경 없음 | JS 파일 추가 시 정적 서빙 라우팅 필요 |
| B | Vite + TypeScript 전환 | 타입 안전성, 번들 최적화 | 서버 정적 파일 경로 변경, dev 서버 프록시 설정 필요 |
| C | 단일 HTML 내 논리적 섹션 분리 (현행 유지) | 변경 최소, 서버 변경 없음 | 모듈화 없음, 파일 계속 비대화 |

### 결정

**Option C 확장: 단일 HTML 내 논리적 섹션 강화**  
서버 변경 없이 단일 `index.html`을 유지하면서 내부 로직을 개선한다.

### 이유

1. **서버 호환성**: `packages/server/src/index.ts`가 `Bun.file()`로 `index.html`만 직접 서빙한다. 외부 JS 파일 추가 시 정적 파일 라우팅 추가가 필요해 이번 범위를 벗어난다.
2. **packages/types가 빈 패키지**: formatter를 공유 패키지로 이동하려면 패키지 구조 먼저 정비해야 하는 선행 비용이 발생한다. 웹이 바닐라 JS라 TypeScript 파일을 직접 import도 불가하다.
3. **YAGNI**: 현재 웹 대시보드는 단일 편집 대상이라 파일 분리의 실제 유지보수 이익이 낮다.

### 대안 채택 시 영향

- **Option B 선택 시**: `dist/` 빌드 아티팩트 경로, 서버 정적 서빙 코드 수정, CI 빌드 파이프라인 추가 필요. 미래에 Vite 도입 시 별도 태스크로 진행.

---

## ADR-002: 타입 배지 약어 및 표현 방식

### 상태
**결정됨** (2026-04-18)

### 배경

현재 웹 배지는 전체 텍스트 ("prompt", "tool_call", "system")를 표시해 특히 "tool_call"이 테이블 컬럼 너비를 낭비한다.
TUI는 이미 `RequestTypeFormatter`에서 `P / T / S` 약어를 사용한다.

### 고려한 옵션

| 옵션 | 배지 | 비고 |
|------|------|------|
| A | P / T / S | TUI와 동일, 1글자 |
| B | P / TC / SYS | T→TC (턴 배지와 혼동 방지), S→SYS (세션과 혼동 방지) |
| C | 아이콘 + 텍스트 | 이미지 에셋 필요 |

### 결정

**Option A: P / T / S** + `title` 속성 툴팁으로 전체 타입명 표시

### 이유

1. **시각적 맥락 분리**: 웹 턴 뷰에서도 `T1, T2` 형태의 턴 배지가 있지만 `.turn-badge` 클래스(주황 배경)로 시각적으로 완전히 다르다. 타입 배지 `T`는 타입 컬럼 셀 안에만 표시되어 혼동 맥락이 없다.
2. **TUI 일관성**: `RequestTypeFormatter`와 동일한 레이블 사용으로 두 인터페이스 간 언어 통일.
3. **`title` 속성 툴팁**: 브라우저 기본 기능으로 구현 비용 zero, 접근성 자동 확보. Pure CSS 커스텀 툴팁은 `overflow:hidden` 부모에서 잘리는 문제가 있어 배제.

### 전문가 이견
**프론트엔드 Round 3**: TC/SYS 제안 — "T는 turn과 혼동 가능"  
**UX Round 3**: P/T/S 제안 — "TUI 일관성 우선"  
**해소**: Round 4에서 코드 직접 확인 결과 플랫뷰와 턴뷰는 상호 배타적 탭이라 동시 노출 없음. P/T/S 채택.

### 구현 범위
배지 약어 변경은 `typeBadge()` 함수뿐 아니라 다음 3곳 모두 수정:
1. `typeBadge()` 함수 본문
2. `renderDetailRequests()` 내 subtotal 행 인라인 배지
3. 턴 뷰 `promptRow` 인라인 배지

---

## ADR-003: CSS 색상 시스템 단일화

### 상태
**결정됨** (2026-04-18)

### 배경

현재 타입별 색상이 3중으로 관리되고 있어 동기화 오류 위험이 있다:
- CSS `.type-prompt`: `rgba(217,119,87,0.18)` 하드코딩
- JS `TYPE_COLORS`: `{ prompt: '#d97757', ... }` 하드코딩
- CSS `:root`: `--accent: #d97757` 등 별도 변수

### 결정

**CSS 변수를 단일 진실 공급원(SSoT)으로 설정**

```css
:root {
  --type-prompt-color:    #e8a07a;
  --type-prompt-bg:       rgba(217,119,87,0.18);
  --type-tool_call-color: #6ee7a0;
  --type-tool_call-bg:    rgba(74,222,128,0.15);
  --type-system-color:    #fbbf24;
  --type-system-bg:       rgba(245,158,11,0.15);
}
```

CSS 클래스는 이 변수를 참조, Canvas 차트용 `TYPE_COLORS` JS 객체는 `getComputedStyle`로 CSS 변수에서 읽도록 전환.

### 이유

1. **단일 수정 지점**: 색상 변경 시 CSS `:root`만 수정하면 배지, 도넛 차트, 필터 버튼 모두 동기화
2. **다크 테마 확장성**: 미래에 테마 변경 시 CSS 변수만 교체하면 됨

---

## ADR-004: 프롬프트 Preview 필드 우선 사용

### 상태
**결정됨** (2026-04-18)

### 배경

현재 `promptPreview()` 함수는 `r.payload` JSON을 파싱해 프롬프트 텍스트를 추출한다.
그러나 `packages/storage/src/schema.ts`에 `preview?: string` 필드(MIGRATION_V7)가 이미 존재하고,
`packages/server`가 API 응답에 이 필드를 포함하고 있다.

### 결정

**`r.preview` 우선 확인 → `r.payload` 파싱 폴백**

```js
function promptPreview(r, maxLen = 60) {
  // 1순위: DB의 preview 필드 (서버가 미리 계산)
  let text = (r.preview && typeof r.preview === 'string') ? r.preview : null;

  // 2순위: payload JSON 파싱 폴백 (구 데이터 호환)
  if (!text && r.payload) {
    try {
      const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
      text = p?.prompt ?? p?.content ?? p?.tool_input ?? (typeof p === 'string' ? p : '') || null;
    } catch {}
  }
  if (!text) return '';
  // ... 이하 렌더 로직
}
```

### 이유

1. **성능**: 서버가 미리 정제한 필드를 쓰면 클라이언트 JSON 파싱 비용 절감
2. **정확성**: `preview` 필드는 수집 시 100자로 정제된 값, payload 파싱보다 신뢰도 높음
3. **폴백 유지**: `preview` 없는 구 데이터와 호환성 보장

---

## ADR-005: _promptCache Object → Map 교체

### 상태
**결정됨** (2026-04-18)

### 배경

현재 `_promptCache`가 일반 객체(`{}`)로 구현되어 있고, "가장 먼저 추가된 키" 삭제 시 `Object.keys()[0]`을 사용한다.
JavaScript 객체에서 정수형 문자열 키는 삽입 순서가 아닌 숫자 오름차순으로 정렬되어, `r.id`가 숫자형 문자열일 경우 의도와 다르게 동작한다.

### 결정

**`Map()`으로 교체**: `Map`은 삽입 순서가 항상 보장되어 LRU 의도와 일치.

### 이유

1. **삽입 순서 보장**: ECMAScript 명세상 `Map`은 키 순서를 삽입 순서로 유지
2. **API 의미 명확**: `size`, `set()`, `get()`, `delete()`, `.keys().next()`로 의도가 코드에서 명확히 드러남

---

## ADR-006: Scroll Lock 구현 방식

### 상태
**결정됨** (2026-04-18)

### 배경

실시간 SSE 피드에서 사용자가 과거 요청을 스크롤하여 확인 중일 때, 새 요청이 `prependRequest()`로 삽입되어 스크롤 위치가 변경되는 문제.

### 고려한 옵션

| 옵션 | 설명 | 비고 |
|------|------|------|
| A | 즉시 삽입 + scrollTop 보정 | DOM에 실시간 삽입, 스크롤 위치 유지 |
| B | pendingQueue 버퍼링 | lock 중 큐에 쌓고 배너 클릭 시 일괄 flush |

### 결정

**Option A: 즉시 삽입 + scrollTop 보정**

`.feed-body` 스크롤 위치 감지:
- 하단 80px 이내 → lock 없음, 기존처럼 prepend + 자동 스크롤
- 하단 80px 이상 → prepend 후 `scrollTop` 보정으로 시각 위치 고정
- 상단 고정 배너로 새 요청 카운트 표시

### 이유

1. **기존 10개 DOM 제한 호환**: 버퍼링 방식은 flush 시 10개 초과로 기존 `deleteRow()` 로직과 충돌
2. **구현 단순성**: `scrollTop` 보정은 Row 삽입 전후 차이값 계산으로 구현 가능
3. **즉시 DOM 반영**: 검색이나 Turn 뷰 전환 시 최신 데이터가 이미 DOM에 있음

### 전문가 이견
**Frontend Round 3**: pendingQueue 방식 상세 설계 제안  
**해소**: Round 4에서 기존 10개 DOM 제한 로직과 충돌 확인 후 Option A 채택

---

## 이번 작업 제외 결정

| 항목 | 이유 |
|------|------|
| packages/types formatter 이동 | 바닐라 JS에서 TypeScript import 불가, types 패키지 미완성 |
| Vite/TypeScript 전환 | 서버 정적 파일 경로 변경 필요, 이번 범위 초과 |
| JS 파일 분리 (ES Modules) | 정적 파일 라우팅 추가 필요, 서버 코드 변경 수반 |
| drilldown 필터 | 새 기능, 별도 이터레이션 |
| 3-column 레이아웃 | 대규모 레이아웃 변경, 별도 이터레이션 |
| 키보드 단축키 | 이번 범위 외 |
| pendingQueue scroll lock | 기존 DOM 10개 제한 로직과 충돌 |
