# tui-shell — TUI Layout + TabBar + AlertBanner + Cross-cutting (T1 + T6)

> TUI 셸 — Header / Sidebar / Main / Footer + 4탭 네비게이션 + 알림 배너 + cross-cutting (키보드/SSE/통계/포매터).
> 5라운드 누적 인벤토리.

---

## R1 — 1차 작성

### Layout (`Layout.tsx`)

#### Container
- `<Box flexDirection="column" height={rows}>`
- rows = stdout.rows || 24

#### Header (높이 1)
- `borderStyle="single" borderBottom borderColor="gray"`
- 좌 30%: title `<Text bold color="cyan">spyglass</Text>`
- 중 40%: 상태 (`🟢/🔴`, `CONNECTED/DISCONNECTED`, color green/red)
- 우 30%: `Sessions: ${count}` (yellow)

#### Sidebar (`<Sidebar>`, width 25)
- `borderStyle="single" borderRight borderColor="gray"`
- 헤더: "📁 Sessions"
- 세션 10개 슬라이스 (truncate)
- 선택된 세션: `> ${name}` (cyan, bold)
- 빈 상태: "No sessions" (gray)

#### Main (`<Main>`)
- `flexGrow={1} height={contentHeight}`
- contentHeight = max(10, rows - 4)

#### Footer (높이 1)
- `borderStyle="single" borderTop borderColor="gray"`
- 좌 60%: F1 Live / F2 History / F3 Analysis / F4 Settings / q Quit (단축키 cyan, 라벨 gray)
- 우 40%: `Tab: ${activeTab}` (yellow)

### TabBar (`TabBar.tsx`)

#### TABS 4종
- live (F1)
- history (F2)
- analysis (F3)
- settings (F4)

#### TabBar 렌더
- `borderStyle="single" borderBottom borderColor="gray"`
- 각 탭 paddingX=2
- active: `> F1:Live` (cyan bold)
- inactive: `  F1:Live` (gray)

#### TabContent
- 활성 탭의 children만 렌더 (`{children[activeTab]}`)

### AlertBanner (`AlertBanner.tsx`)

#### Level 3종
- normal (green, 🟢)
- warning (yellow, 🟡)
- critical (red, 🔴)

#### Banner
- normal: 단순 표시 "🟢 System Normal" (gray)
- warning/critical:
  - `borderStyle="round" borderColor`
  - 좌 10%: `${icon} ${LEVEL}` (color bold)
  - 중 80%: `${title}: ${message}` (color truncate)
  - 우 10%: "Press A to Ack" (gray)

#### AlertIndicator
- 간단 버전: 아이콘만

### T6 Cross-cutting

#### useKeyboard (`useKeyboard.ts`)
- F1~F4: 탭 전환
- 1~4: 탭 전환 (F키 대체)
- q/Q: 종료 (process.exit)
- /: 검색 토글 (onSearchToggle 콜백)
- ESC: 검색 종료/뒤로가기 (TODO 표기)
- ↑↓: 선택 인덱스 이동 (selectedIndex/maxIndex 기반)
- Enter: 선택 실행 (onEnter 콜백)

#### useStats (`useStats.ts`)
- API: GET /api/dashboard
- autoRefresh interval (default 5000ms)
- 반환: { data, isLoading, error }

#### useSessionList (`useSessionList.ts`)
- API: GET /api/sessions
- interval (default 5000ms)
- 반환: { sessions }

#### useSSE (`useSSE.ts`)
- EventSource 연결
- autoReconnect: true
- 반환: { status, messages, lastMessage }
- status: 'connected' | 'connecting' | 'disconnected'

#### useAnalysis (`useAnalysis.ts`)
- API: GET /api/analysis (Top/Type/Tool 통계)
- 반환: { data, loading, errors }

#### useAlerts / useAlertHistory
- 알림 레벨/이력 관리

#### useConfig
- 설정 로드/저장
- 필드: warning, critical, apiUrl, pollInterval

#### Formatters (`formatters/`)
- TokenFormatter.format(n) — k/M 단위
- TimeFormatter.formatDate / formatTime / formatDuration
- RequestTypeFormatter.getColor / getLabel

---

## R2 — 검토

1. **Layout Sidebar 25 cols 고정**: 좁은 터미널에서 메인 영역 부족 가능.
2. **Sidebar에서 selectedId 전달 부재**: app.tsx에서 selectedId prop 미전달 — 항상 비선택 상태.
3. **세션 클릭 동작**: TUI에서 마우스 클릭 미지원 — 키보드만.
4. **Header status 'connected'/'disconnected'만**: 'connecting' 상태 미반영 (useSSE는 3종 반환하지만 Layout Header는 2종만).
5. **Footer 단축키 일관성**: q Quit는 표시, Q는 표시 부재 (둘 다 동작은 함).
6. **AlertBanner 사용 위치**: app.tsx에서 import 안 됨 — 실제 미사용?
7. **useKeyboard maxIndex=10 hardcoded**: 세션 10개 가정 — 더 많은 세션이 있을 때?
8. **useKeyboard ESC TODO**: 명세 미완성.
9. **useKeyboard 단축키 충돌**: '/'와 'q'가 입력값으로도 처리 가능 (input prop) — 검색 모드에서도 'q'가 종료 트리거할 위험.
10. **Layout Box height={rows} 고정**: stdout 변경 (resize) 시 자동 갱신 안 함 — useStdout이 reactive 한 지 확인 필요.
11. **Sidebar 빈 상태 길이**: "No sessions"만, 안내 문구 부재.
12. **emoji 이모지 사용**: 일부 터미널에서 그래픽 깨짐 가능.

---

## R3 — R2 반영 + 추가

### 보강

- **Sidebar selectedId**: app.tsx의 sessions에서 selectedIndex를 selectedId로 변환 미실행 — 사이드바 항상 비활성 표시.
- **Header status 3종**: Layout Header는 'connected'/'disconnected'만. useSSE의 'connecting'은 LiveTab에만 반영.
- **AlertBanner 미사용**: app.tsx import 없음 — 컴포넌트 정의만 되어 있고 실제 화면에 노출 안 됨. **잠재 죽은 코드**.
- **useKeyboard maxIndex=10 hardcoded**: app.tsx에서 그대로 전달. 세션 많아도 10까지만 이동.
- **/ 키 검색 모드 충돌**: useKeyboard에서 input/key.ctrl/key.meta 가드 일부 있으나 ESC 미구현. 검색 모드 진입 후 'q' 입력 시 종료 — 의도되지 않은 동작 가능.
- **stdout reactive**: ink useStdout은 stdout 객체 자체가 변경 감지를 지원 (resize 이벤트 listener 내장).
- **F1~F4 vs 1~4**: 둘 다 동작. 그러나 일부 터미널에서 F키가 다른 단축키로 가로채짐 → 1~4로 fallback.
- **ESC 구현 부재**: useKeyboard 본체에는 TODO만, HistoryTab/SettingsTab/AnalysisTab 각자 useInput에서 ESC 처리.
- **이모지 호환성**: 🟢/🔴/🟡/⚪/⌛/📁 등 사용. 터미널 폰트에 따라 그래픽 깨짐 가능.

### 추가 인터랙션

- **마우스 부재**: TUI는 키보드 전용.
- **터미널 resize 대응**: useStdout으로 rows/columns 갱신 — 자동 redraw.

---

## R4 — 검토 (미세·키보드·에러·상태 전이)

1. **Layout 너비 분배**: Header/Footer 좌중우 30/40/30, 60/40 — 폭이 좁을 때 콘텐츠 잘림.
2. **Sidebar 항상 표시**: 좁은 터미널에서 사이드바 가려도 25cols 차지.
3. **Sidebar 키보드 내비 부재**: Sidebar 자체에 useInput 없음 — 세션 선택 동작 부재.
4. **Tab 전환 시 선택 인덱스 초기화 안 됨**: 다른 탭에서 ↑↓로 이동했던 selectedIndex가 그대로 유지 — 의도/버그?
5. **Header SSE status indicator** "🟢 CONNECTED" 단순 텍스트. 실시간 ping 표시 없음.
6. **Footer 단축키 안내 좁은 폭 처리**: 모든 키 5개 표시 — 좁으면 잘림.
7. **AlertBanner Press A to Ack**: A 키 처리 미구현 (useKeyboard에 없음).
8. **useKeyboard onSearchToggle**: app.tsx에서 콜백 전달 안 함 — '/'키 무동작.
9. **useKeyboard ESC TODO**: 검색 모드 종료 미구현.
10. **useStats interval 5000ms**: 너무 잦은 호출 가능. 사용자 조정 부재 (단 SettingsTab의 pollInterval과 연동 추정).
11. **useSSE autoReconnect**: 끊김 시 자동 재시도. 백오프 부재 가능.
12. **useSessionList interval 5000ms**: 별도 폴링 — useSSE와 중복 가능.
13. **이모지 fallback 부재**: 🟢 미지원 터미널에서 빈 박스 표시.
14. **Footer activeTab 텍스트 capitalization**: 'live' → 'Live'로 자동 변환 안 됨 — 코드는 'live'만 전달, Footer는 첫 글자 대문자로 표시?

---

## R5 — R4 반영 + 최종 추가

### 추가된 미세·접근성·상태 전이

- **Sidebar selectedId 미전달 — 잠재 버그**:
  - 세션 선택 인덱스가 표시 안 됨
  - app.tsx에서 sessions[selectedIndex]?.id를 Sidebar로 전달 후보
- **AlertBanner 컴포넌트 미사용 — 잠재 죽은 코드**:
  - 정의만 있고 화면 노출 부재
  - feedback.md 후보? (UI 영역 — 제거 또는 Layout 통합 결정 필요)
- **useKeyboard ESC TODO**: 명시적 미구현
- **/ 검색 모드 onSearchToggle 미연결**
- **A 키 (Alert ack) 미구현**
- **maxIndex 하드코딩 10**: 동적 갱신 부재
- **Tab 전환 시 selectedIndex 초기화 부재**:
  - HistoryTab에서 ↑↓로 5번 이동 → live 탭 → 다시 history 탭 → selectedIndex 5
  - 의도된 보존인지 체크 필요
- **Footer 좁은 폭 잘림 위험**
- **이모지 fallback 부재**
- **Header status 'connecting' 미반영**: SSE connecting 상태가 헤더에 안 보임
- **AlertBanner critical 등급 시각 위계**: warning/critical 색만 다름. 추가 시각 강조 (animate, blink) 부재
- **TUI Layout 폭 분배 (30/40/30)**: 좁은 폭에서 비효율
- **Sidebar 폭 25 고정**: 환경 무관 동일
- **Border 색 'gray'**: 다크/라이트 미구분
- **status text upper case 'CONNECTED'**: 한 단어인데 강조용 대문자
- **useKeyboard ESC TODO + 각 탭 자체 ESC 처리**: 책임 분산

### 키보드 단축키 (구현 vs 부재)

| 의도 | 현재 |
|------|------|
| F1~F4 탭 전환 | ✅ |
| 1~4 탭 전환 | ✅ |
| q/Q 종료 | ✅ |
| / 검색 토글 | ❌ (콜백 미연결) |
| ESC 검색 종료/뒤로 | ❌ (TODO) |
| ↑↓ 선택 이동 | ✅ (단 maxIndex hardcoded) |
| Enter 선택 실행 | ✅ |
| A 알림 확인 | ❌ |
| ? 도움말 | ❌ |
| , 설정 | ❌ |

---

## 최종 기능 개수 (T1 + T6)

### T1 Layout
- Header 3섹션 (title/status/sessions): 3개
- Sidebar (헤더/리스트/선택/빈상태): 4개
- Main (height 계산): 1개
- Footer (단축키/activeTab): 2개

### T1 TabBar
- TABS 4종: 4개
- TabBar 렌더 (active/inactive): 2개
- TabContent 분기: 1개

### T1 AlertBanner
- Level 3종: 3개
- Banner 표시 (normal vs warning/critical): 2개
- AlertIndicator: 1개

### T6 Cross-cutting
- useKeyboard (F1~F4/1~4/q/Q/Enter/↑↓/Esc/Search): 8개
- useStats / useSessionList / useSSE / useAnalysis / useAlerts / useAlertHistory / useConfig: 7개
- Formatters (Token/Time/RequestType): 3개

총 **약 41개 기능**.

## 발견된 누락·모호 (Phase 2 입력)

1. AlertBanner 정의만 되고 화면 미노출 — 죽은 코드 (확인 필요)
2. Sidebar selectedId 미전달 — 선택 표시 부재
3. useKeyboard ESC TODO 미구현
4. / 검색 토글 콜백 미연결
5. A 키 (Alert ack) 미구현
6. maxIndex hardcoded 10
7. Tab 전환 시 selectedIndex 초기화 부재
8. 이모지 fallback 부재
9. Header status 'connecting' 미반영
10. 좁은 폭에서 Footer 잘림 위험
11. Sidebar 폭 25 고정
12. SSE retry exponential backoff 부재
13. useKeyboard 단축키와 각 탭 자체 useInput의 책임 분산
14. ? 도움말, , 설정 단축키 부재
