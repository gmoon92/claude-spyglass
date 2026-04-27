# tui-analysis — Analysis Tab (T4)

> TUI 세 번째 탭. 4개 섹션(Overview/Top Requests/By Type/By Tool) + ←→ 섹션 전환.
> 5라운드 누적 인벤토리.

---

## R1 — 1차 작성

### 진입 조건
- activeTab === 'analysis'
- isActive prop으로 useInput 가드

### 데이터 소스
- useAnalysis: { data, loading, errors }
- data: { topRequests, typeStats, toolStats, errors }

### 로딩/빈 상태
- loading && !data → "Loading analysis data..." (yellow)
- 모든 stats 빈 배열 → "No analysis data available." (gray)

### 섹션 탭 헤더
- 4개 섹션 가로 나열 (`Box marginBottom=1`)
- 각 섹션 paddingX=2
- 활성: `> ${section}` (cyan bold)
- 비활성: `  ${section}` (gray)

### 섹션 1 — Overview
- 헤더: "Summary" (cyan bold underline)
- 3컬럼 통계:
  - Total Requests (33%)
  - Total Tokens (33%, yellow)
  - Avg Tokens/Req (33%)
- 계산: typeStats reduce sum

### 섹션 2 — Top Token Consumers
- 헤더: "Top Token Consumers" (cyan bold underline)
- 컬럼 헤더 (#/Type/Tool-Model/Tokens):
  - 10/30/40/20%
- 행 (slice 10):
  - rank
  - type (color from RequestTypeFormatter)
  - tool_name (truncate)
  - tokens (yellow)

### 섹션 3 — By Type
- 헤더: "Requests by Type"
- 컬럼: Type/Count/Tokens/% (30/20/25/25%)
- 행: 모든 stats
  - type (color)
  - count
  - total_tokens (yellow)
  - percentage (gray, 1 decimal)

### 섹션 4 — By Tool
- 헤더: "Top Tools"
- 컬럼: Tool/Calls/Tokens (40/30/30%)
- 행 (slice 10):
  - tool_name (yellow)
  - call_count
  - total_tokens (cyan)

### 키보드
- ←: activeSection -=1 (Math.max 0)
- →: activeSection +=1 (Math.min 3)

### 에러 표시
- data.errors.{top, type, tool} 중 하나라도 있으면 하단에 "일부 데이터 로드 실패 — 재시도 중" (red dim)

### 푸터
- "←→ Switch Section" (gray)

---

## R2 — 검토

1. **각 섹션 행 슬라이스 비일관**: Top 10, Type 모두, Tool 10. By Type만 무제한.
2. **Overview 계산 출처**: typeStats 기반 — Top/Tool 데이터와 별도 출처. 그러나 합산 의미는 동일해야 함.
3. **타입별 소계 percentage**: total 0이면 0%.
4. **Top Requests 행 height=1**: 한 줄 — 긴 tool/model이 잘리면 정보 손실.
5. **error display**: data.errors 객체. 부분 실패 시 일부 데이터만 표시.
6. **섹션 전환 시 데이터 fetch race**: useAnalysis가 4종 데이터 동시 fetch — 일부 실패 시 다른 섹션 영향.
7. **`> ${section}` prefix vs 단일 섹션 표시**: 4개 모두 표시되어 사용자가 어디 있는지 알기 쉬움.
8. **isActive 가드 ✅**.
9. **`useState(0)` 초기값**: Overview 진입.
10. **percentage 계산**: stat.total_tokens / totalTokens * 100. divide-by-zero 가드.
11. **빈 stats 표시**: "No analysis data available." — 모든 카테고리 빈 경우.

---

## R3 — R2 반영 + 추가

### 보강

- **섹션별 슬라이스 일관성 부족**:
  - Top Token Consumers: 10
  - By Type: 무제한
  - Top Tools: 10
  - By Type가 무제한인 이유 명확하지 않음 (타입은 보통 5종 이내라 의도된 것일 수도)
- **Overview vs By Type 데이터**: 같은 typeStats 기반이지만 Overview는 합계만, By Type은 행별.
- **Top Requests 행 정보 손실**: 60자 이상 tool_name 잘림.
- **error 부분 실패**:
  - useAnalysis가 3개 API 병렬 호출
  - 일부 실패 → errors 객체에 기록
  - 데이터는 부분 표시
- **percentage divide-by-zero**: `totalTokens > 0 ? ... : 0` 가드 ✅.
- **활성 섹션 시각 단서**:
  - prefix `> ` 차이
  - color cyan vs gray 차이
  - bold 차이

### 추가 인터랙션

- **데이터 갱신**: useAnalysis 자체 폴링 또는 SSE? 코드 미확인. 사용자가 새로고침 단축키 부재.
- **섹션 1~4 단축키**: 부재 (←→만).
- **섹션 점프 단축키 (1/2/3/4)**: 부재 — useKeyboard에서 1~4는 탭 전환에 사용.
- **세션/요청 점프 부재**: Top Requests 행 클릭/Enter로 detail 이동 부재.

---

## R4 — 검토 (미세·키보드·에러·상태 전이)

1. **Top Requests에서 세션 점프 부재**: 어떤 요청이 비싸다는 정보만, 그 세션으로 가는 동선 부재.
2. **By Tool에서 도구 검색 부재**: 도구가 많으면 스크롤 못하고 10개만 표시.
3. **By Type %에서 100% 초과 가능?**: 정확히 reduce sum이면 항상 100%. 그러나 부분 데이터 시 합 ≠ totalTokens 가능.
4. **error 표시 위치**: 모든 섹션 하단에 통합 — 부분 실패가 어떤 섹션 영향인지 불명확.
5. **로딩 상태에서 부분 데이터**: loading && !data → "Loading...". 이후 부분 응답 → 일부 표시 + 일부 빈.
6. **빈 데이터 vs 에러**: 빈 데이터 "No analysis data available." vs 에러 "일부 데이터 로드 실패 — 재시도 중". 차이 명확.
7. **`재시도 중` 자동 재시도 메시지**: 그러나 useAnalysis가 자동 재시도 하는지 확인 필요. 메시지가 거짓 약속일 수 있음.
8. **useInput 가드**: isActive 미전달이면 false → 다른 탭에서 useInput이 비활성. 정상.
9. **빈 stats 모두 비어 있을 때만 "No analysis"**: 일부 비어 있으면 "No analysis" 안 보이고 빈 행만 — 사용자에게 데이터 부재 표시 약함.
10. **section 0~3 hardcoded**: 매직 넘버.
11. **각 섹션 헤더 underline**: 시각 강조 ✅.
12. **테두리 없음**: 섹션 간 구분선 부재.

---

## R5 — R4 반영 + 최종 추가

### 추가된 미세·접근성·상태 전이

- **Top Requests 세션 점프 부재**: 발견 → Action 흐름 끊김
- **By Tool 도구 많을 때 10 limit + 검색/스크롤 부재**
- **By Type 무제한 vs Top/Tool 10 limit**: 슬라이스 정책 비일관
- **error 위치 통합 — 어떤 섹션 영향인지 모호**
- **`재시도 중` 메시지 검증 필요** (자동 재시도 여부)
- **빈 stats 부분 비어 있을 때 표시 약함**: 빈 행 노출
- **section 0~3 hardcoded**
- **테두리 없음** — 섹션 시각 분리 약함
- **percentage 100% 초과 가능 (부분 데이터)** — 합 ≠ total 시
- **타입별 색상 (RequestTypeFormatter)**: 일관 ✅ (TUI/Web 공유)
- **Top Tools `yellow` color**: 도구명 강조
- **By Tool count `white` 기본색 (no Text color prop)**: 시각 위계 부족
- **By Type count `white` 기본색**: 동일
- **bold 사용 적음**: 섹션 헤더만 bold — 행 내 핵심값 강조 부재
- **Overview 한 화면**: 3종 통계만 — 세부 비교 어려움. 트렌드/시계열 표시 부재
- **기본 진입 0 (Overview)**: 사용자가 자주 보는 섹션 우선이 합리

### 키보드 단축키 (구현 vs 부재)

| 의도 | 현재 |
|------|------|
| ←→ 섹션 전환 | ✅ |
| ↑↓ 행 이동 | ❌ |
| Enter 행 선택 (세션 점프) | ❌ |
| 1/2/3/4 섹션 점프 | ❌ (탭 전환에 사용) |
| 검색 | ❌ |
| 새로고침 | ❌ |

---

## 최종 기능 개수 (T4)

- 진입/데이터: 2개
- 로딩/빈 상태: 2개
- 섹션 탭 헤더 (4종 + active 시각): 5개
- Overview (3종 통계): 3개
- Top Requests (4컬럼 + slice 10): 5개
- By Type (4컬럼 + 무제한): 5개
- By Tool (3컬럼 + slice 10): 4개
- 키보드 ←→: 2개
- 에러 표시: 1개
- 푸터: 1개

총 **약 30개 기능**.

## 발견된 누락·모호 (Phase 2 입력)

1. Top Requests 세션 점프 부재 (발견 → Action 흐름 끊김)
2. By Tool 도구 검색/스크롤 부재 (10 limit)
3. 슬라이스 정책 비일관 (Top/Tool 10, By Type 무제한)
4. error 위치 통합 — 어떤 섹션 영향인지 모호
5. "재시도 중" 메시지 검증 필요 (자동 재시도 여부)
6. 빈 stats 부분 표시 약함
7. 섹션 1/2/3/4 단축키 부재 (탭 전환에 사용으로 충돌)
8. 행 ↑↓ 이동/Enter 부재
9. 검색/새로고침 부재
10. 행 내 핵심값 bold 부재 (시각 위계)
11. 섹션 테두리 없음 (시각 분리 약함)
12. percentage 100% 초과 가능 (부분 데이터)
