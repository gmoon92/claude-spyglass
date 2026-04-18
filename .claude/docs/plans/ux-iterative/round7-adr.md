# Round 7 UX ADR — 턴 뷰 컬럼 정렬 & 타임스탬프 일관성

**날짜**: 2026-04-18  
**참여자**: Geunmyeong(개발), Bora(디자인), Hyunwoo(QA)

---

## 사용 회의 (Round 6 반영 후)

### 관찰된 문제들

**Bora**: "플랫 뷰와 턴 뷰를 번갈아 보면 컬럼이 안 맞아. 플랫 뷰는 테이블이라 `시각/타입/툴/IN/OUT/응답시간` 비율이 있는데, 턴 뷰 자식 행은 `28px 1fr 50px 50px 70px 80px` 하드코딩 CSS grid야. IN/OUT/응답시간 너비가 플랫 뷰 td 너비랑 안 맞아서 시각적으로 다른 뷰처럼 느껴져."

**Hyunwoo**: "턴 뷰 프롬프트 행(turn-row-prompt)이 `border-left: 2px solid var(--accent)`을 쓰는데, 플랫 뷰의 `row-selected` 스타일과 시각적으로 비슷해서 '선택된 행'으로 오해할 수 있어."

**Geunmyeong**: "턴 자식 행 시각 컬럼이 `fmtTime(HH:MM:SS)`을 쓰는데, 플랫 뷰 시각 컬럼은 `fmtDate(MM/DD HH:MM:SS)`야. 전환할 때 포맷이 달라 눈에 걸림."

**Bora**: "툴 통계 테이블의 `평균토큰` 컬럼 헤더가 붙어있는데, 요청 테이블의 `IN/OUT` 컬럼처럼 `text-align:right`가 안 돼 있어. 숫자인데 왼쪽 정렬이라 읽기 어려워."

---

## 결정 사항

### ADR-R7-001: 턴 자식 행 grid 컬럼 조정

**결정**: `.turn-row` CSS grid를 `28px 1fr 56px 56px 72px 80px`으로 조정해 플랫 뷰 컬럼 비율과 근사하게 맞춤.

**이유**: 플랫 ↔ 턴 전환 시 IN/OUT/응답시간 컬럼이 비슷한 위치에 오도록. 완전히 동일할 수 없지만(table vs grid) 근사하게 맞춤.

### ADR-R7-002: 턴 자식 행 시각 포맷 → fmtDate 통일

**결정**: 턴 자식 행의 timestamp 표시를 `fmtTime` → `fmtDate`로 변경.

**이유**: 플랫 뷰와 동일한 `fmtDate` 포맷. 날짜 포함 여부 동일하게.

### ADR-R7-003: 툴 통계 숫자 컬럼 오른쪽 정렬

**결정**: 툴 통계 테이블의 `호출`, `평균토큰` 컬럼 th/td에 `text-align:right` 적용.

**이유**: 숫자 컬럼은 우측 정렬이 정렬을 비교하기 쉬움. 다른 숫자 컬럼(IN/OUT)과 일관성.

### ADR-R7-004: turn-row-prompt border 스타일 구분

**결정**: `.turn-row-prompt`의 `border-left`를 `accent` 대신 `--text-dim` 색상으로 변경.

**이유**: 프롬프트 행이 "선택된 행"처럼 보이지 않도록 구분.
