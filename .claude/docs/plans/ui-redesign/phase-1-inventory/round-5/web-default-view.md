# web-default-view — Default View / Recent Feed (W5)

> Right Panel의 기본 화면. 최근 요청 테이블 + 검색 + 7개 타입 필터 + scroll-lock 배너 + 더 보기 버튼.
> 5라운드 누적 인벤토리.

---

## R1 — 1차 작성

### 컨테이너 (`#defaultView.right-view.active`)

- `view-section.fill` — flex:1
- 진입 조건: 초기 진입 또는 세션 선택 해제 (`uiState.rightView === 'default'`)

### 헤더 (`.view-section-header`)

- panel-label: "최근 요청"
- `.feed-controls` 그룹:
  - 검색창 `.feed-search`
    - `.feed-search-icon` ⌕ 마크
    - `<input #feedSearchInput>` placeholder "model / tool / message"
    - `.feed-search-clear #feedSearchClear` × 버튼 (입력값 있을 때만 visible)
  - 타입 필터 버튼 7개 (`#typeFilterBtns`):
    - All (data-filter="all", active)
    - prompt
    - Agent
    - Skill
    - MCP
    - tool_call
    - system
  - 각 버튼 title 속성으로 의미 설명 (예: "사용자 입력(LLM 추론 요청)만 표시")

### Feed Body (`.feed-body #feedBody`)

- 자체 scroll 영역 (`overflow-y: auto`)
- Scroll Lock Banner (`#scrollLockBanner`):
  - 클릭 시 `jumpToLatest()` — 스무스 스크롤 + 카운트 리셋
  - 텍스트: "↓ 새 요청 N개 — 클릭하여 최신으로 이동"
  - 사용자가 위로 스크롤한 상태에서 SSE 새 요청 도착 시 increment

### 테이블

#### colgroup
- 100/88/120/130/flex/48/48/52/68/88 px (Time/Action/Target/Model/Message/in/out/Cache/Duration/Session)

#### thead
- Time / Action / Target / Model / Message / in / out / ⚡Cache / Duration / Session

#### tbody (`#requestsBody`)
- `makeRequestRow(r, { showSession: true, anomalyFlags })` 호출로 렌더
- 행 구성:
  - `data-type`/`data-sub-type`/`data-request-id` 속성
  - cell-time: `fmtTimestamp` (오늘이면 시각만, 아니면 날짜+시각, +상대시간)
  - cell-action: `typeBadge(r.type)` 컬러 칩
  - cell-target: `targetInnerHtml` 결과
    - prompt → `[◉]user` 역할 배지
    - system → `[◉]system` 역할 배지
    - tool_call → `[◉/◎]ToolName(detail)` (Agent/Skill만 detail 포함)
    - 그 외 → `—` (cell-empty)
  - 추가 anomaly 배지 (spike/loop): cell-target 내부, cell-target </td> 직전
  - cell-model: model 또는 'synthetic'은 `—`
  - cell-msg: `contextPreview(r)` 60자 + 옵션 toolResponseHint (Read 줄수, Bash 오류, Edit/Write 저장됨, Grep 파일수, Glob 매칭, Agent/Skill 실패)
    - 빈 메시지: `<span class="cell-msg-empty">—</span>`
  - cell-token: in/out — `>0`이면 fmtToken, 아니면 `—`
  - cell-cache: prompt 타입 + cache_read_tokens > 0이면 fmtToken (data-cache-read/write 속성), 아니면 `—`
  - cell-duration: `formatDuration(duration_ms)` + slow 배지 (anomaly)
  - cell-sess: sess-id 12자 + `…` (`data-goto-session`/`data-goto-project` 속성)

### 더 보기 버튼 (`#loadMoreBtn`)
- 평소 숨김
- 200건 채워졌고 SSE 미연결 시 표시
- 클릭 → `fetchRequests(true)` (offset 증가)

### 빈/에러 상태
- 초기: skeleton 3행 (각 colspan=10)
- 빈 목록: "데이터 없음"
- 로드 실패: `<td colspan="10" style="color:var(--red)">요청 목록 로드 실패</td>`

### 인터랙션

- **행 클릭** → `selectSession(session_id)` (data-goto-session 속성으로 분기)
- **메시지 셀 `.prompt-preview` 클릭** → 행 아래 확장 패널 토글 (`togglePromptExpand`)
- **타입 필터 클릭**:
  - all/prompt/tool_call/system → 서버 재조회 (`fetchRequests`)
  - agent/skill/mcp → 클라이언트 필터 (DOM `data-sub-type` 기준)
- **검색**: input 변경 시 클라이언트 필터링 (model-name/action-name/prompt-preview/target-role-badge 텍스트 검색)
- **더 보기**: offset += list.length, 다음 200건 append

---

## R2 — 검토

1. **Cache 컬럼 헤더 ⚡ 마크**: span text-transform none, "⚡Cache". cell도 fmtToken으로 표시. 의미: cache_read_tokens (읽기 캐시 히트).
2. **prompt-preview hover/title**: title 속성은 200자 텍스트 + 총글자수 (60자 초과 시 "…").
3. **모델 컬럼 'synthetic' 처리**: 모델명이 'synthetic'(서버 내부 마커)이면 `—` 표시.
4. **anomaly 배지 위치**: spike/loop는 cell-target에 (target-cell-inner 옆), slow는 cell-duration 옆. 분산 배치 — 시각 일관성 약함.
5. **SSE prependRequest 동작**:
   - 같은 id 행 있으면 인플레이스 업데이트 (cell-target HTML 교체 + duration 텍스트 교체)
   - 없으면 최상단 삽입, 200행 초과 시 가장 오래된 행 deleteRow
   - 사용자가 스크롤 위로 올린 상태에서는 추가된 높이만큼 scrollTop 보정 (위치 유지) + scroll-lock count++
   - feed:updated 커스텀 이벤트로 검색 필터 재적용
6. **검색 필터 적용 대상**: 셀 텍스트 (.model-name/.action-name/.prompt-preview/.target-role-badge). cell-msg 외 cell-cache/cell-token은 검색 불가.
7. **데이터 없음 vs 로드 실패**: 다른 메시지/색상.
8. **subType 매핑**: tool_name 'Agent' → agent, 'Skill' → skill, 'mcp__*' → mcp.
9. **prompt-preview 캐시**: `_promptCache: Map(id → text)` — 최대 500개. 확장 시 캐시에서 텍스트 가져옴.
10. **스크롤 락 배너 텍스트 갱신**: count 증감 시 텍스트 갱신.
11. **`fetchRequests(append=false)` 호출 시 `reqOffset = 0` 리셋**: 필터 변경/날짜 변경 시 처음부터 재조회.
12. **타입 필터 클릭 후 active 클래스 동기화**: 모든 버튼에서 active 제거 → 클릭 버튼만 추가.
13. **Agent/Skill/MCP 필터는 클라이언트 전용**: 서버 type 컬럼이 아닌 tool_name 기반 (서버에 type=agent 없음). data-sub-type 기준 DOM 필터.
14. **확장 패널 (prompt-expand-row)**: 행 아래 새 tr 삽입 (`colspan=10`). 안에 복사 버튼 + pre 텍스트.
15. **확장 패널 닫힘**: 다시 prompt-preview 클릭 시 닫힘. 다른 행 클릭 시 기존 확장 행 모두 제거 후 새로 표시.

---

## R3 — R2 반영 + 추가

### 보강

- **cell-target 구성 함수 분기 (`targetInnerHtml`)**:
  - prompt → `target-role-badge.role-badge-user` (◉ + user)
  - system → `target-role-badge.role-badge-system` (◉ + system)
  - tool_call w/ tool_name → action-name (`◉/◎` 아이콘 + 툴명) + 옵션 action-sub-name(Agent/Skill detail) + 옵션 action-model(model 짧은 이름) + 옵션 toolStatusBadge(오류만)
  - tool_call w/o tool_name 또는 비-tool → `—`
- **toolStatusBadge**: tool_response 파싱하여 오류만 빨간 mini-badge. Bash stderr, Agent/Skill content[].is_error, 그 외 tr.is_error.
- **toolResponseHint**: tool_call 타입에만, prompt-preview 끝에 추가:
  - Read: `[N줄]`
  - Bash: `[오류]` (stderr 있을 때) 또는 빈 문자열
  - Edit/Write/MultiEdit: `[저장됨]`
  - Grep: `[N개 파일]`
  - Glob: `[N개 매칭]`
  - Agent/Skill: `[실패]` (is_error)
- **prependRequest 인플레이스 업데이트 범위**: cell-target HTML + duration 텍스트만. cell-token (in/out)/cache는 갱신 안 함 — pre_tool 시점에는 토큰 미정이라 의도된 부분 갱신.
- **anomaly detection 흐름**:
  - `detectAnomalies(list, p95)` 호출 (api.fetchRequests 내부)
  - spike: 세션별 prompt tokens_input 평균의 200% 초과
  - loop: 동일 turn_id 내 동일 tool_name 연속 3회 이상
  - slow: tool_call duration_ms > p95
- **cache cell hover 툴팁**: `cache-tooltip.js`가 `.cache-cell` data 속성 기반 hover 툴팁 표시.
- **scroll lock 동작**:
  - feedBody scrollTop < 80px → 최신 위치로 간주 → 새 요청 도착 시 자동 스크롤 (jumpToLatest 효과 없이 자연 정렬)
  - scrollTop >= 80px → 사용자가 위로 본 상태 → scrollTop 보정 + count++ + 배너 표시

### 추가 인터랙션

- **세션 점프 (`data-goto-session`)**: cell-sess의 sess-id 클릭 시 main.js가 가로채 selectProject(데이터에 있는 project_name) + selectSession.
- **load more 표시 조건**: `list.length === REQ_PAGE && !isSSEConnected` — SSE 연결 시는 자동 갱신되므로 숨김.

---

## R4 — 검토 (미세·키보드·에러·상태 전이)

1. **테이블 행 키보드 접근성**: `<tr class="clickable">`이지만 tabindex 없음. Enter로 선택 불가.
2. **prompt-preview Enter/Space 확장**: tabindex 없음. 키보드로 확장 불가.
3. **검색 ESC 클리어 부재**: ESC 키 핸들러 없음. clear 버튼만.
4. **필터 키보드 단축키 부재**: 1~7 등으로 빠른 필터 부재.
5. **검색 + 필터 조합**: 둘 다 적용 (AND). filtered 카운트 표시 부재.
6. **"더 보기" 버튼 위치**: 테이블 아래 중앙 정렬, 인라인 스타일. SSE 연결 시 영구 숨김 — 발견 어려움.
7. **확장 패널 닫기 ESC 부재**: 다시 클릭만 닫힘.
8. **scroll-lock 배너 ARIA**: live region 없음. 스크린리더 미알림.
9. **"갱신: 시각" 부재 (행별)**: 행이 인플레이스 업데이트 됐는지 시각적 단서 없음. duration 텍스트만 변경.
10. **cell-target anomaly 배지 위치 분산**: spike/loop는 target, slow는 duration. 한 셀에 모으면 공간 부족 가능 (target 120px). 의도된 분산.
11. **fetch 실패 시 기존 행 유지**: append=false에서 catch 시 빈 메시지 표시(`tbody.innerHTML` 교체) — 기존 행 사라짐. SSE 끊긴 상태에서 fetchRequests 재시도 실패하면 사용자가 데이터를 잃음.
12. **`feed:updated` 이벤트 vs 검색 race**: prepend 후 즉시 dispatch — 검색 필터 재적용. 그러나 첫 렌더 직후 fetchRequests가 띄울 때도 dispatch 호출.
13. **prompt-preview 한 행에 여러 개**: tool_call 행 1개. 행당 1개라 OK.
14. **scroll-lock count 정확성**: prependRequest 호출 시마다 ++. 같은 id 인플레이스 업데이트 시는 ++ 안 함 (existing return).
15. **빈 목록 vs 로딩**: 첫 fetchRequests 응답이 빈 배열이면 "데이터 없음" 표시. 로딩 중 표시는 skeleton. fetchRequests catch는 빨간 텍스트.
16. **확장 패널 HTML 구조**:
  - 테이블 안: `<tr.prompt-expand-row><td colspan>...`
  - 테이블 외부: `<div data-expand-for>...`
  - 한 화면에 한 개만 (다른 클릭 시 모두 제거).

---

## R5 — R4 반영 + 최종 추가

### 추가된 미세·접근성·상태 전이

- **테이블 행 keyboard**:
  - tabindex 없음
  - 행 ↑↓ 이동 없음
  - Enter로 detail 진입 없음
  - Phase 2 보강 후보
- **검색 ESC 클리어 부재**
- **필터 키보드 단축키 부재**
- **scroll-lock 배너 `role="status"` 또는 `aria-live="polite"` 부재**
- **확장 패널 닫기 ESC 부재**
- **인플레이스 업데이트 시각 단서 부재** (방금 갱신된 행 강조 애니메이션 없음)
- **anomaly 배지 위치 분산 (target/duration)**: 시각 일관성 약화
- **fetch 실패 시 기존 행 사라짐 race**: catch가 `tbody.innerHTML` 교체로 처리 → SSE 일시 끊김 중 fetchRequests 호출이 실패하면 사용자 데이터 휘발. **잠재 UX 버그**.
- **Cache 컬럼 의미 모호**:
  - 헤더 "⚡Cache"만 있음
  - 값은 cache_read_tokens
  - 사용자가 "이게 캐시 히트 토큰인지 절약 토큰인지" 헷갈릴 수 있음 (cache-tooltip이 보충)
- **filtered 카운트 부재**: 검색 후 매치 건수 미표시
- **`renderRequests` 시 detectAnomalies는 호출되나 SSE prependRequest는 anomaly 미적용**: 즉, SSE로 새 요청이 들어와도 spike/loop/slow 배지가 즉시 안 붙음. 다음 fetchRequests/applyFeedSearch 시점에야 갱신.
- **filter button label 정렬 위계**: All/prompt/Agent/Skill/MCP/tool_call/system 7개 — 가독성 측면 그룹핑 부재 (디자이너 피드백 직접 후보).
- **검색 input width 인라인 style 없음**: feed-search CSS 의존.
- **column resize**: col-resize.js로 각 colgroup 컬럼 드래그 가능 + 더블클릭 Auto-fit. 영속화 정책 확인 필요.
- **테이블 horizontal scroll**: 좁은 폭에서 컬럼 합 > 너비면 가로 스크롤. 헤더는 sticky 미적용.
- **세션 점프 시 detail 진입 애니메이션**: 즉시 전환 (uiState.rightView='detail').

### 키보드 단축키 (현재 부재)

| 의도 | 현재 |
|------|------|
| 행 ↑↓ 이동 | 없음 |
| 행 Enter | 없음 |
| 검색 ESC 클리어 | 없음 |
| 필터 1~7 | 없음 |
| 확장 패널 ESC 닫기 | 없음 |
| Cmd/Ctrl+F 검색 포커스 | 없음 |
| 더 보기 단축키 | 없음 |

---

## 최종 기능 개수 (W5)

- 컨테이너/진입: 2개
- 검색: 4개 (input/icon/clear/실시간 필터)
- 타입 필터: 8개 (7버튼 + active 토글)
- 테이블 컬럼: 10개
- 행 렌더 변종: 4개 (prompt/system/tool_call/empty)
- toolResponseHint: 7개 (Read/Bash/Edit/Write/Grep/Glob/Agent/Skill)
- toolStatusBadge: 4개 (Bash/Agent/Skill/일반)
- anomaly 배지: 3개 (spike/loop/slow)
- cell-cache 툴팁: 1개
- 인플레이스 업데이트 (SSE prependRequest): 1개
- scroll-lock 배너: 3개 (텍스트/visible/jump)
- 더 보기 버튼: 2개 (조건 표시/페이지)
- 확장 패널: 3개 (테이블/외부/복사 버튼)
- 빈/에러 상태: 3개 (skeleton/데이터 없음/실패)
- 컬럼 resize: 2개 (드래그/더블클릭)

총 **약 57개 기능**.

## 발견된 누락·모호 (Phase 2 입력)

1. 타입 필터 7개 가독성/그룹핑 부족 (디자이너 피드백 직접)
2. 행 키보드 내비게이션 전무
3. ESC 핸들러 부재 (검색/확장 패널)
4. anomaly 배지 위치 분산 (target/duration)
5. fetch 실패 시 기존 행 사라짐 — UX 버그
6. SSE prependRequest는 anomaly 미적용
7. Cache 컬럼 의미 모호 — hover 툴팁 의존
8. filtered 카운트 표시 부재
9. 인플레이스 업데이트 시각 단서 부재
10. scroll-lock 배너 ARIA live 부재
11. 더 보기 버튼 SSE 연결 시 영구 숨김 — 데이터 발견 어려움
12. 컬럼 resize 영속화 정책 미정 (확인 필요)
13. 테이블 sticky header 부재 (좁은 폭에서 가독성 저하)
