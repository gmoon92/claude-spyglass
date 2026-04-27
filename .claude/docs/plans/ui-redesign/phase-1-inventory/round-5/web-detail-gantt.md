# web-detail-gantt — Detail Gantt View (W11)

> 세션 상세의 세 번째 탭. 턴별 타임라인 캔버스. 페이지네이션 + 범례 + hover 툴팁 + 클릭으로 turn 뷰 점프.
> 5라운드 누적 인벤토리.

---

## R1 — 1차 작성

### 컨테이너 (`#detailGanttView.detail-content`)

#### 툴바 (`.gantt-toolbar`)
- 좌: `.gantt-nav`
  - prev 버튼 `#ganttPrev` (`‹`)
  - 라벨 `#ganttNavLabel` "T1–T10"
  - next 버튼 `#ganttNext` (`›`)
- 중: `#ganttHint.gantt-hint` "세션 전체 · N개 툴 호출"
- 우: `#ganttLegend.gantt-legend` (JS 동적 삽입)

#### 스크롤 영역 (`.gantt-scroll #ganttScroll`)
- flex:1, overflow-y:auto
- 캔버스 `#turnGanttChart` (height JS 동적 설정)

### 캔버스 렌더 (`turn-gantt.js`)

#### 행 구조
- ROW_H = 22px (턴 행 높이)
- BAR_H = 12px (바 높이)
- LABEL_W = 36px (왼쪽 턴 레이블 영역)
- PAD_TOP/BOT = 8

#### 페이지네이션
- _pageSize = 10턴
- _pageStart 0부터 시작
- ganttNavLabel 텍스트 "T${start}–T${end}"

#### 도구 색상 (TOOL_COLORS, CSS 변수 동기화)
- Agent/Skill: orange (`--tool-agent`)
- Task: blue (`--tool-task`)
- Read/Write/Edit/MultiEdit: green (`--tool-fs`)
- Bash: orange-light (`--tool-bash`)
- Grep/Glob: yellow (`--tool-search`)
- WebSearch/WebFetch: pink (`--tool-web`)
- default: gray (`--tool-default`)

#### 범례 (동적 생성)
- 사용된 도구 종류별:
  - `<span class="gantt-legend-item">`
    - `<span class="gantt-legend-dot" style="background:${color}">`
    - 도구명

#### 바 렌더
- duration_ms > 0 → 바 (color, BAR_H, x/w 계산)
- duration_ms = 0 → 다이아몬드 마커 (DIAMOND_R = 4)
- MIN_BAR_W = 3 (0ms 툴 최소 너비)

### Hover Tooltip (G1 — 미확인)
- `_hitMap[]` 배열 — { x, y, w, h, tc, turn, isDiamond, inferredDur }
- 마우스 위치로 hit 검사 → 툴팁 표시

### 이상 감지 (G6)
- `_turnAnomalyMap` Map (turn_id → Set<spike|loop|slow>)
- 턴 행에 anomaly 표시 (확인 필요)

### Gantt 클릭 → 턴뷰 연동 (G7)
- canvas 클릭 시 hit map에서 turnId 추출
- `gantt:turnClick` CustomEvent 발생
- main.js `initGanttNavigation` 리스너:
  - setDetailView('turn')
  - requestAnimationFrame으로 toggleTurn(turnId) 호출 → 카드 펼침

---

## R2 — 검토

1. **status: "구조 완료 (JS 렌더러 미구현)" (screen-inventory.md 309라인)**: 그러나 turn-gantt.js 553라인 코드 존재 — 일부 또는 전체 구현됨. 인벤토리 상태 갱신 필요.
2. **페이지네이션 동작**: 10턴 단위. prev 버튼은 _pageStart -=10, next는 +=10.
3. **빈 세션 처리**: turns=[] 시 ganttHint "도구 호출 없음" 또는 비슷.
4. **다이아몬드 마커 의미**: duration_ms=0인 즉시 완료 도구. 시각적 구분.
5. **MIN_BAR_W=3**: 매우 짧은 도구도 시각적 가시성 확보.
6. **Hover Tooltip 구현 상태 미확인**: _hitMap 변수 존재하나 실제 핸들러/UI는 별도 검사 필요.
7. **클릭 → 턴뷰 연동**: gantt:turnClick CustomEvent 발생 후 setDetailView('turn'). 그러나 사용자가 gantt 탭에 있다가 자동 탭 전환 — UX 갑작스러울 수 있음.
8. **anomaly 표시 위치**: turn 행 단위인지 도구 단위인지 명세 부족.
9. **legend 정렬**: 도구명 알파벳? 사용 빈도?
10. **gantt 영속화 부재**: 페이지 위치 저장 없음 — 세션 전환 시 초기화.
11. **canvas height 동적**: pageSize=10턴 × ROW_H=22 + padding = 약 240px. 그러나 한 페이지에 10턴 미만이면 짧음.
12. **DPR 처리**: turn-gantt.js 미확인 영역. 일반적으로 chart.js와 동일 패턴 가정.

---

## R3 — R2 반영 + 추가

### 보강

- **인벤토리 상태 갱신**: gantt 뷰는 이미 구현되어 있음. screen-inventory.md "JS 렌더러 미구현"은 outdated.
- **페이지네이션 흐름**:
  - prev/next 버튼 클릭 → _pageStart 갱신 → renderGantt 재호출
  - turns 배열이 변경되면 _pageStart 보정 (out of range 방지)
  - ganttNavLabel "T${pageStart+1}–T${min(pageStart+pageSize, turns.length)}"
- **빈 상태**: turns 빈 배열 시 hint/legend 비우고 canvas 빈 배경.
- **다이아몬드 마커**: 4px 반경, 도구 색상 fill. 시간축이 0 너비라도 시각 표현.
- **hit map 구성**: 각 바/다이아몬드의 픽셀 영역 + tc/turn 메타. 마우스 mousemove 시 좌표 비교 → 툴팁 데이터 추출.
- **Hover Tooltip 내용 (추정)**: tool_name + tool_detail + duration + tokens + timestamp + 오류 여부.
- **turn 행 anomaly 색상**: turn 라벨(좌측 LABEL_W 영역)에 spike/loop/slow 시각 단서. CSS 변수와 동기화 가능성.
- **클릭 후 자동 탭 전환 UX**:
  - gantt → turn 자동 전환 + 해당 카드 펼침
  - 사용자가 의도한 동작 (트레이스 흐름 따라 상세 보기)
  - 그러나 갑작스러운 전환 가능 — 시각 단서 부재
- **legend 정렬**: 사용 도구별 한 번씩, 등장 순서 또는 알파벳 (코드 확인 필요).
- **페이지네이션 영속화 부재**: 세션 전환·탭 전환 시 초기화.

### 추가 인터랙션

- **canvas wheel/drag**: 미구현 (확인). 페이지 버튼만으로 이동.
- **줌 부재**: 시간축 줌 미지원.
- **legend 항목 클릭**: 도구별 토글 부재.

---

## R4 — 검토 (미세·키보드·에러·상태 전이)

1. **gantt 키보드 접근성**:
   - prev/next 버튼은 `<button>` Tab/Enter ✅
   - canvas 자체는 키보드 미지원 (포커스/이동/선택)
   - 클릭으로만 turn 뷰 점프 가능
2. **legend 키보드 부재**.
3. **canvas ARIA**: alt/aria-label 부재 — 스크린리더 미지원.
4. **hover 툴팁 키보드 부재**.
5. **페이지 정보 visibly**: 라벨 "T1–T10" 텍스트만, 전체 N턴 중 몇 페이지인지 표시 부재.
6. **prev/next disabled 상태**:
   - 첫 페이지에서 prev → disabled?
   - 마지막 페이지에서 next → disabled?
   - 코드 확인 필요. 미처리면 사용자 혼란.
7. **canvas resize**: ResizeObserver 부재 시 너비 변경 대응 부재.
8. **anomaly 표시 시각 단서 부족**: turn 라벨 색상 변화만? 명확한 배지/아이콘 없음.
9. **gantt 클릭 후 자동 탭 전환**: setDetailView('turn') + requestAnimationFrame으로 toggleTurn. 시각 transition 부재 → 갑작스러운 화면 변화.
10. **페이지네이션 부드러움**: 페이지 전환 시 fade/slide 없음 — 즉시 교체.
11. **gantt 빈 상태 텍스트**: hint에 "로딩 중…"가 영구 노출 위험 (R5에서 W8 검토 시 발견).
12. **gantt 캔버스 height 동적 설정 vs 빈 페이지**: turns가 pageSize 미만이면 height가 작아 빈 영역 발생.
13. **legend overflow**: 도구 종류가 많으면 legend가 길어짐. wrap/scroll 처리 미확인.
14. **클릭 영역 정확도**: hit map 픽셀 단위 — 다이아몬드 4px 반경, 매우 작은 바 클릭 어려움.

---

## R5 — R4 반영 + 최종 추가

### 추가된 미세·접근성·상태 전이

- **canvas 키보드 접근성 전무**:
  - 트레이스 따라가기 키보드 불가
  - prev/next는 ✅
- **canvas ARIA 부재**: alt/aria-label로 "세션 N의 턴별 도구 실행 타임라인" 같은 설명 미제공
- **hover 툴팁 키보드 미지원**
- **페이지 정보 표시 부족**: "T1–T10 / 총 N턴" 같은 전체 컨텍스트 부재
- **prev/next disabled 상태 정확성 미확인** (코드 검사 필요)
- **canvas resize 정책 미확인**: 좁은 폭에서 너비 변경 대응 부재
- **anomaly 시각 단서 약함**
- **자동 탭 전환 시 시각 transition 부재**: 사용자가 어디로 갔는지 인지 어려움
- **legend overflow 처리 미확인**
- **클릭 영역 작음** (다이아몬드 4px)
- **줌/스크롤 부재**: 긴 도구는 시간축에서 한 페이지를 압도, 짧은 도구는 1px 미만
- **gantt 클릭 후 turn 카드 펼침 UX**: setDetailView('turn') 후 requestAnimationFrame으로 toggleTurn 호출 — DOM이 아직 준비 안 됐을 가능성. **잠재 race**.
- **TOOL_COLORS 동기화 시점**: initToolColors 한 번만. 다크/라이트 전환 시 stale.
- **legend dot 크기**: 인라인 style background. CSS 변수 토큰화 부재.
- **빈 chip 그룹 처리**: tools 0개 턴은 turn 라벨만 (빈 행).
- **tooltip 위치 계산**: 마우스 좌표 기반, 화면 가장자리 클램프 미확인.

### 키보드 단축키 (현재 부재 또는 부분)

| 의도 | 현재 |
|------|------|
| prev 페이지 | 클릭만 |
| next 페이지 | 클릭만 |
| ←→ 키로 페이지 | 없음 |
| 턴 ↑↓ 이동 | 없음 |
| Enter로 턴 점프 | 없음 |
| 줌 +/- | 없음 |

---

## 최종 기능 개수 (W11)

- 컨테이너 (toolbar + scroll): 2개
- 페이지네이션
  - prev/next 버튼: 2개
  - 라벨: 1개
  - pageSize 10: 1개
- 힌트 텍스트: 1개
- 범례 (동적 생성): 1개
- 캔버스 렌더
  - 행 구조 (ROW_H/BAR_H/LABEL_W/PAD): 4개
  - 도구 색상 7종 (CSS 변수 동기화): 1개
  - 바 렌더 (duration > 0): 1개
  - 다이아몬드 마커 (duration = 0): 1개
  - MIN_BAR_W=3: 1개
  - DPR 처리: 1개
- Hover Tooltip
  - hit map: 1개
  - tooltip 내용: 1개
- Anomaly 표시 (turn 단위): 1개
- 클릭 → turn 뷰 연동
  - CustomEvent: 1개
  - setDetailView + toggleTurn: 1개
- 빈 상태: 1개

총 **약 21개 기능**.

## 발견된 누락·모호 (Phase 2 입력)

1. screen-inventory.md "JS 렌더러 미구현" outdated — 갱신 필요
2. canvas 키보드 접근성 전무
3. canvas ARIA 부재
4. 페이지 정보 (전체 N턴 / 현재 페이지) 표시 부족
5. prev/next disabled 정확성 미확인
6. canvas resize 정책 미확인 (ResizeObserver?)
7. anomaly 시각 단서 약함 (turn 라벨 색?)
8. 자동 탭 전환 시 transition 부재 — 갑작스러움
9. 클릭 영역 너무 작음 (다이아몬드 4px)
10. 줌/스크롤 부재 — 긴/짧은 도구 가독성
11. legend overflow 처리 미확인
12. legend 정렬/항목 클릭 토글 부재
13. tooltip 화면 가장자리 클램프 미확인
14. setDetailView('turn') + toggleTurn race 가능
15. legend dot CSS 토큰화 부재
