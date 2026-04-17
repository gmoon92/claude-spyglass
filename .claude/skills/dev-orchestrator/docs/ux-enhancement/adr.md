# UX Enhancement Architecture Decision Records

> 작성일: 2026-04-18  
> 참여 전문가: 소프트웨어 아키텍트, 프론트엔드 엔지니어, QA 엔지니어

---

## ADR-001: TUI 상태 소유권 — app.tsx 중앙 집중 vs 탭 자율 fetch

### 상태
**결정됨** (2026-04-18)

### 배경

`app.tsx`가 `sessions` 상태를 소유하지만 `useState([])` 빈 배열로 고정되어 있다.
`useStats` 훅은 `LiveTab` 내부에서만 호출되어 `DashboardData`를 반환하지만,
여기에는 세션 목록이 없고 summary 집계만 있다.
`AnalysisTab`은 `data` prop 없이 렌더되어 완전히 비어 있다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | `useStats`를 app.tsx로 끌어올리고, `useSessionList` 추가 | 상태 일관성, 단일 폴링 | prop drilling 증가 |
| B | 각 탭이 독립적으로 필요한 데이터를 fetch | 컴포넌트 자율성 | 중복 polling, 상태 불일치 |
| C | `AnalysisTab`은 내부 `useAnalysis` 훅으로 자율 fetch (나머지는 A) | Analysis 격리 | 설계 일관성 부족 |

### 결정

**옵션 A + 부분 C 혼합**:
- `useStats`와 `useSessionList`를 `app.tsx`로 끌어올려 `DashboardData`와 `sessions[]`를 props로 전달
- `AnalysisTab`은 단독으로 쓰이는 전용 집계 엔드포인트(`/api/requests/top`, `/api/stats/by-type`, `/api/stats/tools`)가 필요하므로, `apiUrl` prop을 주입받는 `useAnalysis` 훅을 탭 내부에 둔다

### 이유

1. `Sidebar`와 `HistoryTab` 모두 `sessions[]`가 필요하므로 app 레벨 상태가 불가피하다 (아키텍트)
2. 동일 `/api/dashboard` 엔드포인트를 탭마다 3초 폴링하면 불필요한 서버 부하 발생 (프론트엔드)
3. `AnalysisTab`은 `/api/dashboard`에 없는 별도 데이터를 필요로 하므로 예외적으로 자율 fetch가 더 명확하다 (프론트엔드)

### 대안 채택 시 영향

- 옵션 B 선택 시: 세션 선택 → 탭 간 연동 시 비동기 경쟁 조건 발생 가능

---

## ADR-002: `useSSE` 메시지 버퍼 추가

### 상태
**결정됨** (2026-04-18)

### 배경

`useSSE`는 `lastMessage: SSEMessage | null`만 반환한다.
LiveTab에서 "최근 요청 목록 append"를 구현하려면 컴포넌트가
`useEffect`로 `lastMessage`를 감시해 자체 배열에 누적해야 한다.
이 패턴은 SSE 재연결 시 중복 이벤트 dedup 로직을 소비자 컴포넌트에 분산시킨다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A | `useSSE`에 `messages: SSEMessage[]` 반환 + `maxBuffer` 옵션 추가 | 훅 계층에서 dedup 흡수, 재사용 가능 | 훅 인터페이스 복잡도 증가 |
| B | 컴포넌트에서 `useEffect`로 직접 누적 | 구현 단순 | 탭 전환 시 히스토리 초기화, dedup 중복 구현 |

### 결정

**옵션 A**: `useSSE`에 `messages` 배열 버퍼를 추가한다.
- `maxBuffer` 기본값: 50
- 타임스탬프 + 타입 조합으로 중복 제거
- 기존 `lastMessage` 인터페이스는 하위 호환성 유지

### 이유

1. 두 전문가(아키텍트, 프론트엔드) 모두 동일 결론 (강한 채택 신호)
2. 재연결 후 상태 동기화는 훅 계층에서 처리하는 것이 소비자 컴포넌트를 단순하게 유지한다
3. QA 관점에서 SSE 핸들러 로직을 훅에 집중시키면 테스트 표면이 줄어든다

---

## ADR-003: HistoryTab `useInput` 전역 등록 문제 해소

### 상태
**결정됨** (2026-04-18)

### 배경

Ink의 `useInput`은 마운트된 모든 컴포넌트에서 동시에 발화한다.
`HistoryTab`과 `AnalysisTab`이 각각 `useInput`을 등록하면
비활성 탭의 키보드 핸들러가 활성 탭의 UI 상태(selectedIndex)를 변경한다.

### 고려한 옵션

| 옵션 | 설명 |
|------|------|
| A | `useInput(handler, { isActive: activeTab === 'history' })` — Ink 내장 옵션 활용 |
| B | 핸들러 첫 줄에 `if (!isActive) return` guard |

### 결정

**옵션 A**: Ink `useInput`의 두 번째 인자 `{ isActive }` 옵션을 사용한다.
각 탭 컴포넌트는 `isActive: boolean` prop을 받고 이를 `useInput`에 전달한다.

### 이유

Ink 공식 API를 활용하므로 추가 조건 분기 없이 프레임워크 수준에서 처리된다.
두 전문가 모두 이 문제를 독립적으로 지적했다 (아키텍트, 프론트엔드).

---

## ADR-004: Settings 설정 저장소 전략

### 상태
**결정됨** (2026-04-18)

### 배경

웹 대시보드는 브라우저 환경(localStorage 가능), TUI는 Node.js 프로세스(localStorage 없음).
알림 임계값, 서버 URL, 폴링 간격을 재시작 후에도 유지하려면 각 클라이언트에 맞는 저장 방식이 필요하다.

### 고려한 옵션

| 옵션 | 웹 | TUI | 공유 여부 |
|------|----|----|----------|
| A | localStorage | `~/.spyglass/config.json` | 없음 |
| B | localStorage | in-process 상수 (재시작 후 초기화) | 없음 |
| C | 서버 `GET/PUT /api/settings` | 서버 API | 공유 |

### 결정

**옵션 A**: 이번 범위에서는 웹 localStorage + TUI 파일(`~/.spyglass/config.json`)로 분리 구현.
서버 API 통합(옵션 C)은 Phase 3 대상으로 남긴다.

### 이유

1. YAGNI: 현재 두 클라이언트를 동일 사용자가 동시에 쓰는 시나리오가 드물다 (아키텍트)
2. QA: 파일 기반 저장은 테스트 환경에서 임시 디렉토리 격리가 쉽다
3. 옵션 B(in-process)는 재시작 후 초기화되므로 Settings Tab 기능 자체가 무의미해진다

### 전문가 이견

**아키텍트 관점**: XDG 규약(`~/.config/spyglass/settings.json`) 준수 권장  
**프론트엔드 관점**: 기존 `~/.spyglass/` 디렉토리에 맞추는 것이 일관성 있음  
**해소**: 기존 DB 경로(`~/.spyglass/spyglass.db`)와 같은 디렉토리인 `~/.spyglass/config.json`으로 통일.

---

## ADR-005: API offset 페이지네이션 추가

### 상태
**결정됨** (2026-04-18)

### 배경

웹 대시보드의 최근 요청 테이블이 10건으로 고정되어 있고 "더 보기" 기능이 없다.
현재 `/api/requests?limit=N`은 `offset` 파라미터를 지원하지 않는다.
클라이언트 측 전체 로드 후 슬라이싱은 대형 세션에서 메모리/성능 문제를 일으킨다.

### 고려한 옵션

| 옵션 | 설명 | 비용 |
|------|------|------|
| A | 서버 `/api/requests`에 `offset` 파라미터 추가 | SQLite OFFSET 절 추가 (소) |
| B | 클라이언트 전체 로드 후 슬라이싱 | 구현 없음, 성능 문제 |
| C | cursor 기반 무한 스크롤 | 구현 복잡 (과도) |

### 결정

**옵션 A**: `api.ts`와 storage `queries/request.ts`에 `offset` 지원 추가.
웹 대시보드에서 "더 보기" 버튼 클릭 시 `offset`을 증가시켜 다음 페이지를 로드한다.

### 이유

1. SQLite `LIMIT ? OFFSET ?` 추가 비용은 최소이며 즉각적인 UX 개선 효과가 크다 (아키텍트)
2. 프론트엔드 구현보다 API 확장을 먼저 배치해야 한다는 의존 순서 권고 (아키텍트)

---

## ADR-006: 세션 경과 시간 — leaf 컴포넌트 분리

### 상태
**결정됨** (2026-04-18)

### 배경

LiveTab에서 `sessionDuration = '00:15:32'`가 하드코딩되어 있다.
1초 setInterval을 LiveTab 전체에 두면 Ink 환경에서 토큰 카운터·프로그레스바 전체를 1초마다 재렌더한다.

### 결정

`<SessionTimer startedAt={number} />` leaf 컴포넌트를 별도로 만들어
1초 타이머를 격리한다. `useEffect` cleanup에서 `clearInterval`을 보장한다.

### 이유

1. Ink 렌더 특성상 상위 컴포넌트 state 변경이 전체 트리를 재렌더한다 (아키텍트)
2. QA: 컴포넌트 언마운트 시 인터벌 클리어를 단위 테스트로 검증 가능해진다

---

## ADR-007: tool_detail 파싱 전략

### 상태
**결정됨** (2026-04-18)

### 배경

`tool_detail` 필드가 텍스트 덤프로 저장되어 있다. 표시 개선을 위해 파싱이 필요하다.
서버에서 파싱해 구조화 저장하는 방법과 클라이언트에서 파싱하는 방법이 있다.

### 고려한 옵션

| 옵션 | 설명 | 데이터 영향 |
|------|------|-----------|
| A | 클라이언트 측 JS/TS에서 파싱 (표현만 변경) | 원본 데이터 보존 |
| B | 서버 collect.ts에서 저장 시 파싱, 구조화 컬럼 추가 | 스키마 변경 + 마이그레이션 필요 |

### 결정

**옵션 A**: 클라이언트(웹 대시보드 JS) 측에서 `try/catch`로 감싸 파싱.
파싱 실패 시 원본 텍스트를 폴백으로 표시한다.

### 이유

1. 스키마 변경과 마이그레이션 없이 즉시 개선 가능하다 (아키텍트)
2. QA: 파싱 함수를 독립 함수로 추출하면 다양한 입력값으로 단위 테스트 가능
3. 실제 DB에 저장된 tool_detail 형식을 먼저 샘플링해서 파서를 작성해야 한다 (프론트엔드)

---

## ADR-008: console.log 및 debug 렌더 제거

### 상태
**결정됨** (2026-04-18)

### 배경

`useStats.ts`에 3개의 `console.log`가 있고, `LiveTab.tsx`에 debug 텍스트가 렌더된다.
Ink TUI 환경에서 stdout 직접 출력은 터미널 레이아웃을 오염시킨다.

### 결정

즉시 제거. debug 렌더는 완전히 삭제한다.
향후 디버깅이 필요하면 `SPYGLASS_DEBUG=1` 환경변수 조건으로 격리한다.

### 이유

이것은 기능 결정이 아닌 품질 수정이며, 두 전문가가 독립적으로 지적했다.
