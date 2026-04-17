# UX Enhancement 작업 목록

> 기반 문서: plan.md, adr.md  
> 작성일: 2026-04-18 (검토 반영: 2026-04-18)  
> 총 태스크: 17개

---

## 태스크 목록

| ID | 태스크 | 예상 시간 | 선행 태스크 | 커밋 타입 |
|----|--------|----------|------------|----------|
| T-01 | console.log 제거 및 debug 렌더 삭제 | 0.5h | - | fix |
| T-02 | API offset 페이지네이션 추가 | 1h | - | feat |
| T-02t | T-02 단위 테스트 — offset API | 0.5h | T-02 | test |
| T-03 | useSSE messages 버퍼 추가 | 1h | - | feat |
| T-04 | useSessionList 훅 신설 | 1h | - | feat |
| T-05 | app.tsx 상태 중앙화 | 1h | T-04 | refactor |
| T-06 | HistoryTab useInput isActive guard | 0.5h | T-05 | feat |
| T-07 | SessionTimer leaf 컴포넌트 + 경과 시간 동적 계산 | 1h | T-05 | feat |
| T-07t | T-07 단위 테스트 — SessionTimer cleanup | 0.5h | T-07 | test |
| T-08 | LiveTab 실시간 요청 목록 SSE 연동 | 1h | T-03, T-05, T-07 | feat |
| T-09a | HistoryTab 세션 선택 + 하이라이트 | 1h | T-05, T-06 | feat |
| T-09b | HistoryTab 세션 상세 패널 렌더링 | 1h | T-09a | feat |
| T-10 | AnalysisTab 데이터 연동 완성 (useAnalysis 포함) | 1.5h | T-05 | feat |
| T-11 | Settings Tab 기본 기능 — TUI 전용 | 1.5h | T-05 | feat |
| T-12 | 웹 대시보드 — 최근 요청 타입 필터 + 더 보기 | 1.5h | T-02 | feat |
| T-13 | 웹 대시보드 — 턴 뷰 토큰 비중 바 + 세션 상세 집계 배지 | 1h | - | feat |
| T-14 | 웹 대시보드 — tool_detail 파싱 및 표시 개선 | 1h | - | feat |
| T-14t | T-14 단위 테스트 — parseToolDetail | 0.5h | T-14 | test |

---

## 의존성 그래프

```
T-01 (독립)
T-02 → T-02t
T-03 (독립) ──────────────────────────────────────→ T-08
T-04 → T-05 → T-06 → T-09a → T-09b
              ↓
              T-07 → T-07t
              ↓
              T-08 (T-03, T-07도 필요)
              ↓
              T-10
              ↓
              T-11
T-02 ────────────────────────────────────────────→ T-12
T-13 (독립)
T-14 → T-14t
```

---

## T-01: console.log 제거 및 debug 렌더 삭제

**선행 조건**: 없음

### 작업 내용

TUI 코드에 남아 있는 debug용 코드를 모두 제거한다.
Ink 환경에서 stdout 직접 출력은 터미널 레이아웃을 깨뜨린다.

제거 대상:
- `useStats.ts` 내 `console.log` 전체
- `app.tsx` 내 `console.log('Selected:', session)` (또는 유사 debug log)
- `LiveTab.tsx` 내 "Debug:" 텍스트 렌더

향후 디버깅은 `SPYGLASS_DEBUG=1` 환경변수 조건으로만 허용한다.

### 구현 범위

- `packages/tui/src/hooks/useStats.ts`: 모든 `console.log` 제거
- `packages/tui/src/app.tsx`: debug log 제거
- `packages/tui/src/components/LiveTab.tsx`: debug 렌더 텍스트 제거

### 커밋 메시지
```
fix(tui): console.log 및 debug 렌더 제거
```

### 검증 명령어
```bash
grep -r "console.log" packages/tui/src/
grep -rn "Debug:" packages/tui/src/
bun run typecheck
```

### 완료 기준
- [ ] `packages/tui/src/` 내 `console.log` 0개
- [ ] LiveTab에서 "Debug:" 텍스트가 렌더되지 않음
- [ ] `bun run typecheck` 통과

---

## T-02: API offset 페이지네이션 추가

**선행 조건**: 없음

### 작업 내용

`/api/requests` 엔드포인트에 `offset` 쿼리 파라미터를 추가한다.
이후 T-12의 "더 보기" 버튼 구현의 전제 조건이다.

**응답 스키마**: 기존과 동일 (offset만 추가, meta에 total 포함 유지)  
**기본값**: offset=0  
**음수 방어**: offset < 0 이면 400 반환  
**초과 방어**: offset ≥ total 이면 빈 배열 반환

### 구현 범위

- `packages/storage/src/queries/request.ts`:
  - `getAllRequests(limit, offset?)`, `getRequestsByType(type, limit, offset?)` 에 offset 추가
  - SQL: `LIMIT ? OFFSET ?`
- `packages/server/src/api.ts`:
  - `/api/requests`, `/api/requests/by-type/:type` 라우트에서 `offset` 파싱
  - 음수 방어: `Math.max(0, parseInt(offset ?? '0'))`

### 커밋 메시지
```
feat(api): requests 엔드포인트에 offset 페이지네이션 추가
```

### 검증 명령어
```bash
bun test packages/storage
bun test packages/server
```

### 완료 기준
- [ ] `/api/requests?limit=5&offset=5` 가 offset 이후 5건을 반환
- [ ] `/api/requests?offset=-1` 이 offset=0으로 처리 (또는 400)
- [ ] offset 미전달 시 기존 동작과 동일
- [ ] `bun test` 통과

---

## T-02t: T-02 단위 테스트 — offset API

**선행 조건**: T-02 완료 후

### 작업 내용

offset 파라미터 동작을 검증하는 테스트를 기존 서버 테스트에 추가한다.

### 구현 범위

- `packages/server/src/__tests__/server.test.ts` 또는 신규 파일:
  - offset=0 (기본)
  - offset=N (정상 범위)
  - offset ≥ total (빈 배열 반환)
  - offset 음수 입력 방어

### 커밋 메시지
```
test(api): offset 페이지네이션 경계값 테스트 추가
```

### 검증 명령어
```bash
bun test packages/server
```

### 완료 기준
- [ ] 4개 케이스 모두 통과

---

## T-03: useSSE messages 버퍼 추가

**선행 조건**: 없음

### 작업 내용

`useSSE` 훅에 `messages: SSEMessage[]` 버퍼를 추가한다.
기존 `lastMessage` 인터페이스는 유지해 하위 호환성을 보장한다.

**버퍼 전략**:
- 초과 시 FIFO(가장 오래된 메시지를 앞에서 제거)
- dedup 키: `timestamp + type` 복합 키로 중복 판단
- 재연결 시 버퍼 초기화 없음 (기존 메시지 유지)

### 구현 범위

- `packages/tui/src/hooks/useSSE.ts`:
  - `maxBuffer?: number` 옵션 파라미터 추가 (기본값: 50)
  - 내부에 `messages` 상태 배열 관리 (FIFO + dedup)
  - 반환값에 `messages` 추가

### 커밋 메시지
```
feat(hooks): useSSE에 messages 버퍼 추가 (FIFO, maxBuffer=50)
```

### 검증 명령어
```bash
bun run typecheck
```

### 완료 기준
- [ ] `useSSE` 반환값에 `messages: SSEMessage[]` 포함
- [ ] `maxBuffer=50` 초과 시 가장 오래된 항목(FIFO) 자동 제거
- [ ] 동일 `timestamp+type` 메시지 중복 추가 없음
- [ ] 기존 `lastMessage` 동작 변경 없음
- [ ] `bun run typecheck` 통과

---

## T-04: useSessionList 훅 신설

**선행 조건**: 없음

### 작업 내용

`/api/sessions`를 폴링하는 전용 훅을 만든다.
`useStats`는 summary 집계 전용으로 유지하고,
세션 목록은 별도 훅으로 분리해 Sidebar와 HistoryTab에 공급한다.

### 구현 범위

- `packages/tui/src/hooks/useSessionList.ts` 신규 생성:
  - `/api/sessions?limit=50` 주기적 폴링 (기본 5초)
  - `sessions: Session[]`, `loading`, `error`, `refresh()` 반환
  - 언마운트 시 폴링 인터벌 cleanup

### 커밋 메시지
```
feat(hooks): useSessionList 훅 신설
```

### 검증 명령어
```bash
bun run typecheck
```

### 완료 기준
- [ ] `useSessionList` 훅이 세션 목록을 반환
- [ ] 5초 폴링으로 자동 갱신
- [ ] 언마운트 시 폴링 자동 중단
- [ ] `bun run typecheck` 통과

---

## T-05: app.tsx 상태 중앙화

**선행 조건**: T-04 완료 후

### 작업 내용

`useStats`와 `useSessionList`를 `app.tsx`로 끌어올려 data를 모든 탭에 props로 전달한다.
`LiveTab` 내부의 `useStats` 독립 호출을 제거해 중복 폴링을 없앤다.

**T-05 커밋 범위**: app.tsx 상태 구조 변경 + 각 탭 props 계약 수정까지 포함.
HistoryTab의 외부 sessions 주입 prop 제거(useSessionList 내부화가 아닌, app.tsx에서 prop으로 전달로 변경)도 이 커밋에 포함.

### 구현 범위

- `packages/tui/src/app.tsx`:
  - `useStats(apiUrl)` 호출 추가
  - `useSessionList(apiUrl)` 호출 추가
  - `sessions=[]` → `useSessionList` 반환값으로 교체
  - `data`, `sessions`를 LiveTab, HistoryTab, Sidebar에 props로 전달
- `packages/tui/src/components/LiveTab.tsx`: 내부 `useStats` 제거, props로 data 수신
- `packages/tui/src/components/HistoryTab.tsx`: sessions props 수신 구조 확인/수정

### 커밋 메시지
```
refactor(tui): app.tsx 상태 중앙화 — useStats/useSessionList 끌어올리기
```

### 검증 명령어
```bash
bun run typecheck
bun build packages/tui/src/index.tsx --target=bun
```

### 완료 기준
- [ ] `app.tsx`에서 `useStats` 호출 1회 (탭별 중복 폴링 없음)
- [ ] `Sidebar`에 실제 세션 데이터 전달됨
- [ ] `LiveTab`이 props로 data를 받아 렌더
- [ ] TUI 빌드 통과

---

## T-06: HistoryTab useInput isActive guard 추가

**선행 조건**: T-05 완료 후

### 작업 내용

HistoryTab과 AnalysisTab의 `useInput` 등록에 `isActive` 옵션을 추가해
비활성 탭의 키보드 이벤트 충돌을 방지한다.
(버그 수정 성격이나 신규 옵션 파라미터 도입이므로 `feat` 타입 사용)

### 구현 범위

- `packages/tui/src/components/HistoryTab.tsx`: `isActive: boolean` prop 추가, `useInput(handler, { isActive })` 적용
- `packages/tui/src/components/AnalysisTab.tsx`: 동일
- `packages/tui/src/app.tsx`: 각 탭에 `isActive={activeTab === 'history'}` 등 전달

### 커밋 메시지
```
feat(tui): HistoryTab/AnalysisTab useInput isActive guard 추가
```

### 검증 명령어
```bash
bun run typecheck
```

### 완료 기준
- [ ] 비활성 탭의 `useInput`이 발화하지 않음 (수동 검증)
- [ ] Analysis 탭에서 ←→ 키 입력이 History 탭 selectedIndex에 영향 없음
- [ ] `bun run typecheck` 통과

---

## T-07: SessionTimer leaf 컴포넌트 + 경과 시간 동적 계산

**선행 조건**: T-05 완료 후

### 작업 내용

`<SessionTimer startedAt={number} />` leaf 컴포넌트를 만들어
1초 타이머를 LiveTab 전체 재렌더에서 격리한다.

**표시 기준**: 활성 세션의 `started_at` 기준. 세션이 종료된 경우(`ended_at` 존재) 타이머 정지.  
**단위 확인**: `started_at`이 milliseconds임을 확인 후 사용 (서버 응답 기준).

### 구현 범위

- `packages/tui/src/components/SessionTimer.tsx` 신규 생성:
  - `startedAt: number` (ms), `endedAt?: number` props 수신
  - 1초 setInterval로 경과 시간 계산
  - `endedAt` 존재 시 고정값 표시 (타이머 미실행)
  - `useEffect` cleanup에서 `clearInterval` 보장
  - `HH:MM:SS` 포맷으로 렌더
- `packages/tui/src/components/LiveTab.tsx`: 하드코딩 제거, `<SessionTimer>` 사용

### 커밋 메시지
```
feat(tui): SessionTimer 컴포넌트 추가 — 경과 시간 동적 계산
```

### 검증 명령어
```bash
bun run typecheck
```

### 완료 기준
- [ ] Live Tab의 경과 시간이 실제 `started_at` 기준으로 동적 갱신
- [ ] 종료 세션의 경우 고정값 표시 (타이머 미실행)
- [ ] `bun run typecheck` 통과

---

## T-07t: T-07 단위 테스트 — SessionTimer cleanup

**선행 조건**: T-07 완료 후

### 작업 내용

SessionTimer 컴포넌트의 핵심 동작을 `ink-testing-library`로 검증한다.

### 구현 범위

- `packages/tui/src/__tests__/SessionTimer.test.tsx` 신규 생성:
  - fake timer로 1초 경과 시 표시값 변경 확인
  - 컴포넌트 언마운트 후 `clearInterval` 호출 확인 (타이머 정지)
  - `endedAt` 있을 때 타이머 실행 없이 고정값 표시 확인

### 커밋 메시지
```
test(tui): SessionTimer 컴포넌트 단위 테스트 추가
```

### 검증 명령어
```bash
bun test packages/tui
```

### 완료 기준
- [ ] 3개 케이스 모두 통과

---

## T-08: LiveTab 실시간 요청 목록 SSE 연동

**선행 조건**: T-03, T-05, T-07 완료 후

### 작업 내용

LiveTab에서 SSE `new_request` 이벤트를 수신할 때 요청 목록을 실시간으로 업데이트한다.
`useSSE`의 `messages` 버퍼를 사용해 최근 20건을 표시한다.

**재연결 동기화**: SSE 재연결 감지 시 `/api/requests?limit=20` re-fetch로 상태 동기화.

### 구현 범위

- `packages/tui/src/components/LiveTab.tsx`:
  - `useSSE` 훅의 `messages` 배열에서 `new_request` 타입 이벤트 필터링
  - `RequestList` 컴포넌트에 실시간 요청 데이터 전달 (최대 20건)
  - `useSSE`의 연결 상태(Disconnected → Connected 전환 감지) 시 re-fetch

### 커밋 메시지
```
feat(tui): LiveTab 실시간 요청 목록 SSE 연동
```

### 검증 명령어
```bash
bun run typecheck
# 수동: Claude Code 작업 중 TUI Live Tab에서 요청이 실시간으로 추가되는지 확인
```

### 완료 기준
- [ ] `new_request` SSE 이벤트 수신 시 목록 즉시 갱신
- [ ] 최대 20건 유지 (초과 시 오래된 항목 제거)
- [ ] SSE 재연결 시 re-fetch로 최신 상태 복구
- [ ] `bun run typecheck` 통과

---

## T-09a: HistoryTab 세션 선택 + 하이라이트

**선행 조건**: T-05, T-06 완료 후

### 작업 내용

HistoryTab에서 세션 목록을 탐색하고 Enter로 선택할 수 있게 한다.
선택된 세션은 하이라이트 표시되고 `selectedSessionId` 상태에 저장된다.
이 단계에서는 상세 뷰를 띄우지 않고 선택 상태만 관리한다.

### 구현 범위

- `packages/tui/src/components/HistoryTab.tsx`:
  - `selectedSessionId: string | null` 상태 추가
  - ↑↓ 탐색 + Enter 선택 시 `selectedSessionId` 업데이트
  - 선택된 행 하이라이트 (cyan bold)
  - ESC: 선택 해제

### 커밋 메시지
```
feat(tui): HistoryTab 세션 선택 및 하이라이트 구현
```

### 검증 명령어
```bash
bun run typecheck
```

### 완료 기준
- [ ] ↑↓로 탐색, Enter로 세션 선택
- [ ] 선택된 세션 행 하이라이트 표시
- [ ] ESC로 선택 해제
- [ ] `bun run typecheck` 통과

---

## T-09b: HistoryTab 세션 상세 패널 렌더링

**선행 조건**: T-09a 완료 후

### 작업 내용

`selectedSessionId` 변경 시 해당 세션의 요청 목록과 토큰 분포를 표시한다.
터미널 너비를 기준으로 마스터-디테일 또는 전환 방식으로 렌더한다.

**레이아웃 기준**: `stdout.columns >= 120` → 좌우 분할 (40%/60%), 미만 → 전환 방식  
**에러 처리**: 404 응답 시 "세션 데이터를 찾을 수 없습니다" 표시 후 선택 해제

### 구현 범위

- `packages/tui/src/components/HistoryTab.tsx`:
  - `selectedSessionId` 변경 시 `/api/sessions/:id/requests` fetch
  - `useStdout().stdout.columns` 기준 분할/전환 방식 조건부 렌더
  - 상세 뷰: 요청 목록 (시간, 타입, 도구, 토큰), 타입별 소계
  - 404/오류 시 에러 메시지 + 선택 해제

### 커밋 메시지
```
feat(tui): HistoryTab 세션 상세 패널 구현
```

### 검증 명령어
```bash
bun run typecheck
# 수동: HistoryTab에서 세션 선택 → 상세 뷰 확인
```

### 완료 기준
- [ ] 세션 선택 시 요청 목록 표시
- [ ] `stdout.columns >= 120` 기준 분할/전환 자동 선택
- [ ] ESC/Backspace로 목록 복귀
- [ ] 404 응답 시 에러 처리
- [ ] `bun run typecheck` 통과

---

## T-10: AnalysisTab 데이터 연동 완성

**선행 조건**: T-05 완료 후

### 작업 내용

`AnalysisTab`이 현재 완전히 비어 있다 (`data` prop 없이 렌더).
`useAnalysis` 훅을 탭 내부에 추가해 Overview/Top/By Type/By Tool 4섹션을 실제 데이터로 채운다.

**병렬 fetch 실패 전략**: `Promise.allSettled` 사용 — 일부 엔드포인트 실패 시에도 성공한 데이터는 표시.
실패한 섹션에는 "데이터를 불러올 수 없습니다" 인라인 메시지 표시.

### 구현 범위

- `packages/tui/src/hooks/useAnalysis.ts` 신규 생성:
  - `/api/requests/top?limit=10`
  - `/api/stats/by-type`
  - `/api/stats/tools`
  - `Promise.allSettled`로 병렬 fetch, 부분 실패 허용
  - `topRequests`, `typeStats`, `toolStats` 반환
- `packages/tui/src/components/AnalysisTab.tsx`:
  - 내부에서 `useAnalysis(apiUrl)` 호출
  - 4섹션(Overview/Top Requests/By Type/By Tool) 실제 데이터 렌더
  - 섹션별 에러 인라인 표시

### 커밋 메시지
```
feat(tui): AnalysisTab 데이터 연동 완성 (useAnalysis 훅 포함)
```

### 검증 명령어
```bash
bun run typecheck
# 수동: F3 탭에서 실제 통계 데이터 표시 확인
```

### 완료 기준
- [ ] 4개 섹션 모두 실제 데이터 렌더
- [ ] "No analysis data available" 메시지가 사라짐
- [ ] 일부 엔드포인트 실패 시에도 다른 섹션은 정상 표시
- [ ] `bun run typecheck` 통과

---

## T-11: Settings Tab 기본 기능 — TUI 전용

**선행 조건**: T-05 완료 후

### 작업 내용

Settings Tab에서 알림 임계값, 서버 URL, 폴링 간격을 변경하고 `~/.spyglass/config.json`에 저장한다.
이 태스크는 **TUI 전용**이다. 웹 대시보드의 설정 저장은 이번 범위에 포함하지 않는다.

**에러 처리**:
- config.json 없음 → 기본값 자동 생성
- config.json 파싱 실패 → 기본값 사용 + 경고 표시
- 쓰기 권한 없음 → 인라인 에러 메시지 + 설정 적용은 세션 내 유지

### 구현 범위

- `packages/tui/src/hooks/useConfig.ts` 신규 생성:
  - 기본값: `{ warning: 5000, critical: 10000, apiUrl: 'http://localhost:9999', pollInterval: 5000 }`
  - `~/.spyglass/config.json` 읽기 (`fs.readFileSync`) + 쓰기 (`fs.writeFileSync`)
  - 파싱/쓰기 실패 시 try/catch 에러 반환
- `packages/tui/src/components/SettingsTab.tsx`:
  - 현재 설정값 표시 + 키보드 편집 (숫자/텍스트 입력, Enter 저장)
  - 저장 성공/실패 피드백 메시지 (1초 후 자동 소거)
- `packages/tui/src/hooks/useAlerts.ts`: `useConfig`에서 임계값 읽어 사용

### 커밋 메시지
```
feat(tui): Settings Tab 구현 — ~/.spyglass/config.json 기반 설정
```

### 검증 명령어
```bash
bun run typecheck
# 수동: F4에서 임계값 변경 → 저장 → TUI 재시작 후 값 유지 확인
```

### 완료 기준
- [ ] 설정 변경 후 `~/.spyglass/config.json`에 저장
- [ ] TUI 재시작 후 설정값 유지
- [ ] 임계값 변경이 알림 시스템에 즉시 반영
- [ ] config.json 없을 때 기본값으로 자동 생성
- [ ] 쓰기 실패 시 에러 메시지 표시
- [ ] `bun run typecheck` 통과

---

## T-12: 웹 대시보드 — 최근 요청 타입 필터 + 더 보기

**선행 조건**: T-02 완료 후

### 작업 내용

최근 요청 테이블에 타입 필터 버튼과 "더 보기" 기능을 추가한다.
필터는 클라이언트 CSS show/hide 방식으로 구현해 실시간 추가와 충돌 최소화.

**필터 변경 시**: offset을 0으로 초기화하고 현재 행 목록 초기화.  
**SSE 실시간 모드**: "더 보기" 버튼 비활성화 표시 (실시간 중에는 페이지네이션 혼용 방지).

### 구현 범위

- `packages/web/index.html`:
  - 최근 요청 테이블 상단에 필터 버튼 추가 (All / prompt / tool_call / system)
  - 필터 변경 시 해당 타입 외 행 CSS `display:none` (DOM 보존)
  - 테이블 하단에 "더 보기" 버튼 추가
  - 클릭 시 `/api/requests?limit=10&offset=N` 호출, 기존 tbody에 append
  - 필터 변경 시 offset=0 초기화 + append된 행 제거
  - SSE 연결 중 더 보기 버튼 `disabled` 상태 표시

### 커밋 메시지
```
feat(web): 최근 요청 타입 필터 + 더 보기 추가
```

### 검증 명령어
```bash
# 브라우저: 필터 버튼 → 해당 타입만 표시
# 더 보기 → 10건 append 확인
# 필터 변경 → offset 초기화 확인
```

### 완료 기준
- [ ] 필터 버튼 (All/prompt/tool_call/system) 동작
- [ ] "더 보기" 클릭 시 offset 기반으로 다음 10건 append
- [ ] 필터 변경 시 offset 및 추가 행 초기화
- [ ] SSE 연결 중 더 보기 비활성화 상태 표시

---

## T-13: 웹 대시보드 — 턴 뷰 토큰 비중 바 + 세션 상세 집계 배지

**선행 조건**: 없음

### 작업 내용

세션 상세 뷰를 분석 도구로서 더 유용하게 만든다.

**엣지 케이스**: 세션 총 토큰이 0일 때 NaN/Infinity 방어 (`totalTokens > 0` 조건 체크 후 bar 렌더).

### 구현 범위

- `packages/web/index.html`:
  - 턴 뷰 아코디언 헤더에 인라인 토큰 비중 바 추가
    - `(턴 토큰 / 전체 세션 토큰) * 100`으로 너비 계산
    - CSS `.bar-track / .bar-fill` 기존 클래스 재사용
  - 세션 상세 헤더 영역에 배지 추가:
    - "최고 비용 Turn: T{N} ({K} tokens)"
    - "최다 호출 Tool: {tool_name} ({N}회)"
  - 플랫 뷰에서 타입별 소계 행 추가 (prompt X건 / tool_call Y건 / system Z건)

### 커밋 메시지
```
feat(web): 턴 뷰 토큰 비중 바 및 세션 상세 집계 배지 추가
```

### 검증 명령어
```bash
# 브라우저: 세션 선택 → 턴 뷰 탭에서 비중 바 확인
# 세션 헤더의 최고 비용 Turn, 최다 호출 Tool 배지 확인
```

### 완료 기준
- [ ] 각 Turn 아코디언 헤더에 토큰 비중 인라인 바 표시
- [ ] 세션 헤더에 집계 배지 표시
- [ ] 총 토큰 0인 경우 NaN/Infinity 렌더 없음

---

## T-14: 웹 대시보드 — tool_detail 파싱 및 표시 개선

**선행 조건**: 없음

### 작업 내용

최근 요청 테이블의 tool_detail 컬럼을 사람이 읽기 쉬운 형태로 렌더한다.

### 구현 범위

- `packages/web/index.html`:
  - `parseToolDetail(raw)` 함수 추가 (`try/catch` 폴백 포함):
    1. JSON 파싱 시도
    2. 실패 시 `key=value\nkey=value` 분리 시도
    3. 모두 실패 시 원본 텍스트 그대로
  - Agent(◎)/Skill(◉) 호출 시 기존 턴 뷰 아이콘 재사용
  - 80자 초과 시 truncate + 호버 툴팁으로 전체 표시

### 커밋 메시지
```
feat(web): tool_detail 파싱 및 가독성 개선
```

### 검증 명령어
```bash
# 브라우저: tool_call 타입 요청의 tool_detail 컬럼 표시 확인
```

### 완료 기준
- [ ] tool_detail이 키=값 형태로 가독성 있게 표시
- [ ] 파싱 실패 시 원본 텍스트 폴백
- [ ] Agent/Skill 아이콘 적용
- [ ] 80자 초과 시 truncate + 툴팁

---

## T-14t: T-14 단위 테스트 — parseToolDetail

**선행 조건**: T-14 완료 후

### 작업 내용

`parseToolDetail` 함수를 독립 테스트 파일로 검증한다.
현재 웹 대시보드는 단일 HTML 파일이므로, 함수를 별도 JS 모듈로 추출하거나
Bun 테스트에서 직접 import해 테스트한다.

### 구현 범위

- `packages/web/src/parseToolDetail.test.ts` (또는 `packages/web/__tests__/`) 신규 생성:
  - 정상 JSON 입력
  - 깨진 JSON + 정상 key=value 폴백
  - null/undefined 입력 방어
  - 중첩 없는 단순 텍스트 폴백
  - 80자 초과 입력

### 커밋 메시지
```
test(web): parseToolDetail 단위 테스트 추가
```

### 검증 명령어
```bash
bun test packages/web
```

### 완료 기준
- [ ] 5개 케이스 모두 통과
