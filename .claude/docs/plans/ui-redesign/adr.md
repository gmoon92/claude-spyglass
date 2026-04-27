# ui-redesign ADR

> Feature: ui-redesign — Phase 2 디자인 재설계
> 작성일: 2026-04-23

각 ADR은 디자이너 피드백 4종("숨막힘 / 어디 봐야 할지 모르겠음 / 그룹핑 부재 / AI같음")과 `phase-1-inventory/inventory.md` R3 우선순위 18개에 직접 답한다.

---

## ADR-001: 3-Tier Visual Hierarchy 도입 (메타 원칙)

### 상태
**결정됨** (2026-04-23)

### 배경
디자이너 피드백 "어디 봐야 할지 모르겠다" — 모든 요소가 동등한 무게. 9개 stat-card, 4개 footer 메트릭, 7개 type filter 모두 같은 폰트 굵기·크기.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | 컴포넌트별 ad-hoc 위계 | 자유로움 | 일관성 부재, 다시 산만 |
| B | 3-Tier 시스템 (Primary/Secondary/Tertiary) | 메타 SSoT, 적용 일관 | 모든 컴포넌트 영향 |
| C | 5-Tier 세분화 | 표현력 | 복잡 |

### 결정
**옵션 B — 3-Tier 시스템.**

- **Primary (Hero)**: 시선 첫 진입점. 한 영역에 1~2개. 18~24px, weight 600+, 강조색.
- **Secondary**: 컨텍스트 보조 정보. 13px, weight 500, `--text`.
- **Tertiary**: 참조 정보. 11px, weight 400, `--text-muted`/`--text-dim`.

CSS 변수로 토큰화: `--font-hero / --font-major / --font-body / --font-meta` + `--weight-hero / --weight-strong / --weight-normal`.

### 이유
1. 모든 후속 ADR(W2/W10/W12 등)이 이 토큰을 재사용하므로 SSoT 효과.
2. 같은 카드 안에서 위계가 보여야 사용자 시선이 자연스럽게 흐른다.
3. 디자이너 피드백 4종 중 3종(숨막힘/진입점/AI같음)에 직접 답한다.

---

## ADR-002: Spacing Scale (8px Grid 강제)

### 상태
**결정됨** (2026-04-23)

### 배경
디자이너 피드백 "숨막힌다" 직접 후보. 현재 padding/margin 값이 4-6-8-10-12-16-32px 혼재 — 모든 컴포넌트가 자기 마음대로 간격을 정함. 좁아 보이는 원인.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | 자유 (현행) | 미세 조정 | 일관성 0 |
| B | 4px Grid | 세밀 | 너무 빽빽 |
| C | 8px Grid | 표준, 호흡 | 일부 컴포넌트 재조정 필요 |

### 결정
**옵션 C — 8px Grid.**

CSS 변수:
```css
--space-1: 4px;   /* 인라인 미세 (배지 padding) */
--space-2: 8px;   /* 기본 단위 */
--space-3: 12px;  /* 행 간격 */
--space-4: 16px;  /* 섹션 내부 padding */
--space-5: 24px;  /* 섹션 간 간격 */
--space-6: 32px;  /* 카드 간 간격 */
```

기존 4-6-8-10-12-16-32 모두 위 토큰으로 매핑. 인라인 px는 점진적으로 토큰 교체.

### 이유
1. "숨막힘"은 padding 부족 이상으로 _불규칙_이 원인. 8px 그리드로 리듬 부여.
2. 모든 컴포넌트가 같은 간격 토큰을 쓰면 시각적 호흡 일관.
3. Linear, Vercel, Raycast 등 표준 따름.

---

## ADR-003: Card Container System (그룹핑 SSoT)

### 상태
**결정됨** (2026-04-23)

### 배경
디자이너 피드백 **"그룹핑 된 덩어리가 없다"** — 핵심 지적. 화면이 서로 분리된 덩어리로 보이지 않고 평면 나열.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | 기존 `.view-section` 유지 | 변경 최소 | 시각 분리 약함 |
| B | `.card` 컴포넌트 신규 + 기존 영역 감싸기 | 즉각 그룹핑 효과 | CSS 추가 |
| C | 모든 영역에 border 추가 | 단순 | 시각 무거움 |

### 결정
**옵션 B — `.card` 컴포넌트 신규.**

```css
.card {
  background: var(--surface);          /* layered dark */
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 8px);
  padding: var(--space-4);
}
.card-header { /* 카드 상단 라벨 영역 */ }
.card-body   { /* 본문 */ }
```

대상 영역:
- W4 Chart Strip → `.card`로 감쌈
- W5 Default View 피드 → `.card`
- W6 Detail Header + W7 Context Chart → `.card`
- W8 Tab Bar/Controls + 콘텐츠 → `.card`
- W12 Tools Matrix → `.card`

좌측 패널 섹션은 이미 시각 분리됨 — 추가 카드 적용 안 함.

### 이유
1. 디자이너 피드백 "덩어리 부재"의 직접 답. surface 배경 + border로 명확한 경계.
2. card-header/body 패턴이 모든 큰 영역에 일관 적용.
3. Layered dark theme 원칙 (Dark Mastery — bg/surface/surface-alt 3층).

---

## ADR-004: Typography Scale (위계 강화)

### 상태
**결정됨** (2026-04-23)

### 배경
ADR-001 3-Tier 원칙의 구체 수치. 현재 폰트 사이즈 9-10-11-12-13-15px 무작위 분포.

### 결정
**4단계 사이즈 + 3단계 굵기**:

```css
--font-hero:   24px;  /* Primary 메트릭 (활성 세션 수, 오류율 등) */
--font-major:  18px;  /* 카드 헤드라인 / 섹션 라벨 강조 */
--font-body:   13px;  /* 본문 (테이블 셀, 카드 내용) */
--font-meta:   11px;  /* 미리보기, 힌트, 사이드 정보 */
--font-micro:   9px;  /* 컬럼 헤더, 초소형 라벨 */

--weight-hero:   700;  /* Primary 강조 */
--weight-strong: 600;  /* Secondary 강조 */
--weight-normal: 400;  /* 본문 */
```

### 이유
1. 4단계만 허용 → 위계 결정이 단순해짐.
2. body 13px / meta 11px 차이가 "정보 우선순위"를 명확히 시각화.
3. 24px Hero가 시선 진입점 역할 — 디자이너 피드백 "어디 봐야할지" 직접 답.

---

## ADR-005: Summary Strip — Hero Metrics 재구성 (W2)

### 상태
**결정됨** (2026-04-23)

### 배경
9개 stat-card 평면 나열. 활성 세션과 오류율 같은 핵심 지표가 비용/절감과 같은 무게.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | 9카드 유지 + 위계 토큰만 | 변경 최소 | 시각 평면 그대로 |
| B | Hero 1~2 + 보조 그룹 2개 (3섹션) | 명확 위계 | 카드 수 줄여야 함 |
| C | 상단 Hero 1행 + 보조 2행 | 정보량 보존 | 높이 2배 |

### 결정
**옵션 B — 3섹션 재구성.**

```
┌─────────────────────────────────────────────────────────────┐
│ [HERO]                  │ [PERFORMANCE]   │ [VOLUME/COST]  │
│ 활성 N · 오류 X.X%      │ 평균 P95         │ 세션 요청 토큰 │
│ (Hero 24px primary)     │ (Body 13px)     │ (Body 13px)    │
│                         │                 │ 비용 절감 (sub)│
└─────────────────────────────────────────────────────────────┘
```

- **Hero 그룹**: 활성 세션 + 오류율 (24px, primary 색)
- **Performance 그룹**: 평균 응답 + P95 (13px, secondary)
- **Volume/Cost 그룹**: 세션/요청/토큰 + 비용/절감 (13px + 11px sub)
- 각 그룹 사이 `.stat-divider` 구분선

### 이유
1. 활성/오류는 "지금 시스템이 정상인가"의 핵심 — Hero 자격 충분.
2. 시선이 좌→우로 가면서 Hero → 컨텍스트 → 누적 합계 흐름.
3. 디자이너 피드백 "어디 봐야할지" 직접 답.

---

## ADR-006: Type Filter Grouping (W5/W8)

### 상태
**결정됨** (2026-04-23)

### 배경
7개 평면 필터 버튼: All / prompt / Agent / Skill / MCP / tool_call / system. 의미론적으로 [요청 종류]와 [도구 분류]가 섞임.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | 7개 평면 (현행) | 단순 | 그룹 모호 |
| B | 2그룹 + 시각 분리 (border) | 의미 명확 | 약간 복잡 |
| C | 드롭다운 | 컴팩트 | 발견성 저하 |

### 결정
**옵션 B — 2그룹 시각 분리.**

```
[All]  |  [prompt] [system]  |  [tool_call] [Agent] [Skill] [MCP]
        ↑ 요청 종류            ↑ 도구 분류 (tool_call 하위)
```

`.type-filter-btns` 안에 `.filter-group` div 2개 배치. 사이에 `border-left` 구분선. CSS 변수 `--space-3`로 그룹 간 간격.

### 이유
1. prompt/system은 사용자 입력·시스템 메시지 — "요청 종류".
2. tool_call/Agent/Skill/MCP는 도구 실행 분류 — Agent/Skill/MCP는 tool_call의 하위.
3. 그룹 분리만으로 사용자 멘탈 모델 명확화.
4. 디자이너 피드백 "그룹핑 부재" 직접 답.

---

## ADR-007: Tools Matrix View (W12 단일 매트릭스)

### 상태
**결정됨** (2026-04-23)

### 배경
현재 W12는 3섹션(평균/호출/토큰) 분산 — 같은 도구가 다른 위치에 등장. 비교 어려움. 디자이너 피드백 "덩어리 부재" 직접 후보.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | 3섹션 유지 | 변경 없음 | 비교 어려움 |
| B | 1행 1도구 + 3컬럼 + 정렬 토글 | 비교 즉시, 그룹화 강함 | 레이아웃 재작성 |
| C | 탭 전환 (응답/호출/토큰) | 단순 | 동시 비교 불가 |

### 결정
**옵션 B — 매트릭스 뷰.**

```
┌─────────────────────────────────────────────────────┐
│ Tool      │ Avg     │ Calls │ Tokens │ %     │ Err │
├───────────┼─────────┼───────┼────────┼───────┼─────┤
│ ◉ Bash    │ 1.2s    │  45   │ 12.3K  │ 23%   │  2  │
│ ◉ Read    │  340ms  │  82   │  8.1K  │ 15%   │  —  │
│ ◎ Agent   │ 4.5s    │  12   │ 32K    │ 60%   │  1  │
└───────────┴─────────┴───────┴────────┴───────┴─────┘
정렬: [Avg] [Calls] [Tokens]   ← 토글 버튼
```

- 각 도구 1행, 6컬럼 (도구/평균/호출/토큰/%/오류)
- 정렬 토글 버튼 3종 (active 시 컬럼 헤더 강조)
- 막대 그래프는 컬럼 셀 내부에 inline (가는 막대)
- 도구 아이콘은 `toolIconHtml()` SSoT 재사용

### 이유
1. 한 도구의 모든 지표를 한 줄에서 비교 가능 — 강한 그룹핑.
2. 정렬 토글로 W4 Donut 같이 다관점 보존.
3. 도구 아이콘 + 색상 토큰 재사용으로 시각 일관.

---

## ADR-008: Turn Card Hierarchy 강화 (W10)

### 상태
**결정됨** (2026-04-23)

### 배경
turn 카드 펼침 시 단독 행과 그룹 행의 시각 차이가 chevron 유무뿐. "덩어리 부재" 후보.

### 결정

1. **그룹 행 시각 분리**:
   ```css
   .turn-row-group {
     background: var(--surface-alt);   /* 단독은 surface, 그룹은 alt */
     border-left: 2px solid var(--accent-border);
   }
   .turn-row-group-children {
     background: var(--white-bg-subtle);  /* 자식은 더 옅은 강조 */
     border-left: 2px solid var(--accent-border);
   }
   ```
2. **chip-arrow를 SVG로**:
   ```html
   <svg class="chip-arrow" width="10" height="10">
     <path d="M3 5 L7 5 M5 3 L7 5 L5 7" stroke="currentColor" />
   </svg>
   ```
3. **카드 footer 위계 (ADR-001/004 적용)**:
   - IN/OUT (Tertiary 11px text-dim)
   - ⏱ duration (Body 13px)
   - 토큰 % (Hero 18px, accent) — 시선 진입점

4. **complexity 배지 색 토큰화**:
   ```css
   .turn-complexity.high { background: var(--red-bg-light); color: var(--red-text); }
   .turn-complexity.mid  { background: var(--yellow-bg-light); color: var(--type-system-color); }
   ```

### 이유
1. 그룹은 "여러 행을 묶은 덩어리"임을 background 차이로 즉시 인식.
2. chip-arrow SVG는 텍스트 `->`보다 시선 흐름 명확.
3. footer % Hero 강조로 "이 턴이 전체 토큰의 몇 %인가"가 첫 시선.

---

## ADR-009: State SSoT — Empty / Loading / Error

### 상태
**결정됨** (2026-04-23)

### 배경
빈 상태 텍스트 5종 분산: "데이터 없음" / "요청 데이터 없음" / "턴 데이터 없음" / "tool_call 데이터 없음" / "프로젝트 없음". 로딩도 "로딩 중…" / "Loading..." / skeleton 혼재. 에러는 silent ~ 빨간 텍스트 ~ 배너 분산.

### 결정

CSS 클래스 신규 (`state.css`):
```css
.state-empty   { /* 빈 상태 — 큰 영역 + 안내 텍스트 */ }
.state-loading { /* 로딩 — skeleton 또는 미니멀 spinner */ }
.state-error   { /* 에러 — 빨간 텍스트 + 재시도 버튼 */ }
```

텍스트 한국어 통일 (현재 사용 환경 기준):
- 빈 상태: `데이터가 없습니다`
- 로딩: skeleton (텍스트 미사용)
- 에러: `로드 실패 — 다시 시도`

JS 헬퍼:
```js
// state.js (신규)
export function emptyState(msg = '데이터가 없습니다') { ... }
export function errorState(msg, retryFn) { ... }
```

기존 빈 메시지 호출처 모두 위 헬퍼로 교체.

### 이유
1. SSoT로 통합 → 텍스트 톤 일관.
2. 디자이너 피드백 "AI같음" — 비일관 텍스트가 직접 원인.
3. 향후 빈 상태 일러스트레이션·아이콘 추가 시 한 곳만 수정.

---

## ADR-010: Diagnostic Bug Fixes (closeDetail / AlertBanner / maxTokens)

### 상태
**결정됨** (2026-04-23)

### 배경
Phase 1에서 발견한 잠재 버그 3종.

### 결정

#### A-1. closeDetail 핸들러 등록
- `main.js initEventDelegation()`에 `#btnCloseDetail` 클릭 리스너 추가
- `closeDetail()` 함수 정의: `setSelectedSession(null) + uiState.rightView='default' + renderRightPanel()`

#### A-2. AlertBanner TUI 노출
- `app.tsx`에서 `useAlerts` hook 호출
- Header 위 또는 TabBar 아래에 `<AlertBanner level alert />` 배치
- normal 레벨일 때는 미세하게 (1줄 "🟢 Normal"), warning/critical은 색 강조
- A 키 (Ack) 핸들러 useKeyboard에 추가 — onAlertAck 콜백

#### C-1. TUI maxTokens 200K 변경
- LiveTab.tsx `MAX_TOKENS = 200_000` 상수로 추출 (현재 100K hardcoded)
- 추후 SettingsTab의 critical 임계값 연동은 별도 task

### 이유
1. closeDetail 누락은 사용자 동선 끊는 명백한 버그.
2. AlertBanner 정의-노출 분리는 죽은 코드.
3. maxTokens는 Claude 모델 표준 한도.

---

## ADR-011: Anomaly Layer 일관화

### 상태
**결정됨** (2026-04-23)

### 배경
spike/loop/slow 배지가 W5만 적용, W9 미적용, W10/W11 부분만 적용. 일관성 부재.

### 결정

1. **W9 Detail Flat View에 anomaly 적용**:
   - `applyDetailFilter()` 안에서 `_detailRequestAnomalyMap` 빌드 (이미 turn 단위 빌드 코드 재사용)
   - `renderDetailRequests(list)` → `renderDetailRequests(list, anomalyMap)`

2. **W5 prependRequest 시 anomaly 즉시 반영**:
   - SSE 도착 → 새 요청을 `_detailAllRequests` 또는 글로벌 list에 추가
   - `detectAnomalies` 재호출 (전체)
   - prependRequest의 새 행에 mini-badge 추가

3. **anomaly Helper 분리**:
   - `anomaly.js`에 `applyAnomalyBadgesToRow(rowEl, flags)` 추가
   - 모든 뷰에서 같은 함수 호출

### 이유
1. 사용자가 어느 뷰에 있든 동일하게 anomaly 인지.
2. 헬퍼로 추출하면 미래 새 뷰 추가 시도 자동 적용.

---

## ADR-012: Keyboard Shortcuts Layer (단계적 도입)

### 상태
**결정됨** (2026-04-23)

### 배경
키보드 단축키 전반 부재. 행 ↑↓ Enter, ESC 닫기, Tab ←→, 1~7 필터, /, ?, Cmd/Ctrl+F 모두 부재.

### 결정 — 1차 도입 단축키 (Phase 2 범위)

| 키 | 동작 |
|----|------|
| `?` | 도움말 모달 토글 |
| `ESC` | 우선순위 순으로 닫기: 모달 → 확장 패널 → 검색 클리어 → detail 닫기 |
| `/` | 검색창 포커스 (현재 active 뷰의 검색) |
| `1~7` | 타입 필터 (active 뷰의 typeFilterBtns 순서) |
| `Cmd/Ctrl+F` | 검색창 포커스 (브라우저 기본 가로채기) |

행 ↑↓ Enter는 2차 (이번 PR 범위 외) — 영향 범위 큼.

### 구현 위치
- `main.js initKeyboardShortcuts()` 신규 함수
- 도움말 모달 — `index.html` 신규 dialog + `keyboard-help.css`

### 이유
1. ESC 일관 동작은 사용자 멘탈 모델 회복.
2. ?로 도움말은 발견성 핵심.
3. 점진적 도입 — 1차 5종으로 핵심 시작.

---

## ADR-013: TUI Information Architecture 재정렬

### 상태
**결정됨** (2026-04-23)

### 배경
TUI 5개 컴포넌트 누락 사항: Sidebar selectedId 미전달, AlertBanner 미사용, maxTokens hardcoded, Top Requests 점프 부재, 빈 상태 텍스트 분산.

### 결정

#### T1 Layout/Sidebar
- `app.tsx`에서 `selectedSessionId` state 추가
- HistoryTab의 onSessionSelect callback이 setSelectedSessionId 호출
- Sidebar `selectedId` prop 전달 — 선택된 세션 시각 강조 ✅

#### T1 AlertBanner
- ADR-010 A-2와 통합 — Header 위 1줄 배치
- normal일 때 conditional rendering (`level !== 'normal' && <AlertBanner />`)

#### T2 LiveTab
- ADR-010 C-1 적용 — MAX_TOKENS 200K
- Recent Requests 행 키보드 ↑↓는 2차 (이번 PR 범위 외)

#### T4 Analysis Top Requests
- 행 Enter로 세션 점프 — `useInput`에서 selectedIndex Enter 시 `onSessionSelect(req.session_id)` 콜백
- app.tsx에서 콜백 받아 setActiveTab('history') + 세션 선택

#### 공통 빈 상태
- TUI 모두 한국어 통일 — `데이터가 없습니다` (영문 "No sessions found." 등 교체)

### 이유
1. Web ADR-009와 동일 정책 — 텍스트 톤 일관.
2. Sidebar selectedId는 단순 prop 전달로 즉시 해결.
3. Top Requests Enter 점프는 발견 → Action 흐름 회복.

---

## ADR-014: localStorage Prefix 통일 (`spyglass:`)

### 상태
**결정됨** (2026-04-23)

### 배경
5개 키 중 3개만 `spyglass:` prefix:
- `spyglass:lastProject` ✅
- `spyglass:panel-width` ✅
- `spyglass:chart-collapsed` ✅
- `left-panel-hidden` ❌
- `left-panel-state` ❌

### 결정

모든 키 `spyglass:` 강제:
- `left-panel-hidden` → `spyglass:left-panel-hidden`
- `left-panel-state` → `spyglass:left-panel-state`

마이그레이션 헬퍼 (`persistence.js` 신규):
```js
function migrateKey(oldKey, newKey) {
  const v = localStorage.getItem(oldKey);
  if (v != null && localStorage.getItem(newKey) == null) {
    localStorage.setItem(newKey, v);
    localStorage.removeItem(oldKey);
  }
}
```
초기 init 시 1회 호출 — 기존 사용자 설정 보존.

### 이유
1. prefix 일관 → 미래 다른 도구와 키 충돌 방지.
2. 마이그레이션 헬퍼로 사용자 설정 보존.

---

## ADR-015: 가격 정책 옵션 2 — UI에서 USD 표시 전면 제거

### 상태
**결정됨** (2026-04-23)

### 배경
data-engineer가 `_deprecated_cost_fields` 메타로 가격 환산 필드를 deprecated 처리. 신규 메트릭 API는 가격 미노출. designer는 토큰 단위만 사용해야 함.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| 1 | $ 표시 유지 + deprecated 무시 | 변경 없음 | 정합성 잃음 |
| 2 | $ 표시 전면 제거 + 토큰 환산 | data-engineer 의도 일치, 단순화 | 사용자가 비용 직관 잃음 |
| 3 | $ 옵션을 SettingsTab으로 이동 | 사용자 선택 | UI 복잡도 |

### 결정
**옵션 2 — UI에서 USD 표시 전면 제거.**

대상 변경:
- **Cache Intelligence Panel** (`cache-panel.js`):
  - `cacheCostWithout/Actual/Saved` $ 텍스트 → 토큰 단위로 라벨/값 모두 변경
  - "without cache" → "no cache" + 비캐시 input 토큰 합 (`total_input + cache_create + cache_read`)
  - "actual cost" → "actual" + 실제 LLM 입력 토큰 (`total_input + cache_create`, cache_read 제외)
  - "saved" → "saved" + 캐시로 절감된 토큰 (`cache_read`) + 절감률
- **Summary Strip** (`index.html`):
  - 비용/절감 카드 (`#stat-cost`/`#stat-cache-savings`) 제거
  - "Volume·Cost" 그룹 → "Volume" 그룹으로 변경 (세션/요청/토큰만)
- **api.js fetchDashboard**:
  - `costUsd` / `cacheSavingsUsd` 사용 코드 제거 (변수만 안 읽고 stat 카드 텍스트 갱신 코드 삭제)
- **stat-tooltip.js / cache-panel-tooltip.js**:
  - $ 언급 모두 제거 → 토큰 기반 설명으로 변경

### 이유
1. data-engineer 의도(api-spec.md §10) 정확히 따름
2. 토큰은 모든 사용자에게 일관된 단위, 가격은 사용자/플랜별로 다름
3. Summary Strip 단순화로 Hero/Volume 두 그룹 구조 명확화 → 디자이너 피드백 "위계" 강화

---

## ADR-016: 시각 지표 8종 배치 — 영역 재활용 + Insights 카드 1개 신규

### 상태
**결정됨** (2026-04-23)

### 배경
사용자 요청: **영역을 추가로 도출하지 말고 시각 영역 재활용**. 그러나 8종은 chartSection 1개에 다 들어가지 않음. 균형이 필요.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | 8개 카드 모두 신규 | 명확 분리 | 사용자 의도 위배, 과밀 |
| B | 모두 chartSection에 모드 토글 | 영역 0 추가 | 토글 누적, 정보 발견 어려움 |
| C | 기존 영역 재활용 + Insights 카드 1개 신규 | 균형, 사용자 의도 보존 | 카드 1개는 추가 |
| D | 별도 페이지 (Analysis 탭) | 동선 분리 | 발견성 약함, 페이지 전환 cost |

### 결정
**옵션 C — 기존 영역 재활용 우선 + Insights 카드 1개 신규.**

#### 배치 매핑

| # | 지표 | 배치 위치 | 변환 방식 |
|---|------|-----------|-----------|
| 1 | 모델 사용량 비율 | chartSection donut | 모드 토글 (전역 type / 모델별 / 세션 type) |
| 2 | 모델별 캐시 매트릭스 | chartSection cache-panel | 모드 토글 (전체 / 모델별 매트릭스) |
| 7 | Tool 카테고리 분포 | left-panel `#panelTools` | 헤더에 "도구 / 카테고리" 토글 추가 |
| 3 | 컨텍스트 사용률 분포 | **신규 Insights 카드** | 4-bin 가로 막대 |
| 4 | 시간대 heatmap | **신규 Insights 카드** | 7×24 그리드 |
| 5 | turn 분포 + Compaction | **신규 Insights 카드** | 5-bin 막대 + 큰 % 메트릭 |
| 6 | 에이전트 깊이 분포 | **신규 Insights 카드** | 3-그룹 요약 막대 |
| 8 | Anomaly 시계열 | **신규 Insights 카드** | 누적 막대 (시간 버킷) |

#### Insights 카드 구조

- 위치: chartSection 아래, content-switcher 위 (default 모드 전용 — detail 진입 시 hidden)
- 카드 헤더: "Insights" + range 토글 (24h / 7d / 30d) + 접기 토글 (영속화 `spyglass:insights-collapsed`)
- 카드 본문: CSS Grid 2열 (좁은 폭 1열) — 5개 sub-tile
  - 행 1: heatmap (2열 차지)
  - 행 2: 컨텍스트 사용률 + turn 분포 (각 1열)
  - 행 3: agent depth + anomaly 시계열 (각 1열)

각 sub-tile은 `.insight-tile` 클래스 (작은 sub-card 변종 — Card SSoT 변형). 헤더 라벨 + canvas/grid 본문 + 옵션 sub 메타.

#### chartSection donut 모드 토글

3개 모드:
- **전역 type 분포** (default, 기존)
- **모델 사용량** (`/api/metrics/model-usage`)
- **세션 type 분포** (detail 모드 진입 시 자동 활성, 클라이언트 계산)

토글: 도넛 라벨 옆 작은 모드 버튼 (`Type / Model` segment).

#### chartSection cache-panel 매트릭스 모드

cache-panel 우측 상단에 작은 토글: "전체 / 모델별". 모델별 모드 시:
- panel 내용이 모델별 가로 막대 (read/create/no-cache 3색 stack) + hit_rate 텍스트로 변경
- 각 모델 행: `model_name` (좌) | stacked bar (중) | hit_rate % (우)

#### Tool 카테고리 토글

`#panelTools` 헤더의 "툴 통계 (전체)" 옆에 작은 토글:
- "도구별" (기본, 기존 tool name 통계)
- "카테고리별" (FileOps/Search/Bash/MCP/Agent/Other 6 카테고리)

토글 시 tbody 재렌더. 카테고리는 toolIconHtml SSoT 사용 + 카테고리별 색상 매핑.

### 이유
1. 사용자 의도 "영역 추가 X" 최대 존중 — 신규 영역 1개 (Insights)로 최소화
2. 도넛/cache-panel 모드 토글로 정보 밀도 증가 (같은 공간에 더 많은 시각 차원)
3. Tool 카테고리는 left-panel 툴 통계와 자연스럽게 결합 — Phase 2 "그룹핑" 원칙 일관
4. Insights 카드는 .card SSoT 사용 → 카드 시스템 일관

---

## ADR-017: chartSection 모드 전환 + detail-header 통합

### 상태
**결정됨** (2026-04-23)

### 배경
사용자 핵심 요청 — detail 진입 시 chartSection이 전역 데이터를 보여주는 것은 정보 위계가 거꾸로. detail-header / context-chart-section / chartSection이 별도 영역으로 분산되어 있고, 같은 의미(세션 컨텍스트)인데 시각적으로 떨어져 있음.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| 1 | chartSection은 default 전용, detail은 별도 영역 유지 (현행) | 변경 없음 | 정보 분산, 사용자 요청 위배 |
| 2 | chartSection 자체가 모드 전환 (default ↔ detail). donut/cache panel 세션 단위 변환 | 영역 통합, 정보 위계 회복 | 차트 인스턴스 관리 복잡 |
| 3 | detail은 별도 chartSection2 영역, 동시 표시 | 단순 구현 | 영역 추가, 사용자 요청 위배 |

### 결정
**옵션 2 — chartSection이 default/detail 모드 전환 + donut/cache 세션 단위 변환 (사용자 default).**

#### 모드별 구조

```
[ default 모드 ]
chartSection.card
├─ card-header (.view-section-header)
│  ├─ "요청 추이 (실시간)" (.card-title)
│  └─ "최근 30분" (.card-subtitle)
│  └─ chart toggle 버튼
├─ charts-inner (3분할)
│  ├─ timelineChart (canvas)
│  ├─ donut + legend (전역 type / 모델 모드)
│  └─ cache-panel (전역 / 모델 매트릭스 모드)

[ detail 모드 ]
chartSection.card.chart-mode-detail
├─ card-header (.view-section-header — detail-header 흡수)
│  ├─ detail-session-id (8자 + 프로젝트명)  ← 기존 detail-header에서 이동
│  ├─ detail-tokens (총 토큰)
│  ├─ detail-ended-at
│  ├─ detail-agg-badges (최고 비용 / 최다 호출)
│  └─ detail-actions (toggle / 닫기)        ← 기존 detail-header에서 이동
├─ charts-inner (3분할)
│  ├─ contextGrowthChart (canvas) — timelineChart 대체
│  ├─ donut (세션 type 분포 — 클라이언트 계산)
│  └─ cache-panel (세션 cache stats — 클라이언트 계산)
```

#### DOM 변화

- 기존 `.detail-header` 영역 → **제거** (chartSection card-header로 흡수)
- 기존 `.context-chart-section` → **제거** (chartSection charts-inner의 첫 슬롯으로 흡수)
- detail 진입 시 `chartSection.classList.add('chart-mode-detail')` + 콘텐츠 swap
- detail 닫기 시 `.chart-mode-detail` 제거 + 원복

#### 차트 인스턴스 정책

- timelineChart canvas는 default 모드만 보임. detail 모드에서 `display:none`.
- contextGrowthChart canvas는 detail 모드만 보임. default 모드에서 `display:none`.
- donut은 단일 canvas, 데이터만 swap. drawDonut(data) 함수에 모드 인자 추가.
- cache-panel DOM은 단일, 데이터만 swap (renderCachePanel에 sessionMode 인자 추가).

#### 데이터 swap 로직

- default 모드: 기존 fetchDashboard → typeData / cacheStats 그대로
- detail 모드 (selectSession 시): `_detailAllRequests`에서 클라이언트 계산
  - typeData: prompt/tool_call/system count 집계
  - cacheStats: cache_read 합 / total_input 합 → hit rate

기존 SSoT 함수 재사용: drawDonut, renderTypeLegend, renderCachePanel — 데이터 인자만 변경.

### 이유
1. 사용자 요청 "영역 재활용" 정확히 답
2. 정보 위계 회복 — Right Panel 상단이 항상 "현재 컨텍스트의 차트"가 됨 (default=전역, detail=세션)
3. detail-header 통합으로 세션 메타 + 세션 차트가 한 카드에 — 디자이너 피드백 "그룹핑"과도 일관
4. 차트 인스턴스 재사용으로 메모리/렌더 cost 절감

---

## ADR-018: 로고 클릭 → 홈 복귀

### 상태
**결정됨** (2026-04-23)

### 배경
Phase 1에서 발견한 누락: 로고 클릭 동작 없음. 일반적 대시보드 관례 위반.

### 결정

`<div class="logo">` → `<button class="logo">` (또는 `role="button" tabindex="0"`).

클릭 동작:
1. `closeDetail()` 호출 (detail 뷰 진입 상태면 닫기)
2. 좌측 패널 선택 클리어: `setSelectedSession(null)` + `setSelectedProject(null)`
3. localStorage `spyglass:lastProject` 제거 (홈 상태 영속화)
4. 우측 main 영역 scroll top
5. `autoActivateProject()` 재호출 (자동 첫 프로젝트 선택)

키보드 접근성:
- `cursor: pointer`
- ARIA `role="button"` + `tabindex="0"`
- Enter/Space 키 지원

### 이유
1. Phase 1 인벤토리 누락 항목 직접 답
2. 일반 대시보드 관례 (로고 = 홈)
3. 사용자가 detail 깊은 곳에서 한 번에 초기 상태로 복귀하는 동선 제공

---

## 요약 — 18개 ADR이 답하는 사용자 피드백

| 피드백 | 답하는 ADR |
|--------|------------|
| "숨막힌다" | ADR-002 (Spacing 8px), ADR-003 (Card), ADR-009 (State SSoT) |
| "어디 봐야할지" | ADR-001 (3-Tier), ADR-004 (Typography), ADR-005 (Hero Metrics) |
| **"그룹핑 부재"** | ADR-003 (Card), ADR-006 (Filter Grouping), ADR-007 (Matrix), ADR-008 (Turn Hierarchy) |
| "AI같음" | ADR-009 (State SSoT), ADR-013 (TUI 일관), ADR-014 (Persistence) |
| 잠재 버그 | ADR-010 (closeDetail/AlertBanner/maxTokens), ADR-018 (로고 홈) |
| 일관성 | ADR-011 (Anomaly), ADR-012 (Keyboard) |
| **Phase 3** | ADR-015 (가격 옵션 2), ADR-016 (시각 지표 8종 배치), ADR-017 (chartSection 모드 전환), ADR-018 (로고 홈) |
