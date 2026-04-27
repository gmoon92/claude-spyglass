# web-detail-turn — Detail Turn View (W10)

> 세션 상세의 두 번째 탭. accordion 카드 + chip 흐름 + 카드 펼침 시 세부 행 표시. 연속 도구 그룹화 포함.
> 5라운드 누적 인벤토리.

---

## R1 — 1차 작성

### 컨테이너 (`#detailTurnView.detail-content`)

- 자체 스크롤 영역
- 내부: `#turnUnifiedBody` (role="region", aria-label="턴 목록")
- 빈 상태 div (`.turn-card-empty` "로딩 중…" / "턴 데이터 없음")

### Turn Card 카드 (`.turn-card[data-card-turn-id]`)

#### 카드 정렬
- `turn_index` 내림차순 (최신 턴이 위)

#### 카드 상태
- 펼침 상태 (`.expanded` 클래스, `_expandedTurnIds: Set` 관리)
- 세션 전환 시 `_expandedTurnIds.clear()` 자동 초기화

#### 카드 Summary (`.turn-card-summary[data-toggle-card][role="button"][aria-expanded][tabindex="0"]`)

##### Header (`.turn-card-header`)
- `.turn-card-index` "T${turn_index}"
- `.turn-card-preview` 프롬프트 미리보기 (60자 + …)
- `.turn-complexity` 복잡/중간 배지:
  - tool_count > 15 → "복잡" (high)
  - tool_count > 5 → "중간" (mid)
  - 그 외 → 미표시
- `.turn-card-expand-btn` chevron-down SVG (회전 애니메이션)

##### Tool Chip Flow (`.turn-card-flow`)
- 연속 동일 도구 그룹화 후 chip 렌더 (compressContinuousTools)
- 일반 chip: `<span class="tool-chip" style="border-color:${color};color:${color}">${baseName} ×${count}</span>`
- Agent chip (Agent/Skill 계열):
  - `<span class="tool-chip agent-chip" style="border-color:${color};color:${color}" title="${fullLabel}">`
  - `<span class="agent-chip-name">${agentName}</span>` (max-width:10ch ellipsis)
  - `${count > 1 ? × N}`
- 화살표 구분자: `<span class="chip-arrow">-&gt;</span>`

##### Footer (`.turn-card-footer`)
- IN ${tokIn}
- OUT ${tokOut}
- ⏱ ${dur} (duration_ms 있을 때)
- ${barPct}% (`turn-card-bar-pct`, 세션 토큰 비율)

#### 카드 Expanded (`.turn-card-expanded`)

펼침 시 `buildTurnDetailRows(turn)` HTML 삽입:

##### Prompt Row (`.turn-row.turn-row-prompt`)
- 6컬럼 grid (28/1fr/56/56/72/80)
- 빈 span / tool-cell (target + preview) / IN / OUT / duration / time
- target: target-role-badge (`◉ user`)
- preview: contextPreview(80자)

##### Tool Row (`.turn-row.turn-row-tool`)
- 같은 grid 구조
- 첫 span: toolStatusBadge (오류만, 없으면 `&nbsp;`로 공간 유지)
- target: action-name (◉/◎ 아이콘 + 툴명 + 옵션 detail/model)
- sub: contextPreview(60자) + toolResponseHint
- 토큰/시간/타임스탬프

##### Group Row (연속 도구) (`.turn-row.turn-row-group[data-toggle-group]`)
- chevron 아이콘 (회전)
- target: ◉ + 툴명 + ×N 라벨
- 합계 토큰/시간 (count > 1)
- 클릭 시 `.open` 클래스 토글
- 자식: `.turn-row-group-children` 내부에 단일 행들 (renderToolRow 재사용)

#### 정렬 통일 (turn-view-chevron-alignment)
- 모든 행 변종에서 두번째 grid 컬럼 시작 x좌표 = 48px
- margin(16) + border(0~2) + padding(30~32) = 48
- chevron 유무와 무관하게 ◉/•/✓/× 아이콘·이름 수직선 일치

### 카드 펼침/접힘 인터랙션

- 카드 summary 클릭 → `toggleCardExpand(turnId)`
- 키보드 Enter/Space (summary focus 시) → `toggleCardExpand`
- 펼침 시 `aria-expanded="true"`, expanded 클래스 추가, expanded 영역에 `buildTurnDetailRows(turn)` HTML 삽입
- 접힘 시 expanded 영역 innerHTML 비우기

### 추가 인터랙션
- expanded 내부 `[data-toggle-group]` 클릭 → 그룹 .open 토글
- expanded 내부 `[data-expand-id]` 클릭 → prompt 확장 패널 (turn-row 컨테이너에 추가)
- expanded 내부 다른 클릭은 카드 토글로 버블링하지 않음 (이벤트 가드)

### 집계 배지 (W6 detail-agg-badges 갱신)
- `renderTurnCards`에서 갱신:
  - 최고 비용 Turn: T${idx} (token)
  - 최다 호출 Tool: ${name} (count회)

---

## R2 — 검토

1. **카드 빈 상태**: turns가 빈 배열이면 `<div class="turn-card-empty">턴 데이터 없음</div>`. 로딩 중에도 같은 영역에 "로딩 중…".
2. **complexity 임계값**: 5/15. 디자이너 결정 근거 명시 부족.
3. **chip 색상 매핑**: TOOL_COLORS — Agent/Skill orange, Task blue, FS green, Bash orange-light, Search yellow, Web pink, default gray.
4. **Agent chip ellipsis 10ch**: agentName이 길면 잘림. title로 전체 노출.
5. **prompt preview turn 카드**: 60자 (`turn.prompt.preview.slice(0, 60)`). detail flat의 80자와 다름 (R3에서 확인 — 카드 summary는 60자, expanded prompt 행은 80자).
6. **footer 토큰 0 처리**: fmtToken(0) → '—'. IN/OUT 모두 0이면 "IN —" "OUT —".
7. **bar-pct 표시 조건**: sessionTotalTokens > 0일 때만.
8. **expanded 펼침 시 데이터 갱신**: SSE refreshDetailSession 후 expanded 영역도 buildTurnDetailRows로 재생성. _expandedTurnIds Set으로 펼침 상태만 보존.
9. **연속 그룹 정의**: compressContinuousTools — 도구명 + agentName 동일하면 묶음. count/items 추적.
10. **tool chip vs detail row 통일**: fmtActionLabel SSoT (`Name ×count`).
11. **scroll 위치 보존**: renderTurnCards 호출 시 savedScroll 캡처/복원.
12. **prompt 확장 복원**: expandedFor 캡처/복원.
13. **toggleTurn 함수**: 레거시 `[data-turn-id]` (목록 뷰)와 카드 뷰 `[data-card-turn-id]` 둘 다 처리. 카드 있으면 toggleCardExpand 호출.

---

## R3 — R2 반영 + 추가

### 보강

- **complexity 임계값 의미**:
  - 0~5: 미표시 (단순 턴)
  - 6~15: "중간" mid (yellow/orange)
  - 16+: "복잡" high (red)
  - 임계값은 단순 휴리스틱, 디자인 의도 약함
- **카드 정렬 상수 계산**:
  - prompt 행: margin 16 + border 2 + padding 30 = 48px
  - 단독 tool 행: margin 16 + border 0 + padding 32 = 48px
  - 그룹 헤더: margin 16 + border 2 + padding 30 = 48px
  - 그룹 자식 (parent border 적용): 16 + 2 + 30 = 48px
- **연속 그룹 키**: `name + '|' + agentName`. Agent/Skill일 때 agentName 기준으로 분리 — 같은 Agent라도 다른 서브에이전트는 다른 그룹.
- **그룹 합계 토큰/시간**: `sumIn`, `sumOut`, `sumDur` reduce로 합산. count==1이면 단독 행으로 폴백.
- **expanded 영역 내부 클릭 이벤트 분기 (main.js detailView 핸들러)**:
  - `[data-toggle-group]` → 그룹 토글 (event.stopPropagation 효과)
  - `[data-expand-id]` → prompt 확장 (turn-row 컨테이너 기준)
  - 그 외 expanded 내부 클릭 → 버블링 차단 (return; 카드 토글 미동작)
- **세션 전환 시 _expandedTurnIds 클리어**: loadSessionDetail에서 호출.
- **SSE 갱신 후 펼침 보존**: _expandedTurnIds Set 기반 — 갱신 후에도 expanded 클래스 자동 적용.

### 추가 인터랙션

- **카드 hover 효과**: 정의 미확인 (CSS 검토 필요).
- **chip hover**: title 속성으로 fullLabel 표시. 별도 hover 효과 없음.
- **카드 키보드 Enter/Space**: summary tabindex=0 + role=button + aria-expanded — 접근성 의도 반영됨.
- **그룹 chevron 회전**: `.open` 클래스 시 SVG 90도 회전.
- **그룹 자식 펼침 애니메이션**: `.turn-row-group-children`이 max-height/opacity 전환 (CSS 확인 필요).

---

## R4 — 검토 (미세·키보드·에러·상태 전이)

1. **카드 키보드 접근성 ✅**: tabindex=0, role="button", aria-expanded, Enter/Space 처리. **양호한 부분**.
2. **그룹 토글 키보드**: `[data-toggle-group]`에 tabindex/role 부재. 키보드 토글 불가.
3. **prompt 확장 패널 키보드**: `[data-expand-id]`에 tabindex/role 부재.
4. **카드 ARIA**: aria-expanded ✅, aria-controls 부재 (expanded 영역과 연결 명시 안 됨).
5. **chip 색상 인라인 style**: tool-chip border/color CSS 변수 토큰 미사용. CSS 토큰화 후보.
6. **complexity 배지 의미 부족**: "복잡"/"중간" 텍스트만, 임계값/근거 툴팁 없음.
7. **chip-arrow 텍스트 "->"**: HTML escape `-&gt;`. 시각 위계 약함 (단순 텍스트).
8. **chip overflow**: 도구가 많으면 chip-flow가 가로로 길어짐. wrap 정책 미확인. 좁은 폭에서 가로 스크롤?
9. **footer 토큰 단위 일관성**: IN/OUT/⏱ /비율% — 단위 표기 혼재.
10. **bar-pct 표시 시각**: 단순 텍스트. 시각적 막대 부재 (Footer 좁아서 생략).
11. **빈 chip flow**: tool_calls 없으면 `<div class="turn-card-flow">` 자체 미표시 (`chips ? ... : ''`). 빈 영역 안 생김 — 의도된 처리.
12. **카드 hover 효과 명세 부족**.
13. **SSE 인플레이스 vs 전체 갱신**:
   - W10은 refreshDetailSession 호출 시 renderTurnCards 전체 호출 (innerHTML 교체).
   - 펼침 상태/스크롤 보존.
   - 카드 깜박임 가능 — 빈번한 SSE 도착 시.
14. **빈 데이터 + 검색 적용**:
   - turn 뷰는 검색어 미적용 (W8 컨트롤은 flat에만)
   - 사용자가 검색하면 flat은 필터링되지만 turn은 그대로 — 비일관.
15. **그룹 펼침 상태**: open 클래스 토글. 영속화 부재 (세션 전환 시 모두 초기화).
16. **complexity 배지 색**: high/mid 색 — CSS 확인 필요. 토큰화 안 되어 있을 가능성.

---

## R5 — R4 반영 + 최종 추가

### 추가된 미세·접근성·상태 전이

- **그룹 토글 키보드 부재**: `[data-toggle-group]` 클릭만, Enter 불가.
- **prompt-preview Enter 부재**.
- **aria-controls 부재**: 카드 summary와 expanded 연결 미명시.
- **chip 색상 CSS 토큰화 부재**: 인라인 style — 다크/라이트 전환 시 stale 가능.
- **chip-flow wrap 정책**: 좁은 폭에서 어떻게 동작하는지 확인 필요. flex-wrap 또는 가로 스크롤?
- **complexity 임계값 (5/15) 디자인 근거 약함**:
  - 가능 후보: 평균 + 표준편차 기반, 또는 사용자 설정 가능
- **complexity 배지 색 CSS 토큰화 부재**.
- **chip-arrow `->` 텍스트**: 시각적으로 약함 — 화살표 SVG로 대체 후보.
- **Agent chip ellipsis 10ch 고정**: 좁은 폭에서 더 줄이거나 가변 처리 미지원.
- **footer 4종 정보의 시각 위계 부재**:
  - IN/OUT/⏱/% 동일 무게로 나열
  - 핵심 지표(예: 토큰 비율)와 보조 지표 구분 없음
- **카드 hover 효과 명세 부족** — Phase 2 보강 후보.
- **SSE 갱신 시 카드 깜박임**: refreshDetailSession 빈도 높을 때 사용자 인지.
- **검색어가 turn 뷰에 적용 안 됨** (W8에서 지적, 여기서도 발견).
- **세션 전환 시 그룹 .open 상태 초기화**: 의도된 동작이지만 사용자 멘탈 모델과 충돌 가능.
- **expanded 내부 너비 정책**: detail grid 28/1fr/56/56/72/80px = 364px 고정 + 1fr. 가로 스크롤이 발생할지 확인 필요.
- **단독 행 vs 그룹 행 시각 위계**:
  - 단독: chevron 없음, 빈 span으로 공간 유지
  - 그룹: chevron 있음, 펼치면 자식 동일 grid
  - 차이 시각이 약함 (chevron 회전 외) — 디자이너 피드백 "덩어리 부재"의 직접 후보
- **`turn-row-group-children` 펼침 애니메이션**: CSS 확인 필요 (max-height 전환?).
- **prompt 확장 패널 turn-row 컨테이너 안에서**: 행 아래 `<div data-expand-for>` 삽입. grid 콘텐츠로 들어가 grid 컬럼 위반 가능 (`grid-column: 1/-1` 인라인 스타일로 보정).

### 키보드 단축키 (현재 부재 또는 부분)

| 의도 | 현재 |
|------|------|
| 카드 ↑↓ 이동 | 없음 |
| 카드 Enter/Space 토글 | ✅ 있음 |
| 그룹 Enter 토글 | 없음 |
| 모든 카드 펼치기/접기 | 없음 |
| prompt 확장 Enter | 없음 |

---

## 최종 기능 개수 (W10)

- 컨테이너: 1개
- 빈 상태: 2개 (로딩/empty)
- 카드 정렬 (turn_index 내림차순): 1개
- _expandedTurnIds Set 관리: 1개
- 카드 Summary
  - Header: index/preview/complexity(2종)/expand-btn = 5개
  - Tool Chip Flow: 일반 chip / Agent chip / chip-arrow / overflow = 4개
  - Footer: IN/OUT/⏱/% = 4개
- 카드 Expanded
  - Prompt Row: 6컬럼 grid + target/preview = 2개
  - Tool Row: status/target/preview+hint/토큰/시간/timestamp = 6개
  - Group Row: chevron/target/×N 라벨/합계/자식 컨테이너 = 5개
  - 정렬 통일 48px: 1개
- 인터랙션
  - 카드 클릭 토글: 1개
  - 카드 키보드 Enter/Space: 1개
  - 그룹 토글: 1개
  - prompt 확장 (data-expand-id): 1개
  - expanded 내부 버블링 차단: 1개
- 집계 배지 (W6 갱신): 2개
- complexity 임계값 5/15: 1개
- compressContinuousTools SSoT: 1개
- fmtActionLabel SSoT: 1개
- TOOL_COLORS 7종: 1개
- 스크롤/확장 보존: 1개

총 **약 42개 기능**.

## 발견된 누락·모호 (Phase 2 입력)

1. 그룹 토글 키보드 부재 (data-toggle-group 비활성)
2. prompt-preview/data-expand-id 키보드 부재
3. aria-controls 부재 (카드 summary와 expanded 영역 연결)
4. chip 색상 CSS 토큰화 부재 (인라인 style)
5. complexity 임계값 (5/15) 디자인 근거 약함
6. complexity 배지 색 토큰화 부재
7. chip-arrow 단순 텍스트 "->" 시각 위계 약함
8. Agent chip ellipsis 10ch 고정 (반응형 부재)
9. footer 4종 정보 시각 위계 부재
10. 카드 hover 효과 명세 부족
11. 검색어가 turn 뷰에 적용 안 됨 (W8과 비일관)
12. chip-flow wrap 정책 미확인 (좁은 폭 처리)
13. SSE refreshDetailSession 시 깜박임 가능
14. 그룹 .open 상태 영속화 부재 (세션 전환 시 초기화)
15. 단독 행 vs 그룹 행 시각 위계 약함 ("덩어리 부재" 직접 후보)
16. expanded 내부 grid가 너무 좁아 가로 스크롤 가능
