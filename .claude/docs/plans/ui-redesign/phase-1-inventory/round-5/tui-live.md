# tui-live — Live Tab (T2)

> TUI 첫 번째 탭. 실시간 토큰 카운터 + 프로그레스 바 + 활성 세션 + 세션 타이머 + 요약 통계 3개 + 최근 요청 8개.
> 5라운드 누적 인벤토리.

---

## R1 — 1차 작성

### 진입 조건
- activeTab === 'live'

### 데이터 소스
- props: { data, isLoading, error } (useStats)
- useSSE: { status, messages, lastMessage }
- 자체 fetch: GET /api/requests?limit=20 (`fetchRecent`)
- recentRequests state (max 20, 표시 8개)

### 로딩/에러 상태
- isLoading && !data → "Loading..." (yellow)
- error → "Error: ${error}" (red) + "Make sure spyglass server is running on port 9999" + "API: http://localhost:9999/api/dashboard" (gray)

### 헤더 상태 (`Box marginBottom`)
- SSE status: ● LIVE (green) / ⟳ Connecting (yellow) / ○ Disconnected (red)
- "| Last update: ${currentTime}" (gray)

### 메인 카운터 (`Box borderStyle="round" borderColor="cyan"`)
- "Total Tokens: " (gray) + `${TokenFormatter.format(tokens)}` (cyan bold)
- ProgressBar (width 40 또는 columns-30)
- "${tokens} / ${maxTokens} (${progress}%)" (gray)
- maxTokens = 100000 (하드코딩)

### 세션 정보
- Active Sessions: ${count} (yellow bold)
- Session Time: SessionTimer (active 세션 0번째)
  - active 없으면: "--:--:--"

### 요약 통계 3종 (Box flexDirection="row")
- Total Sessions: ${count}
- Total Requests: ${count}
- Avg Tokens/Req: ${avg}

### 최근 요청 목록 (`Box flexDirection="column"`)
- 헤더: "Recent Requests (${count})" (gray underline)
- 빈 상태: "No requests yet..."
- 각 요청 행 (slice 8):
  - Box height=1
    - 4%: typeFormatter.getLabel (color)
    - 50%: tool_name (white truncate)
    - 26%: TokenFormatter (yellow, 우측 정렬)
    - 20%: timestamp (gray, 우측 정렬)
  - 옵션 preview (paddingLeft 1): "↳ ${preview}" (gray truncate)

### Re-fetch 트리거
- SSE new_request 수신 → useEffect로 fetchRecent
- SSE 재연결 감지 → fetchRecent
- 초기 로드 → fetchRecent

---

## R2 — 검토

1. **maxTokens 100000 하드코딩**: 사용자 모델별 상이 — Settings의 critical/warning과 무관.
2. **progress 100% 클램프**: `Math.min((tokens/maxTokens)*100, 100)` — 초과 시 100%로 표시.
3. **active 세션 0번째만 사용**: 여러 활성 세션 있을 때 첫 번째만 보여줌.
4. **SessionTimer 컴포넌트 별도 정의**: 시작/종료 시각 기반 경과 시간 표시.
5. **Session Time 비활성 표시**: "--:--:--" — endedAt가 있는 세션은 SessionTimer가 정지된 시간 표시.
6. **Recent Requests 8개 제한**: 20개 fetch 후 8개만 표시 — 나머지 12개 미사용.
7. **timestamp 포맷**: `new Date(req.timestamp).toLocaleTimeString()` — 로케일 의존, ko-KR 미강제.
8. **type/tool/tokens/time 너비 4/50/26/20% (총 100%)**: 합산 100%.
9. **emoji ●/○/⟳**: 터미널 호환성.
10. **fetchRecent silent fail**: catch에서 무동작.
11. **lastMessage timestamp용 useMemo**: lastMessage 변경 시 currentTime 갱신.
12. **prevStatusRef**: SSE 상태 변경 감지로 재연결 시 fetchRecent.
13. **isLoading vs error**: error 우선 검사 후 isLoading. data 없을 때만 Loading 표시.

---

## R3 — R2 반영 + 추가

### 보강

- **maxTokens 하드코딩**:
  - Settings의 warning/critical과 무관
  - 사용자 컨텍스트 한도와 무관
  - 잠재 정확성 문제
- **active 세션 첫 번째만**: data.active[0]만 사용. 여러 활성 세션이면 다른 세션의 타이머 미표시.
- **SessionTimer 정의**:
  - startedAt prop, endedAt prop (옵션)
  - 1초마다 setInterval로 경과 시간 갱신
  - HH:MM:SS 포맷
- **8개 vs 20개 (Recent Requests)**:
  - fetchRecent는 limit=20 (MAX_RECENT)
  - slice(0, 8)만 렌더 — 매직 넘버
  - 8개 제한 이유: 세로 폭 확보 (헤더 + 카운터 + 통계 + 8행 약 14~16행)
- **timestamp 로케일 의존**: 다국어 환경에서 비일관 가능
- **fetchRecent silent fail 영향**: 사용자에게 알림 없음 → 데이터 stale 가능

### 추가 인터랙션

- **recentRequests 행 클릭**: 부재 (TUI는 키보드 전용, 클릭도 미구현)
- **세션 타이머 정확성**: SessionTimer setInterval (1000ms)
- **데이터 갱신 주기**:
  - useStats: 5초마다 fetchDashboard
  - SSE: 즉시
  - useEffect로 SSE → fetchRecent 트리거

---

## R4 — 검토 (미세·키보드·에러·상태 전이)

1. **Live Tab 키보드 인터랙션 부재**:
   - Recent Requests 행 ↑↓ 이동 없음
   - Enter로 세션/요청 점프 없음
   - 정적 표시만
2. **isActive prop 미사용**: app.tsx에서 LiveTab은 isActive 불필요 (자체 useInput 없음).
3. **SSE 재연결 감지 race**: prevStatusRef 비교 — 빠른 connecting → connected 전환 시 fetch 누락 가능.
4. **fetch 실패 누적**: 5초마다 useStats 폴링도 silent. 사용자가 데이터 stale 인지 어려움.
5. **maxTokens=100K 비현실**: Claude Sonnet 200K, Opus 200K. 실제 진행률 50%로 표시될 것.
6. **progress > 100% 처리**: clamp만, 초과 시 빨간색 등 시각 단서 부재.
7. **Active Sessions count 다중 표시 부재**: count만 있고 각 세션 정보 없음.
8. **Total Tokens 단위**: TokenFormatter의 k/M 분기 — 1000 미만은 raw 숫자.
9. **요약 통계 3종 (Total Sessions/Requests/Avg)**: data 없을 때 0/0/0 표시.
10. **Recent Requests preview**: 있을 때만 추가 행. 없으면 단일 행.
11. **timestamp 동적 갱신**: lastMessage 변경 시만. 1분 이상 SSE 없으면 stale.
12. **로딩 상태 화면 차지**: "Loading..." 단일 텍스트 — 다른 콘텐츠 보존 안 됨.
13. **에러 화면 단순 텍스트**: 재시도 버튼 부재.

---

## R5 — R4 반영 + 최종 추가

### 추가된 미세·접근성·상태 전이

- **Recent Requests 키보드 내비 부재**: 정적
- **isActive prop unused**: cosmetic
- **SSE race**: 잠재 (재연결 빈도 낮으면 영향 적음)
- **fetch 실패 silent**: 사용자에게 알림 부재
- **maxTokens 100K 비현실**:
  - 실제 200K이면 100K 토큰에서 50% 표시
  - 사용자에게 잘못된 안전감 제공
  - **잠재 정확성 버그**
- **progress 초과 시각 단서 부재** (clamp만)
- **Active Sessions 다중 미표시**
- **timestamp 갱신 stale 위험**
- **에러 상태 재시도 버튼 부재**
- **레이아웃 폭 분배 (4/50/26/20)**: 합산 100% — 좁은 터미널에서 가독성 저하
- **이모지 ●/○/⟳ fallback 부재**
- **statusText upper case "● LIVE"/"○ Disconnected"**: 일관성 약함 (LIVE는 대문자, Disconnected는 첫 글자만)
- **TokenFormatter / RequestTypeFormatter 사용**: TUI/Web 일관성 ✅
- **SessionTimer 1초 setInterval**: 종료 후에도 유지되는지 unmount 체크 필요

### 키보드 단축키 (현재 부재)

| 의도 | 현재 |
|------|------|
| Recent Requests ↑↓ | 없음 |
| Recent Requests Enter | 없음 |
| 세션 점프 | 없음 |
| ProgressBar 시각 강조 (위험) | 없음 |
| 재시도 (에러 시) | 없음 |

---

## 최종 기능 개수 (T2)

- 진입/데이터 소스: 4개
- 로딩/에러 상태: 2개
- 헤더 상태 (3종 SSE + last update): 4개
- 메인 카운터 (Total Tokens/Bar/단위): 3개
- maxTokens 하드코딩: 1개
- 세션 정보 (Active count + SessionTimer): 2개
- 요약 통계 3종: 3개
- Recent Requests
  - 헤더 카운트: 1개
  - 빈 상태: 1개
  - 각 행 5필드 (type/tool/tokens/time/preview): 5개
  - 8개 슬라이스: 1개
- Re-fetch 트리거 3종: 3개

총 **약 30개 기능**.

## 발견된 누락·모호 (Phase 2 입력)

1. maxTokens=100K 하드코딩 — 실제 모델 한도와 불일치 (잠재 정확성 버그)
2. Recent Requests 키보드 내비 부재
3. 행 Enter로 세션 점프 부재
4. 에러 상태 재시도 버튼 부재
5. progress 초과 시각 단서 부재
6. timestamp lastMessage 의존 — stale 위험
7. Active Sessions 다중 미표시 (첫 번째만)
8. fetch 실패 silent (사용자 알림 부재)
9. 이모지 fallback 부재
10. statusText capitalization 비일관 ("LIVE" vs "Disconnected")
11. SessionTimer unmount 정리 확인 필요
12. 8개 매직 넘버 (slice)
