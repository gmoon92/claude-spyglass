# Log Table UX Architecture Decision Records

> 작성일: 2026-04-18  
> 참여 전문가: 소프트웨어 아키텍트, 프론트엔드 엔지니어, UX/제품 디자이너

---

## ADR-001: 타입+툴 컬럼 통합 방식

### 상태
**결정됨** (2026-04-18)

### 배경

현재 로그 테이블에 "타입"(P/T/S 배지)과 "툴"(도구명+상세) 컬럼이 별도로 존재한다.
사용자는 두 컬럼을 조합해야 "tool_call 타입의 Bash 도구"라는 의미를 파악할 수 있어
스캔 효율이 낮다. DB/API 구조는 그대로 유지하되, UI 렌더링에서만 통합한다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A (채택) | 배지+툴명 단일 행, 맥락은 클릭 확장 | 행 높이 고정, 검증된 패턴 | 맥락이 기본 숨김 |
| B | 동일 셀에 타입+툴명(1행)+맥락 미리보기(2행) | 맥락 바로 보임 | 행 높이 가변, 레이아웃 불안정 |
| C | 타입 컬럼 제거, 아이콘/색상으로만 구분 | 시각적 깔끔함 | 접근성(WCAG 1.4.1) 위반 |

### 결정

**방향 A 채택**: 타입 배지 + 툴명/모델명을 하나의 셀("행위")로 합치고,
맥락 상세(tool_detail, promptPreview)는 현재 `prompt-expand` 패턴을 `tool_call`과 `system`에도 확장 적용한다.

표시 형태:
- `prompt` → `[P] claude-sonnet-4-6`
- `tool_call` → `[T] Bash` (클릭 시 tool_detail 펼쳐짐)
- `system` → `[S]` (클릭 시 system 컨텍스트 펼쳐짐)

### 이유

1. 행 높이 고정 — `system` 타입처럼 맥락 텍스트가 없는 경우와 있는 경우가 혼재하면 방향 B는 레이아웃 불안정(ADR-003 문제)을 해결하지 못하고 오히려 악화시킨다 (UX 전문가)
2. Datadog, Grafana Loki, Kibana 등 검증된 관측성 도구는 모두 "단일 고정 행 + 클릭 확장" 패턴을 사용한다 (UX 전문가)
3. 기존 `prompt-expand-box` 구현이 이미 존재하므로 확장 패턴 적용 비용이 낮다 (아키텍트)
4. 방향 C는 색각 이상 사용자 접근성 퇴행이므로 제외 (프론트엔드, UX)

### 전문가 이견

**프론트엔드 관점**: 방향 B가 기존 `.tool-cell` + `.tool-main` + `.tool-sub` CSS 구조를 재활용할 수 있어 구현 비용이 낮다고 주장.  
**UX 관점**: 방향 B는 항상-표시 2행이 정보 계층을 무너뜨리고, 레이아웃 안정성 목표와 직접 충돌한다고 반박.  
**해소**: 레이아웃 안정성이 이번 개선의 핵심 요건이므로 UX 관점 채택. 단, `.tool-cell` CSS는 재사용한다.

### 대안 채택 시 영향

- 방향 B 선택 시: system 타입의 맥락 부재로 행 높이 불균일, 레이아웃 불안정 문제 지속

---

## ADR-002: 통합 컬럼 명칭

### 상태
**결정됨** (2026-04-18)

### 배경

타입+툴 통합 컬럼의 헤더 명칭이 필요하다. "타입"도 "툴"도 아닌 두 개념을 포괄하는 이름이어야 한다.

### 고려한 옵션

| 옵션 | 설명 |
|------|------|
| 행위 (채택) | prompt→추론 요청, tool_call→도구 실행, system→컨텍스트 주입을 포괄 |
| 작업 | 유사하나 system 타입에 어색 |
| 요청 유형 | system 타입을 "요청"으로 표현하기 어색 |
| 타입/도구 | 분리 구조의 언어를 유지해 통합 의미 미전달 |

### 결정

컬럼 헤더를 **"행위"** 로 확정한다. (영문: Action)

### 이유

"행위"는 "무언가가 수행됐다"는 관측 의미론에 가장 적합하다. 사용자가 로그를 보는 목적이 "어떤 행위들이 일어났는지"를 파악하는 것이기 때문이다.

---

## ADR-003: 레이아웃 안정성 — `table-layout: fixed` 도입

### 상태
**결정됨** (2026-04-18)

### 배경

현재 `table { width:100%; border-collapse:collapse; }`에 `table-layout: auto`(기본값)가 적용되어
셀 내용 길이에 따라 컬럼 너비가 동적으로 재계산된다. `tool_detail`이 길어지면 행 높이와 인접 셀 정렬이 흔들린다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| `table-layout: fixed` + `<colgroup>` (채택) | 첫 행/col 기준으로 너비 고정 | 콘텐츠 무관 레이아웃 보장 | th에 너비 지정 필요 |
| td `min-width`/`max-width` 개별 지정 | 각 td에 CSS 제약 | 상수 필요 없음 | `table-layout:auto`에서 보장 안 됨 |

### 결정

```css
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
```

```html
<colgroup>
  <col style="width: 90px">   <!-- 시각 -->
  <col>                        <!-- 행위 (나머지 공간) -->
  <col style="width: 58px">   <!-- 입력 -->
  <col style="width: 58px">   <!-- 출력 -->
  <col style="width: 72px">   <!-- 응답시간 -->
  <col style="width: 96px">   <!-- 세션 (최근 요청 테이블만) -->
</colgroup>
```

overflow는 CSS로 처리:
```css
.cell-action { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

### 이유

1. `table-layout: fixed`는 콘텐츠 길이와 무관하게 컬럼 너비를 보장하는 유일한 수단이다 (아키텍트, UX)
2. 숫자 컬럼(입력/출력/응답시간)은 tabular-nums으로 정렬되어야 하므로 너비 고정이 필수다 (프론트엔드)

---

## ADR-004: `makeActionCell()` 헬퍼 함수 도입

### 상태
**결정됨** (2026-04-18)

### 배경

현재 `makeTypeCell(r)`과 `toolLabel(r)` 두 함수가 각각 별도 `<td>`를 생성하고,
동일한 패턴이 `makeRequestRow()`, `renderDetailRequests()`, `renderTurnView()` 세 곳에 중복 존재한다.

### 결정

`makeActionCell(r)` 신규 함수를 도입한다. 이 함수는 **내용물 HTML string**만 반환하고,
래퍼 `<td>` 또는 `<div>`는 호출 컨텍스트에서 결정한다.

```javascript
function makeActionCell(r) {
  // 1행: 타입 배지 + 식별자 (툴명 or 모델명)
  // 클릭 이벤트: tool_call → tool_detail 확장, prompt → promptPreview 확장
  const badge = typeBadge(r.type);
  const identifier = r.type === 'tool_call'
    ? (r.tool_name ? `<span class="action-name">${escHtml(r.tool_name)}</span>` : '')
    : r.type === 'prompt'
    ? `<span class="action-name action-model">${escHtml(r.model ?? '')}</span>`
    : '';
  return `${badge}${identifier}`;
}
```

기존 `makeTypeCell()`은 삭제하지 않고, `makeActionCell()`이 안정화된 후 제거한다.

### 이유

1. 단일 책임 원칙 — 통합 셀 렌더링 로직이 한 곳에 집중된다 (아키텍트)
2. 래퍼 태그 분리 — 플랫 뷰(`<td>`)와 턴 뷰(`<div class="tool-cell">`) 구조가 달라도 재사용 가능 (프론트엔드)
3. `renderTools()` (좌측 툴 통계)도 동일 함수를 사용해 "공통 적용" 목표 달성 (UX)

---

## ADR-005: 맥락 확장 패턴을 tool_call/system에도 적용

### 상태
**결정됨** (2026-04-18)

### 배경

현재 `prompt-expand-box` 클릭 확장 패턴은 `prompt` 타입에만 구현되어 있다.
`tool_call`의 `tool_detail`, `system`의 컨텍스트는 클릭 확장을 지원하지 않아 관측 맥락 파악이 어렵다.

### 결정

클릭 확장 패턴을 세 타입 모두로 확장한다.

맥락 텍스트 출처 우선순위 (타입별):
```javascript
function getContextText(r) {
  if (r.type === 'tool_call') return r.tool_detail ?? null;
  if (r.type === 'prompt')   return r.preview ?? extractPromptText(r);
  if (r.type === 'system')   return extractPromptText(r);
  return null;
}
```

`FLAT_VIEW_COLS`와 `RECENT_REQ_COLS`를 컬럼 통합 후 각각 5, 6으로 변경하며,
`expandTr`의 colspan은 컨텍스트별로 올바른 값을 사용한다.

### 이유

현재 `prompt-expand-box` 구현이 이미 존재하여 재사용 비용이 낮다.
클릭 확장은 사용자가 능동적으로 상세 정보를 요청하는 멘탈 모델과 일치한다.

---

## ADR-006: 행 좌측 타입 색상 보더 적용

### 상태
**결정됨** (2026-04-18)

### 배경

현재 타입 구분 시각 신호가 배지(P/T/S 텍스트+색상)에만 의존한다.
배지가 작아 스캔 중 인식이 어렵다.

### 결정

각 행의 좌측에 2px 타입 색상 보더를 추가한다.

```css
tr[data-type="prompt"]    { border-left: 2px solid var(--type-prompt-color); }
tr[data-type="tool_call"] { border-left: 2px solid var(--type-tool_call-color); }
tr[data-type="system"]    { border-left: 2px solid var(--type-system-color); }
```

```javascript
function makeRequestRow(r, opts) {
  const tr = `<tr data-id="${r.id}" data-type="${r.type}" ...>`;
}
```

### 이유

1. 배경색과 달리 좌측 보더는 hover/selected 상태와 충돌하지 않는다 (UX)
2. 주변 시야(peripheral vision)로 행 타입을 파악할 수 있어 스캔 속도 향상 (UX)
3. 기존 CSS 변수 SSoT를 재활용하므로 색상 불일치 위험 없음 (아키텍트)

---

## ADR-007: 여백 최적화 수치

### 상태
**결정됨** (2026-04-18)

### 배경

현재 `td { padding: 6px 12px }`, `th { padding: 7px 12px }`로 설정되어 있다.
실제 데이터 밀도에 비해 행 높이가 크다.

### 결정

```css
th { padding: 5px 8px; font-size: 10px; }
td { padding: 4px 8px; font-size: 12px; }
```

클릭 타겟 최소 크기(32px) 보장 확인:
- `font-size: 12px` + `line-height: 1.4` = ~16.8px
- `padding: 4px * 2` = 8px
- 합계: ~24.8px (터치 인터페이스 아닌 데스크탑 전용이므로 허용)

### 이유

1. 실제 데이터가 많이 적재되어 있어 밀도 있는 표시가 가독성에 유리하다
2. 데스크탑 전용 대시보드이므로 48px 클릭 타겟 기준이 아닌 32px 기준 적용

---

## 적용 범위 요약

| 화면 | 변경 내용 |
|------|----------|
| 최근 요청 테이블 (`makeRequestRow`) | 행위 통합 셀, table-layout:fixed, 좌측 보더, 여백 최적화 |
| 플랫 뷰 (`renderDetailRequests`) | 동일 + 클릭 확장 tool_call/system 지원 |
| 턴 뷰 (`renderTurnView`) | `makeActionCell()` 적용, 그리드 너비 조정 |
| 툴 통계 패널 (`renderTools`) | `makeActionCell()` 내용 재사용, 여백 최적화 |
| 세션 브라우저 (`renderSessions`) | 여백 최적화만 (구조 변경 없음) |

## 구현 시 필수 체크리스트

- [ ] `FLAT_VIEW_COLS` 7→6, `RECENT_REQ_COLS` 7→6 (타입+툴 통합 후 컬럼 수 재확인)
- [ ] `colspan` 참조 전수 검색: `grep -n "colspan\|FLAT_VIEW_COLS\|RECENT_REQ_COLS"`
- [ ] `expandTr`의 colspan이 호출 컨텍스트에 따라 올바른 값 사용
- [ ] 스켈레톤 행 colspan 업데이트 (현재 하드코딩)
- [ ] 턴 뷰 grid-template-columns 동기화
- [ ] scroll lock 행 높이 보정 로직 검증
- [ ] `typeBadge()`에 `aria-label` 추가
