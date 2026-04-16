# spyglass 개발 Task 문서

> Phase 기반 작업 관리 + 원자성 커밋 + git bisect 지원

---

## 개발 원칙

### 1. Phase 기반 개발

각 Phase는 **독립적이고 완결된 단위**로 개발합니다.

```
Phase 1: Storage (SQLite) - 완료 후 커밋
Phase 2: Hooks (데이터 수집) - 완료 후 커밋
Phase 3: Server (API) - 완료 후 커밋
Phase 4: TUI 기본 구조 - 완료 후 커밋
Phase 5: TUI Live 탭 - 완료 후 커밋
Phase 6: TUI History/Analysis 탭 - 완료 후 커밋
Phase 7: 알림 기능 - 완료 후 커밋
```

### 2. 원자성 커밋

**각 Phase 완료 시 반드시 커밋**

```bash
# Phase N 완료 시
feat(phase-N): <phase-name> 구현 완료

# 예시
feat(phase-1): storage 패키지 SQLite 스키마 및 쿼리 구현
```

**커밋 메시지 규칙:**
- `feat(phase-{N}): <설명>` - 기능 구현
- `test(phase-{N}): <설명>` - 테스트 추가
- `fix(phase-{N}): <설명>` - 버그 수정

### 3. 상태 관리

각 Phase는 `phases/{phase-name}/status.json`으로 상태 관리

```json
{
  "phase": "phase-1-storage",
  "status": "completed",
  "started_at": "2026-04-16T10:00:00Z",
  "completed_at": "2026-04-16T12:00:00Z",
  "commit_hash": "abc1234",
  "tasks": [
    {"id": "1-1", "name": "SQLite 스키마 설계", "status": "completed"},
    {"id": "1-2", "name": "WAL 모드 설정", "status": "completed"},
    {"id": "1-3", "name": "CRUD 쿼리 구현", "status": "completed"}
  ],
  "blockers": [],
  "notes": "WAL 모드로 동시성 확보"
}
```

### 4. git bisect 준비

**Phase 커밋 태그**

```bash
# 각 Phase 완료 후 태그 생성
git tag phase-1-storage-complete
git tag phase-2-hooks-complete
...
```

**문제 발생 시 bisect**

```bash
# phase-3에서 문제 발견
git bisect start
git bisect bad HEAD
git bisect good phase-2-hooks-complete

# 자동 테스트 실행
git bisect run npm test
```

---

## Phase 상세

### Phase 1: Storage (SQLite)

**목표:** 데이터 저장소 구현

**기간:** 2일

**Task 목록:**

| ID | Task | 예상 시간 | 완료 기준 |
|----|------|----------|----------|
| 1-1 | SQLite 스키마 설계 (Session, Request 테이블) | 4h | schema.ts 작성, ERD 완성 |
| 1-2 | WAL 모드 설정 및 DB 초기화 | 2h | WAL 모드 활성화, 연결 테스트 |
| 1-3 | Session CRUD 쿼리 구현 | 3h | 생성/조회/업데이트/삭제 테스트 통과 |
| 1-4 | Request CRUD 쿼리 구현 | 3h | 생성/조회/필터링/집계 테스트 통과 |
| 1-5 | 단위 테스트 작성 | 4h | 모든 쿼리 함수 테스트 커버리지 80%+ |

**완료 커밋:**
```
feat(phase-1): storage 패키지 SQLite 스키마 및 쿼리 구현

- Session, Request 테이블 스키마
- WAL 모드 설정
- CRUD 및 집계 쿼리
- 단위 테스트
```

**산출물:**
- `packages/storage/src/schema.ts`
- `packages/storage/src/index.ts`
- `packages/storage/src/queries.ts`
- `packages/storage/src/__tests__/*.test.ts`

---

### Phase 2: Hooks (데이터 수집)

**목표:** Claude Code 훅에서 데이터 수집

**기간:** 1.5일

**Task 목록:**

| ID | Task | 예상 시간 | 완료 기준 |
|----|------|----------|----------|
| 2-1 | spyglass-collect.sh 스크립트 작성 | 3h | 훅 데이터 파싱 및 전송 |
| 2-2 | HTTP API 엔드포인트 구현 (/collect) | 3h | POST /collect 받아서 SQLite 저장 |
| 2-3 | 토큰 파싱 로직 구현 | 4h | 응답에서 input/output/total 토큰 추출 |
| 2-4 | 요청 타입 분류 (prompt/tool_call) | 3h | 휴리스틱 기반 타입 분류 |
| 2-5 | 통합 테스트 | 3h | 훅 → 서버 → DB 저장 E2E 테스트 |

**완료 커밋:**
```
feat(phase-2): hooks 데이터 수집 구현

- spyglass-collect.sh 훅 스크립트
- /collect HTTP 엔드포인트
- 토큰 파싱 및 타입 분류
- E2E 테스트
```

**산출물:**
- `hooks/spyglass-collect.sh`
- `packages/server/src/collect.ts`

---

### Phase 3: Server (API + SSE)

**목표:** HTTP 서버 및 실시간 스트리밍 API

**기간:** 1.5일

**Task 목록:**

| ID | Task | 예상 시간 | 완료 기준 |
|----|------|----------|----------|
| 3-1 | Bun HTTP 서버 기본 구조 | 3h | 서버 시작/종료, 라우팅 |
| 3-2 | REST API 엔드포인트 구현 | 4h | GET /sessions, GET /requests, GET /stats |
| 3-3 | SSE 스트리밍 구현 | 4h | 실시간 데이터 변경 브로드캐스트 |
| 3-4 | 글로벌 데몬 설정 | 3h | 포트 관리, 프로세스 싱글톤 |
| 3-5 | 통합 테스트 | 2h | API 테스트, SSE 클라이언트 테스트 |

**완료 커밋:**
```
feat(phase-3): server API 및 SSE 구현

- Bun HTTP 서버
- REST API 엔드포인트
- SSE 실시간 스트리밍
- 글로벌 데몬 설정
```

**산출물:**
- `packages/server/src/index.ts`
- `packages/server/src/api.ts`
- `packages/server/src/sse.ts`

---

### Phase 4: TUI 기본 구조

**목표:** Ink 기반 TUI 기본 레이아웃

**기간:** 1일

**Task 목록:**

| ID | Task | 예상 시간 | 완료 기준 |
|----|------|----------|----------|
| 4-1 | Ink 프로젝트 설정 | 2h | 의존성 설치, 빌드 설정 |
| 4-2 | 기본 레이아웃 컴포넌트 | 4h | Header, Sidebar, Main, Footer |
| 4-3 | 탭 네비게이션 구현 | 3h | F1~F4 탭 전환 |
| 4-4 | 키보드 핸들러 | 3h | 단축키 처리 |

**완료 커밋:**
```
feat(phase-4): TUI 기본 구조 및 탭 네비게이션

- Ink 프로젝트 설정
- 레이아웃 컴포넌트
- F1~F4 탭 전환
- 키보드 핸들러
```

**산출물:**
- `packages/tui/src/index.tsx`
- `packages/tui/src/components/Layout.tsx`
- `packages/tui/src/components/TabBar.tsx`

---

### Phase 5: TUI Live 탭

**목표:** 실시간 토큰 카운터 화면

**기간:** 1.5일

**Task 목록:**

| ID | Task | 예상 시간 | 완료 기준 |
|----|------|----------|----------|
| 5-1 | SSE 클라이언트 연결 | 3h | 서버 SSE 연결, 데이터 수신 |
| 5-2 | 실시간 카운터 UI | 4h | 누적 토큰, 세션 시간 표시 |
| 5-3 | 프로그레스 바 구현 | 3h | 토큰 사용량 시각화 |
| 5-4 | 최근 요청 목록 | 3h | 실시간 갱신되는 요청 리스트 |
| 5-5 | 통합 테스트 | 3h | 실제 데이터로 UI 테스트 |

**완료 커밋:**
```
feat(phase-5): TUI Live 탭 실시간 카운터

- SSE 클라이언트 연결
- 실시간 토큰 카운터
- 프로그레스 바
- 최근 요청 목록
```

**산출물:**
- `packages/tui/src/components/LiveTab.tsx`
- `packages/tui/src/hooks/useSSE.ts`
- `packages/tui/src/hooks/useStats.ts`

---

### Phase 6: TUI History/Analysis 탭

**목표:** 과거 세션 및 요청 분석 화면

**기간:** 1.5일

**Task 목록:**

| ID | Task | 예상 시간 | 완료 기준 |
|----|------|----------|----------|
| 6-1 | History 탭 세션 목록 | 4h | 과거 세션 조회, 필터링 |
| 6-2 | Analysis 탭 요청 분석 | 4h | TOP 소모 요청, 통계 |
| 6-3 | 데이터 테이블 컴포넌트 | 4h | 정렬, 검색, 페이지네이션 |
| 6-4 | 상세 보기 모달 | 3h | 요청 상세 정보 팝업 |
| 6-5 | 통합 테스트 | 3h | E2E 테스트 |

**완료 커밋:**
```
feat(phase-6): TUI History/Analysis 탭

- 세션 목록 조회
- 요청 분석 및 통계
- 데이터 테이블
- 상세 보기 모달
```

**산출물:**
- `packages/tui/src/components/HistoryTab.tsx`
- `packages/tui/src/components/AnalysisTab.tsx`
- `packages/tui/src/components/DataTable.tsx`

---

### Phase 7: 알림 기능

**목표:** 토큰 누수 알림

**기간:** 1일

**Task 목록:**

| ID | Task | 예상 시간 | 완료 기준 |
|----|------|----------|----------|
| 7-1 | 알림 로직 구현 | 3h | 10K 토큰 초과 감지 |
| 7-2 | 알림 배너 UI | 3h | 상단 알림 표시 |
| 7-3 | 알림 레벨 (정상/주의/경고) | 3h | 색상 구분 |
| 7-4 | 알림 히스토리 | 3h | 알림 기록 저장 및 조회 |
| 7-5 | 통합 테스트 | 2h | 알림 동작 테스트 |

**완료 커밋:**
```
feat(phase-7): 토큰 누수 알림 기능

- 10K 토큰 알림 로직
- 알림 배너 UI
- 레벨 구분 (정상/주의/경고)
- 알림 히스토리
```

**산출물:**
- `packages/tui/src/components/AlertBanner.tsx`
- `packages/tui/src/hooks/useAlerts.ts`

---

## 상태 관리 JSON 스키마

### 전체 진행 상황

```json
{
  "project": "spyglass",
  "version": "0.1.0",
  "current_phase": "phase-1-storage",
  "phases": [
    {
      "id": "phase-1-storage",
      "name": "Storage (SQLite)",
      "status": "in_progress",
      "started_at": "2026-04-16T10:00:00Z",
      "completed_at": null,
      "commit_hash": null,
      "progress": 0.3,
      "tasks_total": 5,
      "tasks_completed": 1
    },
    {
      "id": "phase-2-hooks",
      "name": "Hooks (데이터 수집)",
      "status": "pending",
      "started_at": null,
      "completed_at": null,
      "commit_hash": null,
      "progress": 0,
      "tasks_total": 5,
      "tasks_completed": 0
    }
  ],
  "total_progress": 0.05,
  "estimated_completion": "2026-04-30"
}
```

### Phase별 상세

위치: `phases/{phase-name}/status.json`

```json
{
  "phase": "phase-1-storage",
  "status": "completed",
  "started_at": "2026-04-16T10:00:00Z",
  "completed_at": "2026-04-16T18:00:00Z",
  "commit_hash": "abc1234",
  "tasks": [
    {
      "id": "1-1",
      "name": "SQLite 스키마 설계",
      "status": "completed",
      "started_at": "2026-04-16T10:00:00Z",
      "completed_at": "2026-04-16T12:00:00Z"
    },
    {
      "id": "1-2",
      "name": "WAL 모드 설정",
      "status": "completed",
      "started_at": "2026-04-16T12:00:00Z",
      "completed_at": "2026-04-16T14:00:00Z"
    },
    {
      "id": "1-3",
      "name": "Session CRUD 쿼리",
      "status": "completed",
      "started_at": "2026-04-16T14:00:00Z",
      "completed_at": "2026-04-16T16:00:00Z"
    },
    {
      "id": "1-4",
      "name": "Request CRUD 쿼리",
      "status": "completed",
      "started_at": "2026-04-16T16:00:00Z",
      "completed_at": "2026-04-16T17:00:00Z"
    },
    {
      "id": "1-5",
      "name": "단위 테스트",
      "status": "completed",
      "started_at": "2026-04-16T17:00:00Z",
      "completed_at": "2026-04-16T18:00:00Z"
    }
  ],
  "blockers": [],
  "notes": "WAL 모드로 동시성 확보, 테스트 커버리지 85%",
  "next_steps": ["phase-2-hooks 시작"]
}
```

---

## Git Workflow

### 브랜치 전략

```
main
  └── phase/1-storage
        └── (완료 후 머지)
  └── phase/2-hooks
        └── (완료 후 머지)
  └── phase/3-server
        └── (완료 후 머지)
```

### 커밋 규칙

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Type:**
- `feat(phase-{N})`: 새 기능
- `fix(phase-{N})`: 버그 수정
- `test(phase-{N})`: 테스트
- `docs(phase-{N})`: 문서
- `refactor(phase-{N})`: 리팩토링

**예시:**
```
feat(phase-1): SQLite 스키마 및 WAL 모드 설정

test(phase-1): Session/Request CRUD 쿼리 테스트 추가

fix(phase-2): 토큰 파싱 오류 수정
```

### 태그 관리

```bash
# Phase 완료 시
git tag phase-1-storage-complete
git tag phase-2-hooks-complete
...

# 배포 시
git tag v0.1.0-mvp
```

---

## 개발 체크리스트

### Phase 시작 시

- [ ] 이전 Phase 완료 확인
- [ ] 브랜치 생성: `git checkout -b phase/{N}-{name}`
- [ ] status.json 초기화
- [ ] Task 목록 확인

### Phase 진행 중

- [ ] 각 Task 완료 시 status.json 업데이트
- [ ] 테스트 작성 (TDD)
- [ ] 커밋 메시지 규칙 준수

### Phase 완료 시

- [ ] 모든 Task 완료
- [ ] 테스트 통과
- [ ] status.json 완료 상태로 업데이트
- [ ] 커밋: `feat(phase-{N}): <description>`
- [ ] 태그 생성: `git tag phase-{N}-{name}-complete`
- [ ] main 브랜치로 머지
- [ ] 다음 Phase 브랜치 생성

---

## 롤백 시나리오

### 특정 Phase로 롤백

```bash
# Phase 3에서 문제 발생, Phase 2 상태로 롤백
git reset --hard phase-2-hooks-complete

# 또는 bisect로 문제 지점 찾기
git bisect start
git bisect bad HEAD
git bisect good phase-2-hooks-complete
```

### 특정 Task만 롤백

```bash
# Task 3-2만 롤백
git log --oneline --grep="3-2"
git revert <commit-hash>
```

---

## 예상 일정

| Phase | 기간 | 누적 |
|-------|------|------|
| 1. Storage | 2일 | 2일 |
| 2. Hooks | 1.5일 | 3.5일 |
| 3. Server | 1.5일 | 5일 |
| 4. TUI 기본 | 1일 | 6일 |
| 5. TUI Live | 1.5일 | 7.5일 |
| 6. TUI History | 1.5일 | 9일 |
| 7. 알림 | 1일 | 10일 |
| **버퍼** | **4일** | **14일 (2주)** |

**총 예상 기간: 2주**

---

## 참고 문서

- `docs/planning/01-overview-plan.md` - 프로젝트 개요
- `docs/planning/02-prd.md` - 제품 요구사항
- `docs/planning/03-adr.md` - 기술 결정 기록

---

*작성일: 2026-04-16*
*업데이트: Phase 진행 상황에 따라 수동 업데이트*
