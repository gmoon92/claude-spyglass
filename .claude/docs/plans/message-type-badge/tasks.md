# message-type-badge Tasks

> Feature: message-type-badge
> 시작일: 2026-04-19
> 상태: 진행 중

## Tasks

### 1단계: 렌더러 분리 (renderers.js)

- [ ] `TYPE_ABBR` 상수 제거
- [ ] `typeBadge()` — 약어 제거, type 값 풀텍스트 그대로 표시 (`prompt` / `tool_call` / `system`)
- [ ] `makeActionCell()` — type badge만 반환하도록 재정의 (모델명·도구명·캐시뱃지 제거)
- [ ] `makeTargetCell(r)` 신규 — tool_call이면 icon + tool_name (Skill/Agent는 tool_detail 포함), 나머지 빈칸
- [ ] `makeModelCell(r)` 신규 — prompt이면 model명, 나머지 빈칸
- [ ] `makeCacheCell(r)` 신규 — cache_read_tokens > 0이면 숫자값, 나머지 빈칸 / data-cache-read, data-cache-write 속성 포함
- [ ] `makeRequestRow()` — 신규 셀 4개 반영 (Target, Model, Cache, Duration)
- [ ] `cacheHitBadge()` 함수 제거 (Cache 컬럼으로 대체)

### 2단계: 테이블 헤더 변경 (index.html)

- [ ] 피드 테이블 헤더 — `행위` → `Action`, Target / Model / ⚡Cache / Duration 컬럼 추가
- [ ] 세션 상세뷰 테이블 헤더 — 동일 변경
- [ ] 필터 버튼 레이블 — `Tool` → `tool_call`

### 3단계: CSS 조정

- [ ] `badges.css` — type badge `min-width` 확장 (20px → `tool_call` 9자 수용)
- [ ] `badges.css` — type badge `font-size` / `padding` 조정 (풀텍스트 가독성)
- [ ] `table.css` — 신규 컬럼 너비 정의 (Action / Target / Model / Cache / Duration)

### 4단계: Cache 툴팁 (JS)

- [ ] `tooltip.js` 신규 또는 기존 JS에 툴팁 헬퍼 추가 — `mouseenter` / `mouseleave` + `position: fixed`
- [ ] Cache 셀 호버 시 툴팁 표시: Read 토큰(×0.1 cost) + Write 토큰(×1.25 cost)
- [ ] 툴팁 CSS 스타일 추가 (배경색, 폰트, 그림자, z-index)

### 5단계: 세션 상세뷰 반영 (session-detail.js)

- [ ] `renderDetailRequests()` — 신규 컬럼 4개 반영
- [ ] 필터 카운트 레이블 — `Tool (N)` → `tool_call (N)`, `Prompt (N)` → `prompt (N)`, `System (N)` → `system (N)`

## 완료 기준

- [ ] Action 컬럼에 P/T/S 약어 없음, `prompt` / `tool_call` / `system` 풀텍스트 badge
- [ ] Target 컬럼 — tool_call의 도구명만 표시, prompt/system 빈칸
- [ ] Model 컬럼 — prompt의 모델명만 표시, tool_call/system 빈칸
- [ ] Cache 컬럼 — Action 셀에서 독립, cache_read_tokens 숫자 표시 (⚡ 아이콘은 헤더에만)
- [ ] Cache 셀 호버 시 Read/Write 토큰 + 비용 배율 툴팁 표시
- [ ] 컬럼 헤더 영문화 — Action / Target / Model / ⚡Cache / Duration
- [ ] `tool_call` badge 너비 깨지지 않음
- [ ] 피드 테이블 + 세션 상세뷰 테이블 두 곳 모두 반영
- [ ] TUI 변경 없음 (P/T/S 약어 유지)
