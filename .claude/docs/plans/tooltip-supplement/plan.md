# tooltip-supplement 개발 계획

> Feature: tooltip-supplement
> 작성일: 2026-04-19
> 작성자: Claude Code

## 목표

최근 UI 변경(badges.css, detail-view.css, header.css, turn-view.css, session-detail.js)으로 추가된
새로운 UI 항목 중 툴팁이 없는 요소를 파악하고, 기존 패턴(`.cache-tooltip`, `.stat-tooltip`, HTML `title`)과
동일한 방식으로 설명 툴팁을 보완한다.

## 현황 분석

### 이미 툴팁이 있는 요소

- `summary-strip` stat-card 전체: `data-stat-tooltip` → `stat-tooltip.js` 처리
- 테이블 Cache 셀: `.cache-cell[data-cache-read][data-cache-write]` → `cache-tooltip.js` 처리
- `prompt-preview` span: `title` 속성으로 전체 텍스트 제공
- `.panel-resize-handle`: `title` 속성 있음
- 프로젝트 셀 이름: `title` 속성 있음
- 세션 ID: `title` 속성 있음

### 툴팁이 없는 요소 (추가 대상)

1. **Cache Intelligence Panel** (`#cachePanel`)
   - `Hit Rate` 레이블 + 진행바: hit rate 의미 설명 없음
   - `without cache` / `actual cost` / `saved` 수치: 각 항목 의미 불명확
   - `Creation / Read` 미니바 + `stable/building` 라벨: 의미 불명확
   - 대상: `.cache-panel-label`, `.cache-cost-item`, `.cache-ratio-label`
   - 방식: `data-cache-panel-tooltip` 속성 + 새 JS 핸들러 또는 `title` 속성

2. **Turn View 헤더 메타 텍스트** (`session-detail.js`)
   - `도구 N개 · IN N / OUT N · ⏱ N`: 약어 의미 설명 없음
   - `.turn-meta` 스팬에 `title` 속성으로 풀이 제공
   - 방식: JS에서 `title` 속성 삽입

3. **Detail Aggregate Badges** (`.detail-agg-badge`)
   - "최고 비용 Turn: T3" / "최다 호출 Tool: Read": 클릭 여부 및 의미 불명확
   - 방식: `title` 속성으로 설명 삽입 (JS 단)

4. **badge-live** (`#liveBadge`)
   - SSE 연결 상태 표시지만 disconnected 상태 의미 설명 없음
   - 방식: HTML `title` 속성 (정적)

5. **date-filter 버튼** (전체/오늘/이번주)
   - 필터 범위 기준 설명 없음 (오늘 = UTC? 로컬?)
   - 방식: HTML `title` 속성 (정적)

6. **type-filter-btn** (All/prompt/tool_call/system)
   - 타입 의미 설명 없음
   - 방식: HTML `title` 속성 (정적)

## 범위

- 포함:
  - Cache Intelligence Panel 각 섹션 툴팁 (`.cache-panel` 내부 요소)
  - Turn View 메타 텍스트 `title` 추가 (session-detail.js)
  - Detail Aggregate Badges `title` 추가 (session-detail.js)
  - header 정적 요소 `title` 추가 (index.html)
  - 날짜/타입 필터 버튼 `title` 추가 (index.html)

- 제외:
  - 이미 툴팁이 있는 stat-card, cache-cell, prompt-preview
  - DB/서버 API 코드 수정
  - 새 CSS 클래스 대규모 추가 (기존 `.stat-tooltip` 재사용 우선)

## 단계별 계획

### 1단계: Cache Panel 툴팁
- index.html의 `.cache-panel` 내 `data-cache-panel-tooltip` 속성 추가
- `stat-tooltip.js` 패턴을 그대로 따라 `cache-panel-tooltip.js` 신규 파일 작성
- main.js에 `initCachePanelTooltip()` 호출 추가

### 2단계: Turn View / Detail Badges title 속성
- `session-detail.js`의 `renderTurnView` 함수에서 `.turn-meta` 스팬에 `title` 추가
- `renderTurnView`의 `.detail-agg-badge` 생성 시 `title` 속성 추가

### 3단계: index.html 정적 title 추가
- `#liveBadge`, 날짜 필터 버튼, 타입 필터 버튼에 `title` 속성 삽입

## 완료 기준

- [ ] Cache Panel 3개 섹션 모두 hover 시 `.stat-tooltip` 스타일 툴팁 표시
- [ ] Turn View `.turn-meta` hover 시 `title` 툴팁 표시 (IN/OUT/도구 의미 설명)
- [ ] Detail Aggregate Badges `title` 추가
- [ ] header 정적 요소 `title` 추가
- [ ] 날짜/타입 필터 버튼 `title` 추가
- [ ] 기존 `.cache-tooltip`, `.stat-tooltip` 동작 유지
- [ ] 하드코딩 색상 없음, CSS 변수만 사용
