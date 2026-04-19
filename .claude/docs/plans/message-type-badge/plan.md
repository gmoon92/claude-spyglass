# message-type-badge 개발 계획

> Feature: message-type-badge
> 작성일: 2026-04-19
> 작성자: Claude Code

## 목표

웹 대시보드 로그 테이블의 "행위" 단일 컬럼을 LLM/AI 전문 용어 기반으로 재설계한다.
- 단일 셀에 혼재된 정보(타입·도구명·모델명·캐시뱃지)를 독립 컬럼으로 분리
- 컬럼명을 AI Agent 도메인 표준 영문 용어로 정의
- TUI는 변경하지 않고 웹 전용 독립 디자인 체계 확립

---

## 배경: 현재 구조의 문제

### 현재 "행위" 셀 내 혼재 정보

```
행위 셀 = [T] ◉Bash [오류]       ← type badge + tool icon + tool name + status badge
행위 셀 = [P] claude-sonnet ⚡1.2K  ← type badge + model name + cache badge
행위 셀 = [S] System               ← type badge + fixed text
```

**문제점**:
- 타입(무슨 종류 작업)과 이름(무슨 도구/모델) 정보가 한 셀에 뒤섞임
- 모델명이 "타겟"인지 "행위자"인지 맥락이 불명확
- 캐시 정보가 행위 셀에 숨어 있어 발견하기 어려움
- "행위"는 LLM 도메인과 무관한 번역어

---

## DB 스키마 실태 확인

사용자가 추정한 `type_detail` 컬럼은 **존재하지 않는다.**

| 컬럼 | 타입 | 값 예시 | 비고 |
|------|------|---------|------|
| `type` | TEXT | `prompt` / `tool_call` / `system` | NOT NULL, CHECK 제약 |
| `tool_name` | TEXT | `Bash`, `Read`, `Skill` | tool_call 전용 |
| `tool_detail` | TEXT | `commit`, `dev-orchestrator` | Skill/Agent 세부명 |
| `model` | TEXT | `claude-sonnet-4-6` | prompt 전용 |
| `cache_read_tokens` | INTEGER | `1240` | 캐시 읽은 토큰 수 |
| `cache_creation_tokens` | INTEGER | `3200` | 캐시 생성 토큰 수 |
| `event_type` | TEXT | — | 별도 용도, 이번 범위 외 |

> **결론**: 두 계층 구조는 `type` → `tool_name`/`tool_detail` 또는 `model` 로 이미 구현되어 있다.

---

## 캐시 히트율 오류 수정

### 현재 문제

```javascript
// renderers.js:33-35
export function cacheHitBadge(r) {
  if (!r.cache_read_tokens || r.cache_read_tokens <= 0) return '';
  return `<span class="mini-badge badge-cache" title="캐시 히트">⚡${fmtToken(r.cache_read_tokens)}</span>`;
}
```

- 현재 표시: `⚡1.2K` (cache_read_tokens 원시 토큰 수)
- 현재 title: "캐시 히트" → **잘못된 명칭**
- **캐시 히트율(Hit Rate)** = 비율(%) 이므로 토큰 수와 다른 개념

### 캐시 히트율 올바른 정의

```
Cache Hit Rate = cache_read_tokens / (tokens_input + cache_read_tokens) × 100%
```

### 이번 결정

"캐시 히트율"이 아닌 **"Cache"** 컬럼으로 분리하여 cache_read_tokens 값을 표시.
(히트율 계산은 별도 기능 범위로 분리)

---

## 용어 정의 (AI Agent 도메인)

### 채택 근거

claude-spyglass 사용자 = **Claude Code(AI Agent)를 관찰하는 AI 전문가/사용자**

AI Agent 프레임워크(ReAct, LangGraph)의 핵심 개념:
```
Thought → Action → Observation
```
Claude Code의 각 row = Agent의 하나의 **Action**.
그 Action이 향하는 대상 = **Target**.

### 컬럼 명칭 결정

| 기존 | 신규 | 근거 |
|------|------|------|
| 행위 | **Action** | ReAct 프레임워크 핵심 용어, AI Agent 논문 표준 |
| (없음) | **Target** | Action의 실행 대상 (도구명, tool_call 전용) |
| (없음) | **Model** | LLM 추론 시 사용된 모델 (prompt 전용, 신규 컬럼) |
| (뱃지) | **Cache** | cache_read_tokens 독립 컬럼 (prompt 전용) |

---

## 컬럼 재설계

### 현재 → 신규 컬럼 구조

**세션 상세뷰 (플랫 테이블)**

| # | 현재 컬럼 | 신규 컬럼 | 변경 내용 |
|---|----------|----------|---------|
| 1 | Time | **Time** | 유지 |
| 2 | 행위 (type badge + 이름 + 캐시뱃지) | **Action** | type 풀텍스트 badge만 표시 |
| 3 | — | **Target** | tool_call의 도구명 표시 (신규) |
| 4 | — | **Model** | prompt의 모델명 표시 (신규) |
| 5 | Message | **Message** | 유지 |
| 6 | in | **in** | 유지 |
| 7 | out | **out** | 유지 |
| 8 | — | **Cache** | cache_read_tokens 독립 표시 (Action 셀에서 분리) |
| 9 | Response Time | **Duration** | 명칭 영문화 |

### 각 컬럼별 표시 데이터

```
Action   = type badge (prompt / tool_call / system) — 풀텍스트, 약어 없음
Target   = tool_name (tool_call만 표시, Skill/Agent는 tool_detail 포함)
             prompt/system → 빈칸
Model    = model 컬럼값 (prompt만 표시)
             tool_call/system → 빈칸
Cache    = cache_read_tokens 숫자값 (prompt + 캐시 있을 때만)
             아이콘(⚡)은 컬럼 헤더에 한 번만, 셀엔 숫자만 표시
             in/out 컬럼과 동일한 cell-token num 스타일로 일관성 유지
             tool_call/system → 빈칸
Duration = duration_ms (formatDuration)
```

### 타입별 행 표시 예시

```
Action      Target         Model               in      out    ⚡Cache   Duration
────────────────────────────────────────────────────────────────────────────────
prompt      —              claude-sonnet-4-6   12.4K   1.8K   1.2K     2.3s
tool_call   ◉Bash          —                   —       —      —        0.4s
tool_call   ◎Skill(commit) —                   —       —      —        45.2s
system      —              —                   —       —      —        0.1s
```

---

## Cache 툴팁 설계

### 목적

`cache_read_tokens`, `cache_creation_tokens` 개념을 모르는 사용자에게
Cache 셀 호버 시 간단한 설명 제공.

### 디자이너 검토 결과

- 툴팁 대상이 `prompt` 타입 row에만 존재 → tool_call/system은 빈칸이라 툴팁 미표시
- 테이블 전체적으로 많지 않아 UX 노이즈 문제 없음
- `title` 속성(브라우저 기본)으로 시작, 풍부한 포맷 필요 시 CSS custom tooltip 도입

### 주의사항: 테이블 오버플로 클리핑

CSS `::after` pseudo-element 방식은 테이블의 `overflow: hidden` 컨텍스트에서
툴팁이 잘릴 수 있음.

```
선택지:
A) title 속성    — 즉시 구현, 브라우저 기본 스타일 (못생김)
B) CSS tooltip  — position: fixed 또는 JS 좌표 계산 필요
C) JS tooltip   — 리치 콘텐츠 가능, 코드 추가 필요
```

### 채택: JS `position: fixed` 툴팁

```html
<!-- Cache 셀 마크업 -->
<td class="cell-token num cache-cell"
    data-cache-read="1240"
    data-cache-write="3200">
  1.2K
</td>
```

**툴팁 내용 (⚡📝 이모지 사용 안 함 — 렌더링 불안정)**
```
PROMPT CACHE

Read    1,240 tokens  ×0.1 cost     ← 색상: var(--blue) #60a5fa
Write   3,200 tokens  ×1.25 cost    ← 색상: var(--orange) #f59e0b
```

**툴팁 CSS 핵심값**
```css
.cache-tooltip {
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 14px;
  min-width: 220px;
  font-size: 11px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
}
```

**JS 포지셔닝**: `mouseenter`에서 `position: fixed` 좌표 설정
뷰포트 우측 충돌 시 좌측으로 플립 처리 필요:
```js
const flipX = e.clientX + 8 + tooltipWidth > window.innerWidth;
tooltip.style.left = flipX
  ? `${e.clientX - tooltipWidth - 8}px`
  : `${e.clientX + 8}px`;
tooltip.style.top = `${e.clientY + 12}px`;
```

**⚡Cache 헤더 주의사항**: `th`에 `text-transform: uppercase` 전역 적용 중
→ "⚡Cache" 렌더 시 "⚡CACHE"로 표시됨 → 의도한 결과인지 확인 필요
안전한 마크업:
```html
<th style="text-align:right">
  <span style="text-transform:none">⚡</span>Cache
</th>
```

- Read: 캐시에서 읽은 토큰 — 일반 입력 비용의 **10%** 과금
- Write: 캐시에 저장한 토큰 — 일반 입력 비용의 **125%** 과금 (1회성)

---

## 범위

### 포함

- `renderers.js` — `typeBadge()` 약어 제거, `makeActionCell()` 분리
- `renderers.js` — `makeTargetCell()`, `makeModelCell()`, `makeCacheCell()` 신규 함수
- `index.html` — 테이블 헤더 컬럼 추가/변경 (피드 + 세션 상세뷰 두 곳)
- `session-detail.js` — `renderDetailRequests()` 신규 컬럼 반영
- `badges.css` — type badge 너비 확장 (tool_call 9자 수용)
- `table.css` — 신규 컬럼 너비 정의

### 제외

- TUI — 변경 없음 (P/T/S 약어 유지, 터미널 공간 제약)
- DB 스키마 — 변경 없음 (`type_detail` 컬럼 신설 불필요)
- API 엔드포인트 — 변경 없음
- 캐시 히트율 계산 — 별도 기능으로 분리

---

## 단계별 계획

### 1단계: 렌더러 함수 분리 (renderers.js)

- `TYPE_ABBR` 상수 제거
- `typeBadge()`: 약어 → 풀텍스트 (prompt / tool_call / system)
- `makeActionCell()` 재정의: type badge만 반환
- `makeTargetCell(r)` 신규: tool_call이면 icon+tool_name(+tool_detail), 나머지 빈칸
- `makeModelCell(r)` 신규: prompt이면 model명, 나머지 빈칸
- `makeCacheCell(r)` 신규: cache_read_tokens > 0이면 ⚡{값}, 나머지 빈칸
- `makeRequestRow()` 업데이트: 신규 셀 추가

### 2단계: 테이블 헤더 변경 (index.html)

- 피드 테이블, 세션 상세뷰 테이블 두 곳 모두 수정
- 헤더: `행위` → `Action` / Target / Model / Cache / Duration 추가

### 3단계: CSS 조정 (badges.css, table.css)

**type badge 수정값 (badges.css)**
- `min-width`: 20px → 72px (`tool_call` 9자 기준, 세 배지 너비 통일)
- `padding`: 1px 6px → 2px 7px (가독성)
- `letter-spacing`: 0.2px → 0.05em (풀텍스트에서 em 단위가 자연스러움)

**컬럼 너비 (colgroup, table.css)**
| 컬럼 | 너비 | 비고 |
|------|------|------|
| Time | 100px | HH:MM:SS 출력 기준 (날짜 포함 시 130px 유지) |
| Action | 88px | tool_call 배지 수용 |
| Target | 120px | ◉Bash, ◎Skill(commit) 패턴 |
| Model | 130px | claude-sonnet-4-6 = 17자 |
| Message | flex | 나머지 공간 소화 |
| in | 48px | 숫자 우정렬 |
| out | 48px | |
| Cache | 52px | 숫자 우정렬 |
| Duration | 68px | |

**빈칸 처리**: Target / Model / Cache 빈칸은 `—` 대시로 통일
- `cell-token num` 클래스 유지 (우정렬 일관성)
- `td.cell-empty { color: var(--text-dim); }` 추가

### 4단계: 세션 상세 뷰 반영 (session-detail.js)

- `renderDetailRequests()` 신규 컬럼 반영
- 필터 버튼 레이블: "Tool" → "tool_call"

---

## 완료 기준

- [ ] Action 컬럼에 P/T/S 약어 없음, 풀텍스트 badge 표시
- [ ] Target 컬럼에 tool_call의 도구명만 표시 (prompt/system은 빈칸)
- [ ] Model 컬럼에 prompt의 모델명만 표시 (tool_call/system은 빈칸)
- [ ] Cache 컬럼이 Action 셀에서 독립, cache_read_tokens 표시
- [ ] 컬럼 헤더: Action / Target / Model / Cache / Duration (영문)
- [ ] tool_call badge가 너비 깨지지 않음 (9자 수용)
- [ ] TUI 변경 없음
