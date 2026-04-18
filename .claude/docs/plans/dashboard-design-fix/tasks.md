# Dashboard Design Fix — Tasks

## 목표
대시보드 최근 요청 테이블의 디자인 이슈 6건 수정

## 대상 파일
`packages/web/index.html`

---

## Task A — CSS 단순 수정 (브랜치: fix/dashboard-css)

### A-1: 세션 ID 색상 교정 (#3)
- **위치**: `.sess-id` CSS 선택자
- **현재**: `color: var(--accent)` (#d97757 주황)
- **변경**: `color: var(--text-muted)` (#888)
- **이유**: 보조 식별자에 accent 색상은 시각 위계 왜곡

### A-2: 빈 메시지 셀 cursor 수정 (#4)
- **위치**: `td.cell-msg` CSS 선택자
- **현재**: `cursor: pointer` (td 전체)
- **변경**: 메시지 없을 때만 pointer 제거
- **방법**: `td.cell-msg:has(.cell-msg-empty) { cursor: default; }`
  또는 `td.cell-msg:has(.prompt-preview) { cursor: pointer; }` 로 전환

---

## Task B — 출력 컬럼 + 필터 라벨 (브랜치: fix/dashboard-column)

### B-1: 출력 토큰 컬럼 처리 (#1)
- **현재**: 58px 컬럼, 항상 `—`, title="출력 토큰 (현재 미수집)"
- **변경**: 컬럼 숨김 처리 (`display:none` 또는 완전 제거)
  - colgroup의 해당 col 제거
  - thead의 `출력` th 제거
  - makeRequestRow()의 tokens_output td 제거
  - FLAT_VIEW_COLS = 6 → 5 (단 세션 컬럼 있는 쪽은 RECENT_REQ_COLS = 7 → 6)
- **이유**: 미수집 데이터 컬럼이 가로 공간 낭비 및 사용자 혼란

### B-2: 필터 버튼 라벨 개선 (#5)
- **현재**: `All`, `prompt`, `tool_call`, `system` (영문 소문자)
- **변경**: `All`, `Prompt`, `Tool`, `System` 또는 배지와 매핑 표시 고려
- **이유**: `tool_call` 언더스코어 포함 표현이 어색, 배지 약어와 연결 안 됨

---

## Task C — JS 로직 수정 (브랜치: fix/dashboard-logic)

### C-1: system 타입 행위 셀 식별자 추가 (#2)
- **위치**: `makeActionCell()` 함수 내 system 타입 처리
- **현재**: system 타입은 `[S]` 배지만, identifier/extras 없음
- **변경**: system 타입에 고정 라벨 `"System"` 또는 payload 기반 종류 표시
- **방법**: 
  ```js
  else if (r.type === 'system') {
    identifier = `<span class="action-name action-model">System</span>`;
  }
  ```

---

## Task D — 디자인 결정 필요 (보류)

### D-1: 시각 포맷 차이 (#6)
- **현재 대시보드**: `02:15:33 · 3분 전` (상대시간 포함)
- **현재 플랫뷰**: `02:15:33` (절대시간만)
- **판단**: 의도된 차이로 보임 — 추후 사용자 피드백으로 결정

---

## 완료 기준
- [ ] A-1: sess-id color → text-muted
- [ ] A-2: 빈 셀 cursor 수정
- [ ] B-1: 출력 컬럼 제거, colspan 수정
- [ ] B-2: 필터 버튼 라벨 개선
- [ ] C-1: system 타입 식별자 추가
