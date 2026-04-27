# tui-history — History Tab (T3)

> TUI 두 번째 탭. 세션 목록 + 검색 필터 + 분할/토글 모드(120 cols 기준) + 세션 상세 요청 15개 + 타입별 소계.
> 5라운드 누적 인벤토리.

---

## R1 — 1차 작성

### 진입 조건
- activeTab === 'history'
- isActive prop으로 useInput 가드

### 데이터 소스
- props: sessions
- 자체 fetch: GET /api/sessions/${id}/requests (`fetchDetail`)
- detailRequests state (선택 시 로드)

### 분할 모드 (`columns >= 120`)
- 좌 40%: 세션 목록 (listView)
- 우 60%: 세션 상세 (detailView 또는 "세션을 선택하세요")

### 토글 모드 (`columns < 120`)
- showDetail false → listView
- showDetail true → detailView

### List View
- 헤더 (필터 적용 시): "Filter: ${filter}" (cyan)
- 컬럼 헤더 (5컬럼):
  - Project 25%
  - Started 25%
  - Duration 15%
  - Tokens 20% (right)
  - Status 15% (right)
- 빈 상태: "No sessions found." (gray)
- 행 (각 세션):
  - prefix: `●` 선택, `>` 커서, `  ` 그 외
  - color: cyan(선택) / white(커서) / gray(그 외)
  - bold: 선택/커서 시
  - Project (truncate, bold)
  - Started: TimeFormatter.formatDate
  - Duration: TimeFormatter.formatDuration(start, end)
  - Tokens: TokenFormatter.format (yellow 또는 cyan)
  - Status: `● Active` (green/cyan) / `○ Ended` (gray/cyan)
- 푸터: "↑↓ Navigate | Enter Select | / Search | ESC Deselect/Clear" (gray)

### Detail View
- 세션 헤더:
  - project_name (cyan bold truncate)
  - "${formatDate} · ${formatDuration}" (gray)
- detailError 있으면 표시 (red)
- detailLoading: "Loading..." (yellow)
- 응답 후 컬럼 헤더:
  - Type 10%
  - Tool / Description 30%
  - Preview 35%
  - Tokens · Time 25% (right)
- 행 (slice 15):
  - typeFormatter color/label
  - tool_name (white truncate)
  - preview (gray truncate)
  - tokens (yellow) + time (gray)
- 타입별 소계: typeColor와 함께 "type: count" 나열
- 좁은 폭 토글 모드: "ESC/Backspace → back"

### 키보드
- ↑↓: selectedIndex 이동
- Enter: 세션 선택 → setSelectedSessionId + setShowDetail(true) + onSessionSelect
- ESC: selectedSessionId 있으면 deselect, 없으면 filter clear
- Backspace: selectedSessionId 있으면 deselect
- /: filter clear (current)
- 그 외 input: filter 누적 (1글자씩)

---

## R2 — 검토

1. **filter 입력 방식 미숙**: 입력 키마다 1글자 추가. delete/backspace로 제거 부재 (Backspace는 deselect만).
2. **filter clear 트리거**: '/' 입력. 그러나 '/'가 filter 문자가 될 수 있는데 무동작 (filter 제거).
3. **isSplit 임계값 120 cols**: 하드코딩.
4. **15건 limit**: detailRequests slice(0, 15). 더 보기 부재.
5. **타입별 소계 정렬**: Object.entries 순서 (브라우저 의존).
6. **detailError 처리**: 404/네트워크 모두 setDetailError. 분기 미세 다름.
7. **fetchDetail silent fail (네트워크)**: catch에서 "요청 목록 로드 실패" 메시지 갱신만.
8. **showDetail 상태 vs selectedSessionId**: 분할 모드에서는 항상 detailView 표시 — showDetail 무관.
9. **isActive 가드**: 비활성 탭에서 키 이벤트 차단 ✅.
10. **tab 전환 후 selectedSessionId 보존**: tab 전환해도 state 유지 — 다시 history 진입 시 즉시 detail.
11. **빈 sessions**: filter 결과 빈 배열 → "No sessions found.".
12. **selectedIndex 범위 초과**: filteredSessions.length 변경 시 selectedIndex 초과 가능 — Math.min 가드 필요.

---

## R3 — R2 반영 + 추가

### 보강

- **filter 입력 UX**:
  - 입력 1글자씩 누적 (input.length === 1 가드)
  - Backspace는 deselect 우선 (selectedSessionId 있을 때만)
  - 결과: 검색 모드에서 backspace로 글자 삭제 불가 — **잠재 UX 버그**
- **'/' 입력**: filter clear ✅. 다만 사용자가 '/'를 검색하고 싶으면 입력 불가.
- **isSplit 120 hardcoded**: 모니터 환경에 의존. 수치 근거 약함.
- **15건 limit**: 한 화면에 들어가는 행 수 추정.
- **타입별 소계**: counts 객체 순서 — JS 객체 순서는 보장되나 정렬 명시 없음.
- **detailError 분기**:
  - 404: "세션 데이터를 찾을 수 없습니다" + selectedSessionId null로 리셋
  - 그 외 (네트워크 등): "요청 목록 로드 실패"
- **showDetail vs selectedSessionId 관계**:
  - 분할 모드: 항상 detail 표시 (selectedSession이 없으면 placeholder)
  - 토글 모드: showDetail이 명시 토글
- **selectedIndex 초기화 부재**: filter 변경 시 0으로 reset 안 함 — 범위 초과 시 Math.max(0)/Math.min(length-1) 보정.

### 추가 인터랙션

- **세션 선택 후 onSessionSelect prop 호출**: app.tsx에서 빈 함수 → 실제 동작 부재.
- **filter 명시 입력 UI**: 헤더 "Filter: ${filter}"만 표시, 테두리 없음.

---

## R4 — 검토 (미세·키보드·에러·상태 전이)

1. **Backspace 검색 모드 충돌**: 사용자가 "abc" 입력 후 'b' 삭제하고 싶을 때 Backspace 누르면 deselect. 검색어 수정 불가.
2. **filter 영문/한글 처리**: ko-KR 한글 입력 — useInput 단일 키 처리이므로 한글 IME 지원 부재 가능.
3. **'/' 키로 검색 클리어**: 일반 단축키 관례(`/`로 검색 시작)와 정반대.
4. **15개 limit 표시 누락**: 더 많은 요청이 있어도 사용자에게 "더 보기" 부재.
5. **타입별 소계 색상**: typeColor — 5종 타입(prompt/tool_call/system/agent/skill?)에 매핑. mcp 등 추가 타입은 default로 처리.
6. **분할 모드에서 빈 detail**: "세션을 선택하세요" — 한국어. 다른 메시지는 영문.
7. **fetchDetail 진행 중 다른 세션 선택**: 새 fetch 시작 — 이전 fetch 결과 race 가능. AbortController 미적용.
8. **selectedIndex out of range**: filteredSessions.length 갱신 시 selectedIndex 초과 가능 — 코드의 `Math.min(filteredSessions.length - 1, prev + 1)`은 최댓값 ✅, but `selectedIndex`가 이미 length 초과 상태에서 새 filter 적용 시 보정 안 됨.
9. **ESC vs Backspace 동작 분기**: ESC는 selectedSessionId 있으면 deselect, 없으면 filter clear. Backspace는 deselect만 + setShowDetail(false).
10. **showDetail 상태와 useInput 분기**:
    - showDetail && !isSplit: ESC/Backspace로 listView 복귀
    - 그 외: 일반 키 처리
11. **listView 푸터 안내**: ESC Deselect/Clear — 사용자가 의미 추측해야 함.
12. **TUI에서 filter prompt 시각 단서 약함**: 헤더 "Filter: abc"만 — input 박스 부재.

---

## R5 — R4 반영 + 최종 추가

### 추가된 미세·접근성·상태 전이

- **Backspace 검색 충돌 — UX 버그**:
  - 검색어 수정 불가
  - Phase 2에서 모드 분리 후보 (filter mode vs nav mode)
- **한글 IME 미지원**: useInput은 단일 키 처리만
- **'/' 키 시맨틱 비표준** (검색 시작 vs 클리어)
- **15개 limit 표시 부재**: 사용자가 데이터 부족 인지 어려움
- **타입별 소계 색상 누락 타입**: agent/skill/mcp 등이 누락된 타입명일 때 처리 미명세
- **분할 모드 한국어 placeholder vs 영문 페이저**: 일관성 약함
- **fetchDetail race**: 빠른 연속 클릭 시 이전 응답이 새 세션 데이터로 잘못 표시될 수 있음
- **selectedIndex 보정 부재**: filter 변경 시 0 리셋 후보
- **ESC/Backspace 동작 분기 모호**:
  - ESC → deselect 또는 filter clear
  - Backspace → deselect (only when selectedSessionId)
- **showDetail vs selectedSessionId 두 state**: 동기화 책임 사용자에게 분산
- **filter input 시각 단서 약함**: 텍스트만 — Box border/background 부재
- **푸터 안내 영문**: 일관성
- **타입별 소계 marginRight=2 inline**: 미세 인라인 스타일
- **세션 행 prefix `●`(선택) vs `>`(커서) 시각 차이 약함**: 둘 다 작은 글자
- **선택 색 cyan, 커서 색 white**: 차이 명확
- **분할 모드 세로 분할 부재**: 좌우만, 메인 영역만 — 사이드바와 동시 표시 시 폭 부족 가능
- **detailRequests 갱신 (SSE 미적용)**: 정적 fetch만 — 활성 세션의 변경 미반영

### 키보드 단축키 (구현 vs 부재)

| 의도 | 현재 |
|------|------|
| ↑↓ 이동 | ✅ |
| Enter 선택 | ✅ |
| ESC deselect/clear | ✅ |
| Backspace deselect | ✅ (검색 충돌 ❌) |
| / 검색 클리어 | ✅ (시맨틱 비표준) |
| 일반 키 검색 입력 | ✅ |
| 검색 글자 삭제 | ❌ |
| 더 보기 | ❌ |
| ESC로 검색 종료 (글자 보존) | 없음 |
| Cmd/Ctrl+F 명시 검색 진입 | 없음 |

---

## 최종 기능 개수 (T3)

- 진입/데이터: 3개
- 분할/토글 모드 (120 cols 임계값): 1개
- List View
  - 컬럼 5개: 5개
  - 빈 상태: 1개
  - prefix 3종: 3개
  - color 상태 3종: 3개
  - 푸터 안내: 1개
- Detail View
  - 헤더: 1개
  - 에러/로딩: 2개
  - 컬럼 4개: 4개
  - 행 (15 슬라이스): 1개
  - 타입별 소계: 1개
  - 좁은 폭 푸터: 1개
- 키보드 6종: 6개
- fetch (404/실패 분기): 1개

총 **약 33개 기능**.

## 발견된 누락·모호 (Phase 2 입력)

1. Backspace 검색 충돌 — 검색어 수정 불가
2. 한글 IME 미지원
3. '/' 키 시맨틱 비표준
4. 15개 limit + 더 보기 부재
5. 분할 모드 한국어/영문 일관성 약함
6. fetchDetail race (AbortController 부재)
7. selectedIndex 보정 부재
8. showDetail vs selectedSessionId 두 state 동기화
9. filter input 시각 단서 약함
10. detailRequests SSE 미적용 (정적)
11. ESC/Backspace 동작 분기 모호
12. 타입별 소계 색상 누락 타입 처리
13. Cmd/Ctrl+F 명시 검색 진입 부재
