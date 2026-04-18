# Log Table UX 작업 목록

> 기반 문서: plan.md, adr.md  
> 작성일: 2026-04-18  
> 총 태스크: 7개

---

## 태스크 목록

| ID | 태스크 | 예상 시간 | 선행 태스크 | 커밋 타입 |
|----|--------|----------|------------|----------|
| T-01 | `table-layout: fixed` + `<colgroup>` 도입 및 여백 최적화 | 1h | - | refactor |
| T-02 | `makeActionCell()` + `getContextText()` 헬퍼 함수 구현 | 1h | T-01 | feat |
| T-03 | 최근 요청 테이블에 행위 통합 셀 적용 | 1h | T-02 | feat |
| T-04 | 플랫 뷰에 행위 통합 셀 + tool_call/system 클릭 확장 적용 | 1.5h | T-02 | feat |
| T-05 | 행 좌측 타입 색상 보더 적용 (전체 화면) | 0.5h | T-03, T-04 | feat |
| T-06 | 턴 뷰 `makeActionCell()` 적용 및 그리드 너비 조정 | 1h | T-02, T-03 | refactor |
| T-07 | 툴 통계 패널 + 세션 브라우저 여백 최적화 | 0.5h | T-01 | refactor |

---

## 의존성 그래프

```
T-01 → T-02 → T-03 ──┐── T-05
              ↘       │
              T-04 ───┘
              
T-02, T-03 → T-06

T-01 → T-07
```

---

## T-01: `table-layout: fixed` + `<colgroup>` 도입 및 여백 최적화

**선행 조건**: 없음

### 작업 내용

CSS에 `table-layout: fixed`를 추가하고, 최근 요청 테이블과 플랫 뷰 테이블의
`<thead>` 위에 `<colgroup>`을 추가하여 컬럼 너비를 선언적으로 고정한다.
동시에 `th`, `td` 패딩을 줄여 데이터 밀도를 높인다.

### 구현 범위

- `packages/web/index.html`:
  - CSS: `table { table-layout: fixed; }` 추가
  - CSS: `th { padding: 5px 8px; }`, `td { padding: 4px 8px; }` 변경
  - HTML: 최근 요청 테이블 `<thead>` 앞에 `<colgroup>` 추가 (시각:90px / 행위:auto / 입력:58px / 출력:58px / 응답시간:72px / 세션:96px)
  - HTML: 플랫 뷰 테이블 `<thead>` 앞에 `<colgroup>` 추가 (시각:90px / 행위:auto / 입력:58px / 출력:58px / 응답시간:72px)
  - CSS: `.cell-action { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }` 추가
  - CSS: `.tool-cell { min-width: 0; }`, `.tool-sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }` 추가

### 커밋 메시지
```
refactor(web): table-layout fixed + colgroup 도입, 여백 최적화
```

### 검증 명령어
```bash
# 개발 서버 실행 후 브라우저에서 확인
# tool_detail이 긴 행이 있을 때 컬럼 너비가 고정되어 있는지 시각 확인
bun run dev
```

### 완료 기준
- [ ] `tool_detail`이 긴 데이터에서 컬럼 너비가 고정됨
- [ ] `th`, `td` 패딩이 5px/4px로 줄어든 것 확인
- [ ] 기존 hover/selected 상태가 정상 작동

---

## T-02: `makeActionCell()` 헬퍼 함수 구현

**선행 조건**: T-01 완료 후

### 작업 내용

기존 `makeTypeCell(r)`과 `toolLabel(r)`의 역할을 통합하는 `makeActionCell(r)` 함수를 구현한다.
함수는 래퍼 태그 없이 내용물 HTML string만 반환한다.
타입별로 다른 식별자(툴명/모델명)와 배지를 조합한다.

### 구현 범위

- `packages/web/index.html`:
  - `makeActionCell(r)` 함수 추가:
    ```javascript
    function makeActionCell(r) {
      const badge = typeBadge(r.type);
      let identifier = '';
      if (r.type === 'tool_call' && r.tool_name) {
        const icon = toolIconHtml(r.tool_name);
        identifier = `<span class="action-name">${icon}${escHtml(r.tool_name)}</span>`;
      } else if (r.type === 'prompt' && r.model) {
        identifier = `<span class="action-name action-model">${escHtml(r.model)}</span>`;
      }
      return `<span class="action-cell-inner">${badge}${identifier}</span>`;
    }
    ```
  - `getContextText(r)` 함수 추가 (맥락 확장용):
    ```javascript
    function getContextText(r) {
      if (r.type === 'tool_call') return r.tool_detail ?? null;
      if (r.type === 'prompt')   return r.preview ?? extractPromptText(r);
      if (r.type === 'system')   return extractPromptText(r);
      return null;
    }
    ```
  - CSS: `.action-cell-inner { display: flex; align-items: center; gap: 4px; }`, `.action-name { font-size: 12px; color: var(--text); }`, `.action-model { color: var(--text-dim); font-size: 11px; }` 추가
  - `typeBadge()`에 `aria-label="${type}"` 추가
  - 엣지 케이스 명시적 처리:
    - `tool_detail`이 null/undefined인 tool_call → tool_name만 표시, 맥락 확장 없음
    - `preview`, `payload` 모두 없는 prompt → 맥락 확장 없음 (빈 문자열 폴백)
    - system 타입 extractPromptText null → 맥락 확장 없음

### 커밋 메시지
```
feat(web): makeActionCell() + getContextText() 헬퍼 함수 구현
```

### 검증 명령어
```bash
# 브라우저 콘솔에서 함수 동작 확인
# makeActionCell({ type: 'tool_call', tool_name: 'Bash', tool_detail: 'ls -la' }) → [T] Bash 포함
# makeActionCell({ type: 'tool_call', tool_name: 'Bash', tool_detail: null }) → [T] Bash만, 상세 없음
# makeActionCell({ type: 'prompt', model: 'claude-sonnet-4-6', preview: null, payload: null }) → [P] 모델명
# getContextText({ type: 'tool_call', tool_detail: null }) → null 반환
```

### 완료 기준
- [ ] `makeActionCell(r)` 함수가 prompt/tool_call/system 세 타입에서 올바른 HTML 반환
- [ ] `tool_detail` null인 tool_call에서 tool_name만 표시 (오류 없음)
- [ ] `preview`/`payload` 모두 없는 prompt에서 빈 맥락 처리 (오류 없음)
- [ ] `getContextText(r)` 타입별 맥락 텍스트 반환, 없으면 null
- [ ] `typeBadge()`에 `aria-label` 추가됨

---

## T-03: 최근 요청 테이블에 행위 통합 셀 적용

**선행 조건**: T-02 완료 후

### 작업 내용

`makeRequestRow()` 함수에서 기존 타입 셀(`makeTypeCell(r)`)과 툴 셀(`toolLabel(r)`)
두 개의 `<td>`를 `makeActionCell(r)`을 사용하는 단일 `<td>`로 교체한다.
`RECENT_REQ_COLS` 상수를 업데이트하고 관련 colspan을 모두 수정한다.

### 구현 범위

- `packages/web/index.html`:
  - `makeRequestRow()`: 타입+툴 두 `<td>` → 단일 `<td class="cell-action">` 교체
  - `thead` 헤더: "타입" + "툴" 두 `<th>` → "행위" 단일 `<th>` 교체
  - `RECENT_REQ_COLS` 상수: 7 → 6 으로 변경
  - colspan 참조 전수 확인 및 수정:
    - 최근 요청 테이블의 스켈레톤 행
    - 최근 요청 테이블의 빈 상태 행
    - `expandPrompt()` 호출 시 최근 요청 컨텍스트의 colspan
  - type filter 버튼 레이블 유지 (버튼은 r.type 필드로 동작하므로 기능 변경 없음)
  - `tr`에 `data-type="${r.type}"` 어트리뷰트 추가

### 커밋 메시지
```
feat(web): 최근 요청 테이블 행위 통합 셀 적용
```

### 검증 명령어
```bash
bun run dev
# 확인 사항:
# 1. 최근 요청 테이블에 "행위" 컬럼 하나가 표시됨
# 2. prompt: "[P] claude-sonnet-4-6" 형태
# 3. tool_call: "[T] Bash" 형태
# 4. type filter 버튼 동작 정상
# 5. 스켈레톤/빈 상태 행 레이아웃 정상
```

### colspan 전수 수정 체크리스트 (T-03 전용)
```bash
grep -n "colspan\|RECENT_REQ_COLS" packages/web/index.html
```
수정해야 할 위치: 스켈레톤 행, 빈 상태 행, expandTr (최근 요청 컨텍스트)

### 완료 기준
- [ ] "타입" + "툴" 두 컬럼이 "행위" 단일 컬럼으로 표시됨
- [ ] `RECENT_REQ_COLS = 6` 으로 변경됨
- [ ] grep으로 확인한 모든 colspan이 6으로 일치함
- [ ] type filter 기능 정상 작동 (prompt/tool_call/system)
- [ ] 실시간 피드 scroll lock: 신규 행 삽입 후 읽던 위치가 점프하지 않음

---

## T-04: 플랫 뷰에 행위 통합 셀 + tool_call/system 클릭 확장 적용

**선행 조건**: T-02 완료 후

### 작업 내용

`renderDetailRequests()` 함수에서 동일한 통합 셀 적용.
`expandPrompt()` 함수를 `expandContext(tr, r, cols)`로 리팩터링하여
`tool_call`과 `system` 타입의 클릭 확장도 지원한다.
`FLAT_VIEW_COLS` 상수를 업데이트한다.

### 구현 범위

- `packages/web/index.html`:
  - `renderDetailRequests()`: 타입+툴 두 `<td>` → 단일 `<td class="cell-action">` 교체
  - 플랫 뷰 `thead`: "타입" + "툴" → "행위" 교체
  - `FLAT_VIEW_COLS` 상수: 6 → 5 으로 변경
  - `expandPrompt()` → `expandContext(tr, r, cols)` 리팩터링:
    - `getContextText(r)` 사용으로 tool_call/system 맥락도 표시
    - colspan 파라미터를 동적으로 받도록 변경
  - colspan 참조 전수 확인 및 수정:
    - 플랫 뷰 스켈레톤 행
    - 플랫 뷰 빈 상태 행
    - 소계 행(subtotalRow)
    - expandTr의 colspan
  - `tr`에 `data-type="${r.type}"` 어트리뷰트 추가

### 커밋 메시지
```
feat(web): 플랫 뷰 행위 통합 셀 + tool_call/system 클릭 확장 적용
```

### 검증 명령어
```bash
bun run dev
# 확인 사항:
# 1. 플랫 뷰 테이블에 "행위" 컬럼 하나가 표시됨
# 2. tool_call 행 클릭 시 tool_detail 확장됨
# 3. system 행 클릭 시 컨텍스트 확장됨
# 4. prompt 행 클릭 시 기존과 동일하게 promptPreview 확장됨
# 5. 스켈레톤/빈 상태/소계 행 레이아웃 정상
```

### 완료 기준
- [ ] "행위" 단일 컬럼으로 표시됨
- [ ] `FLAT_VIEW_COLS = 5` 으로 변경됨
- [ ] 세 타입 모두 클릭 확장 동작
- [ ] 모든 colspan이 5로 일치함

---

## T-05: 행 좌측 타입 색상 보더 적용

**선행 조건**: T-03, T-04 완료 후

### 작업 내용

모든 로그 행에 타입별 2px 좌측 색상 보더를 추가한다.
CSS만 변경하며, `data-type` 어트리뷰트는 T-03/T-04에서 이미 추가되어 있다.

### 구현 범위

- `packages/web/index.html`:
  - CSS 추가:
    ```css
    tr[data-type="prompt"]    { border-left: 2px solid var(--type-prompt-color); }
    tr[data-type="tool_call"] { border-left: 2px solid var(--type-tool_call-color); }
    tr[data-type="system"]    { border-left: 2px solid var(--type-system-color); }
    ```
  - 기존 `tr:hover`, `tr.row-selected` CSS에서 보더가 덮어쓰이지 않도록 확인

### 커밋 메시지
```
feat(web): 로그 행 좌측 타입 색상 보더 적용
```

### 검증 명령어
```bash
bun run dev
# 확인 사항:
# 1. prompt 행 좌측에 주황색(--type-prompt-color) 보더 표시
# 2. tool_call 행 좌측에 초록색(--type-tool_call-color) 보더 표시
# 3. system 행 좌측에 노란색(--type-system-color) 보더 표시
# 4. hover 시 보더 유지됨
# 5. 행 선택 시 보더 유지됨
```

### 완료 기준
- [ ] 세 타입별 좌측 보더 표시됨
- [ ] hover/selected 상태에서 보더 유지됨

---

## T-06: 턴 뷰 `makeActionCell()` 적용 및 그리드 너비 조정

**선행 조건**: T-02 완료 후

### 작업 내용

`renderTurnView()` 내 프롬프트 행과 도구 행에서 타입/툴 표시 부분을
`makeActionCell()`의 내부 로직과 일관되게 수정한다.
그리드 컬럼 정의에서 두 번째 컬럼(식별자)의 `min-width`를 명시한다.

### 구현 범위

- `packages/web/index.html`:
  - `renderTurnView()` 내 프롬프트 행: `typeBadge(turn.prompt.type)` + 모델명 표시를 `makeActionCell(turn.prompt)` 방식으로 통일
  - `renderTurnView()` 내 도구 행: `toolIconHtml(tc.tool_name) + escHtml(tc.tool_name)` 표시를 `makeActionCell(tc)` 방식으로 통일
  - `.turn-item` CSS: `grid-template-columns: 28px minmax(140px, 1fr) 56px 56px 72px 80px` 로 변경
  - `align-items` 검토: 2줄 셀이 없으므로 `center` 유지 가능

### 커밋 메시지
```
refactor(web): 턴 뷰 makeActionCell 적용 및 그리드 너비 조정
```

### 검증 명령어
```bash
bun run dev
# 확인 사항:
# 1. 턴 뷰에서 프롬프트 행과 도구 행의 식별자 표시가 플랫 뷰와 일관됨
# 2. 그리드 레이아웃이 정상적으로 정렬됨
```

### 완료 기준
- [ ] 턴 뷰의 타입/툴 표시가 플랫 뷰와 시각적으로 일관됨
- [ ] 그리드 너비에 `minmax(140px, 1fr)` 적용됨

---

## T-07: 툴 통계 패널 + 세션 브라우저 여백 최적화

**선행 조건**: T-01 완료 후

### 작업 내용

T-01의 여백 최적화를 좌측 패널(툴 통계, 세션 브라우저)에도 적용한다.
툴 통계 패널의 `tool-cell` 스타일 일관성을 `makeActionCell()`과 맞춘다.

### 구현 범위

- `packages/web/index.html`:
  - 툴 통계 테이블(`#tool-stats-body`): `th`/`td` 패딩을 메인 테이블과 동일하게 적용
  - 세션 브라우저(`#session-tbody`): 패딩 최적화
  - 툴 통계의 `.tool-cell` 렌더링 (`renderTools()`): `.tool-sub`에 overflow 처리 추가

### 커밋 메시지
```
refactor(web): 툴 통계/세션 브라우저 여백 최적화
```

### 검증 명령어
```bash
bun run dev
# 확인 사항:
# 1. 좌측 패널의 행 높이가 메인 테이블과 시각적으로 유사함
# 2. 툴 통계에서 긴 tool_detail이 ellipsis로 잘림
```

### 완료 기준
- [ ] 좌측 패널 여백이 메인 테이블과 일관됨
- [ ] `tool_detail` overflow 처리 적용됨
