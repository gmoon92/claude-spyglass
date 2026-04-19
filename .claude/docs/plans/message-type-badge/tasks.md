# message-type-badge Tasks

> Feature: message-type-badge
> 시작일: 2026-04-19
> 상태: 완료

## Tasks

### 1단계: 렌더러 분리 (renderers.js)

- [x] `TYPE_ABBR` 상수 제거
- [x] `typeBadge()` — 약어 제거, type 값 풀텍스트 그대로 표시 (`prompt` / `tool_call` / `system`)
- [x] `makeActionCell()` — type badge만 반환하도록 재정의 (모델명·도구명·캐시뱃지 제거)
- [x] `makeTargetCell(r)` 신규 — tool_call이면 icon + tool_name (Skill/Agent는 tool_detail 포함), 나머지 빈칸
- [x] `makeModelCell(r)` 신규 — prompt이면 model명, 나머지 빈칸
- [x] `makeCacheCell(r)` 신규 — cache_read_tokens > 0이면 숫자값, 나머지 빈칸 / data-cache-read, data-cache-write 속성 포함
- [x] `makeRequestRow()` — 신규 셀 4개 반영 (Target, Model, Cache, Duration)
- [x] `cacheHitBadge()` 함수 제거 (Cache 컬럼으로 대체)

### 2단계: 테이블 헤더 변경 (index.html)

- [x] 피드 테이블 헤더 — `행위` → `Action`, Target / Model / ⚡Cache / Duration 컬럼 추가
- [x] 세션 상세뷰 테이블 헤더 — 동일 변경
- [x] 필터 버튼 라벨 — `Tool` → `tool_call`

### 3단계: CSS 조정

- [x] `badges.css` — type badge `min-width` 확장 (20px → `tool_call` 9자 수용)
- [x] `badges.css` — type badge `font-size` / `padding` 조정 (풀텍스트 가독성)
- [x] `table.css` — 신규 컬럼 너비 정의 (Action / Target / Model / Cache / Duration)

### 4단계: Cache 툴팁 (JS)

- [x] `tooltip.js` 신규 또는 기존 JS에 툴팁 헬퍼 추가 — `mouseenter` / `mouseleave` + `position: fixed`
- [x] Cache 셀 호버 시 툴팁 표시: Read 토큰(×0.1 cost) + Write 토큰(×1.25 cost)
- [x] 툴팁 CSS 스타일 추가 (배경색, 폰트, 그림자, z-index)

### 5단계: 세션 상세뷰 반영 (session-detail.js)

- [x] `renderDetailRequests()` — 신규 컬럼 4개 반영
- [x] 필터 카운트 레이블 — `Tool (N)` → `tool_call (N)`, `Prompt (N)` → `prompt (N)`, `System (N)` → `system (N)`

### 6단계: 추가 완료 항목 (2026-04-19)

- [x] prompt/system Target 셀에 role 배지(◉user, ◉system) 추가 — `.target-role-badge` 컴포넌트, `.role-badge-user` / `.role-badge-system` 색상 클래스 적용
- [x] tool_call 행의 model 컬럼 표시 조건 제거 — tool_call은 model 빈칸으로 확정
- [x] 도구 아이콘 색상 구분 추가 — 일반 도구 `◉` `.tool-icon-tool` (초록), 에이전트/스킬 `◎` `.tool-icon-agent` (파랑)

## 완료 기준

- [x] Action 컬럼에 P/T/S 약어 없음, `prompt` / `tool_call` / `system` 풀텍스트 badge
- [x] Target 컬럼 — tool_call의 도구명만 표시, prompt/system 빈칸
- [x] Model 컬럼 — prompt의 모델명만 표시, tool_call/system 빈칸
- [x] Cache 컬럼 — Action 셀에서 독립, cache_read_tokens 숫자 표시 (⚡ 아이콘은 헤더에만)
- [x] Cache 셀 호버 시 Read/Write 토큰 + 비용 배율 툴팁 표시
- [x] 컬럼 헤더 영문화 — Action / Target / Model / ⚡Cache / Duration
- [x] `tool_call` badge 너비 깨지지 않음
- [x] 피드 테이블 + 세션 상세뷰 테이블 두 곳 모두 반영
- [x] TUI 변경 없음 (P/T/S 약어 유지)
