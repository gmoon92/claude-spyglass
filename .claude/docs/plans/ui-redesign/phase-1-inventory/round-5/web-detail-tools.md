# web-detail-tools — Detail Tools View (W12)

> 세션 상세의 네 번째 탭. 도구별 통계 — 평균 응답시간 / 호출 횟수 / 토큰 기여도 3섹션 막대 그래프.
> 5라운드 누적 인벤토리.

---

## R1 — 1차 작성

### 컨테이너 (`#detailToolsView.detail-content`)

- 자체 스크롤 영역
- 진입 시 `loadToolStats(_currentSessionId)` 호출 (setDetailView 'tools' 시점)

### 데이터 흐름
- API: `GET /api/sessions/{id}/tool-stats`
- 응답 구조 (each):
  - tool_name
  - call_count
  - avg_duration_ms
  - max_duration_ms
  - total_tokens
  - error_count
  - pct_of_total_tokens

### 빈 상태
- "로딩 중…" (loadToolStats 시작 시)
- "tool_call 데이터 없음" (빈 배열)
- "데이터를 불러올 수 없습니다" (catch)

### 3섹션 (`.tool-stats-panel`)

#### 섹션 1 — 평균 응답시간 (`.ts-section-title` "평균 응답시간")
- 정렬: avg_duration_ms 내림차순
- 행 (`.ts-row`):
  - `.ts-name` 도구명 (title 속성)
  - `.ts-bar-wrap > .ts-bar.ts-bar-dur` (width %)
  - `.ts-val` `${fmtDur(avg_duration_ms)}` (ms/s/m s)
  - `.ts-sub` `max ${fmtDur(max_duration_ms)}`

#### 섹션 2 — 호출 횟수 (`.ts-section-title` "호출 횟수")
- 정렬: call_count 내림차순
- 행:
  - 도구명
  - 막대 (`.ts-bar.ts-bar-call`, width %)
  - `${call_count}회`
  - 옵션 `.ts-err-badge` `오류 ${error_count}` (error_count > 0)

#### 섹션 3 — 토큰 기여도 (`.ts-section-title` "토큰 기여도")
- 정렬: pct_of_total_tokens 내림차순
- 행:
  - 도구명
  - 막대 (`.ts-bar.ts-bar-tok`, width % min 100)
  - `${pct.toFixed(1)}%`
  - `.ts-sub` `${fmtToken(total_tokens)}`

### 포매팅
- `fmtDur(ms)`:
  - 0/없음 → `—`
  - <1000 → `${Math.round(ms)}ms`
  - <60000 → `${(ms/1000).toFixed(1)}s`
  - 그 외 → `${Math.floor(ms/60000)}m${...}s`

---

## R2 — 검토

1. **에러 카운트 0일 때**: ts-err-badge 미표시.
2. **빈 sessionId**: loadToolStats(null) 호출 가드 부재? 코드는 `if (!_container) return`만 — sessionId는 검증 안 함.
3. **세션 전환 시 clear**: clearToolStats 호출 → innerHTML 비움.
4. **3섹션 정렬 다름**: 같은 데이터 3번 sort. 시각적 비교 위해 같은 도구가 다른 위치에 등장.
5. **막대 색상 3종**: ts-bar-dur/call/tok — CSS 변수 매핑 확인 필요.
6. **막대 너비 정규화**: 섹션별 max 값 기준 100% 정규화.
7. **fmtDur 분 단위**: `${minutes}m${seconds}s` — 60s 미만이면 ms/s만.
8. **escHtml 자체 정의 (tool-stats.js 안)**: 다른 모듈은 import 사용. 코드 중복.
9. **반응형 부재**: 좁은 폭에서 막대/텍스트 줄바꿈 정책 미확인.
10. **검색/필터 미적용**: detail-controls-bar 검색·필터가 tools 뷰에 영향 없음.

---

## R3 — R2 반영 + 추가

### 보강

- **빈 sessionId 가드**: 코드에 명시 가드 없음. selectSession에서 setDetailView('tools') 호출 전에 sessionId가 있어야 함 — 일반 흐름에서는 가드 불필요.
- **3섹션 정렬 의도**:
  - 응답시간: 느린 순
  - 호출 횟수: 많은 순
  - 토큰 기여도: 큰 순
  - 다른 관점에서 도구를 보기 위함 — 일관성 vs 다관점 트레이드오프
- **막대 색상 3종**:
  - ts-bar-dur: 응답시간 — CSS 확인 필요 (orange/red 계열 추정)
  - ts-bar-call: 호출 횟수 — green
  - ts-bar-tok: 토큰 — accent/orange
  - 각 섹션 식별용 색
- **막대 정규화**:
  - 응답시간: maxDur 기준
  - 호출: maxCalls 기준
  - 토큰: pct 자체 (이미 0~100). min(pct, 100)으로 클램프 — 100% 초과 가능 시 100으로 제한
- **사이즈 미명세**: tool-stats-panel 패딩, ts-row 높이 등 CSS에 위임.
- **로딩 상태**: 매 진입마다 "로딩 중…" 짧게 표시 → 응답 후 교체. 캐시 부재 — 같은 세션 재진입도 매번 로딩.

### 추가 인터랙션

- **막대 hover**: title 또는 별도 툴팁 부재.
- **도구 클릭 동작**: 부재.
- **섹션 접기**: 부재.

---

## R4 — 검토 (미세·키보드·에러·상태 전이)

1. **키보드 접근성**:
   - tool-stats-panel 내부 인터랙션 없음
   - 정적 표시만 — Tab 포커스/Enter 부재 (의도된 단순 표시)
2. **ARIA 부재**: 막대 그래프이지만 aria-label/role 미부여.
3. **막대 width % 정규화 한 섹션이 다른 섹션 의미 잃음**:
   - 같은 도구라도 응답시간 섹션과 호출 섹션의 막대 길이는 무관
   - 사용자가 "이 막대는 무엇 기준인지"를 매번 확인해야 함
4. **3섹션 같은 도구 비교 어려움**:
   - 1번 섹션의 1위가 2번 섹션의 5위일 수 있음
   - 시각적으로 흐름을 따라가기 힘듦
5. **에러 배지 위치 일관성**: 호출 횟수 섹션에만. 응답시간/토큰 섹션에는 미표시.
6. **로딩 중 데이터 부재 표시**: "로딩 중…" 단순 텍스트.
7. **fetch 실패 처리**: catch에서 메시지 갱신만. 재시도 버튼 부재.
8. **빈 데이터 vs 로딩 vs 실패 메시지 비일관**:
   - 로딩: "로딩 중…"
   - 빈: "tool_call 데이터 없음"
   - 실패: "데이터를 불러올 수 없습니다"
9. **세션 전환 시 잔존 데이터 깜박임**: clearToolStats가 innerHTML 비우지만, 다음 진입 시 "로딩 중…" → 응답 → 데이터 — 깜박임 가능.
10. **3섹션 정렬 변경 옵션 부재**: 사용자가 정렬 기준 변경 불가.
11. **검색/필터 미적용**:
   - W8 검색이 tools 뷰에 영향 없음
   - 도구가 많으면 스크롤만 가능 — 검색 어려움
12. **tools 뷰 진입 시 데이터 로드 시점**: setDetailView('tools') 시점. flat/turn/gantt에서 tools로 전환 시 비로소 fetch.
13. **sessionId 변경 race**: 사용자가 빠르게 세션 전환 + tools 탭 진입 → 두 fetch race 가능. AbortController 미적용.
14. **escHtml 코드 중복**: formatters.js의 escHtml 사용 안 하고 자체 정의.

---

## R5 — R4 반영 + 최종 추가

### 추가된 미세·접근성·상태 전이

- **막대 그래프 ARIA 부재**: `role="img"` + aria-label로 "도구별 평균 응답시간 막대 그래프" 같은 설명 미제공
- **정렬 기준 변경 옵션 부재**: 사용자가 어느 기준으로 비교할지 선택 불가
- **3섹션 같은 도구 비교 어려움**: 디자이너 피드백 "덩어리 부재" 후보 — 한 도구의 세 지표를 한 행에 보여주는 단일 매트릭스 뷰 후보
- **에러 배지 위치 일관성**: 응답시간/토큰 섹션에도 표시 후보
- **검색/필터 미적용**: W8 컨트롤 무시 — 사용자에게 혼란
- **fetch 재시도 버튼 부재**
- **로딩 깜박임**: 캐시/skeleton 부재
- **AbortController 미적용**: 빠른 세션/탭 전환 race
- **escHtml 코드 중복**: 단순 리팩터 후보
- **막대 색상 토큰화 부재**: CSS 확인 필요
- **fmtDur 분 단위 표기**: `${m}m${s}s` — 영문 단위. 한국어 일관성 약함
- **ts-sub 텍스트 위계**: 메인 값과 같은 행, 작은 글씨로 보조 정보
- **tools 뷰가 다른 뷰와 시각 언어 다름**: flat/turn은 테이블/카드, tools는 막대 그래프 — 의도된 다관점이지만 일관성 약함
- **막대 길이 0 처리**: avg_duration_ms=0이면 width 0% → 막대 안 보임. 텍스트 `—`만.
- **세션 전환 후 자동 tools 진입 시 자동 fetch**: 그러나 setDetailView('tools')가 호출되어야 fetch — 자동 진입 부재.

### 키보드 단축키 (현재 부재)

| 의도 | 현재 |
|------|------|
| 도구 ↑↓ 이동 | 없음 |
| 정렬 변경 | 없음 |
| 도구 검색 | 없음 |
| 섹션 접기 | 없음 |

---

## 최종 기능 개수 (W12)

- 컨테이너: 1개
- 데이터 fetch (loadToolStats): 1개
- clearToolStats (세션 전환 시): 1개
- 빈 상태 3종 (로딩/빈/실패): 3개
- 섹션 3개:
  - 평균 응답시간 (정렬/막대/값/sub max): 4개
  - 호출 횟수 (정렬/막대/값/오류 배지): 4개
  - 토큰 기여도 (정렬/막대/값/sub fmtToken): 4개
- 막대 색상 3종: 3개
- fmtDur 단위 분기 (ms/s/m s): 1개
- 정규화 (max 기준): 3개

총 **약 25개 기능**.

## 발견된 누락·모호 (Phase 2 입력)

1. 막대 그래프 ARIA 부재
2. 정렬 기준 변경 옵션 부재
3. 3섹션 같은 도구 비교 어려움 (단일 매트릭스 뷰 후보)
4. 에러 배지 위치 비일관 (호출 섹션만)
5. 검색/필터 미적용 (W8 컨트롤 무시)
6. fetch 재시도 버튼 부재
7. 로딩 skeleton 부재 (깜박임)
8. AbortController 미적용 (race)
9. escHtml 코드 중복
10. 막대 색상 CSS 토큰화 부재
11. fmtDur 단위 영문 (m/s 한국어 vs 영문 혼재)
12. tools 뷰 시각 언어가 다른 뷰와 다름 (시각 일관성 약함)
13. 빈 상태 텍스트 비일관 ("tool_call 데이터 없음" vs flat "요청 데이터 없음")
