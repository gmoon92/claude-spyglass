# spyglass 개발 Task 문서 (AI 순차 개발용)

> Claude Code(AI)가 단독 개발하는 기준
> 원칙: 순차 개발 + 원자성 커밋 + 단계별 검증

---

## 개발 원칙

### 1. 순차 개발 (직렬)

```
Phase 1 (Storage) → Phase 2 (Hooks) → Phase 3 (Server) → Phase 4 (TUI 기본) → Phase 5 (TUI Live) → Phase 6 (TUI History) → Phase 7 (알림)
     ↑                    ↑                  ↑                  ↑                    ↑                    ↑                 ↑
  커밋+태그           커밋+태그          커밋+태그          커밋+태그            커밋+태그            커밋+태그         커밋+태그
```

**이유:**
- AI는 한 번에 하나의 Phase에 집중하는 것이 효율적
- 컨텍스트 분산 방지 → 오류 감소
- 각 Phase 완료 후 다음으로 넘어가면 깔끔한 코드 유지
- git bisect로 문제 지점 정확히 추적 가능

### 2. 원자성 커밋 (핵심)

**각 Task 완료 시 즉시 커밋 + 태그**

```bash
# Task 완료 시
feat(phase-{N}-{task-id}): <description>

# Phase 완료 시
git tag phase-{N}-{name}-complete
```

**예시:**
```bash
feat(phase-1-1): SQLite Session 테이블 스키마 설계
feat(phase-1-2): WAL 모드 설정 및 연결 풀 구현
feat(phase-1-3): Session CRUD 쿼리 구현
test(phase-1-3): Session CRUD 단위 테스트

# Phase 1 완료 시
git tag phase-1-storage-complete
```

**이유:**
- 문제 발생 시 `git bisect`로 정확한 실패 지점 찾기
- 롤백이 쉬움 (Task 단위로 되돌릴 수 있음)
- 각 단계가 완결된 상태로 저장됨

### 3. 검증 중심 개발

**각 Phase마다 완료 조건 (반드시 통과)**

| Phase | 완료 조건 | 검증 명령어/방법 |
|-------|----------|-----------------|
| 1 | SQLite 저장/조회 | `bun test packages/storage` |
| 2 | 훅 데이터 수집 | 실제 Claude Code 연동 테스트 |
| 3 | API 응답 | `curl http://localhost:PORT/api/sessions` |
| 4 | TUI 렌더링 | `bun run tui` → 화면 확인 |
| 5 | 실시간 카운터 | 실제 세션에서 토큰 표시 확인 |
| 6 | History 조회 | 탭 전환 + 목록 표시 확인 |
| 7 | 알림 | 10K 토큰 초과 시 경고 확인 |

**검증 실패 시:**
- 해당 Task 롤백 (git revert)
- 원인 분석 후 재시도
- 성공할 때까지 다음 Task로 넘어가지 않음

### 4. AI 개발 일정

사람보다 **여유 있게** (AI가 반복 수정할 수 있음)

| Phase | 작업일 | 버퍼 | 합계 |
|-------|--------|------|------|
| 1. Storage | 2일 | 1일 | 3일 |
| 2. Hooks | 2일 | 1일 | 3일 |
| 3. Server | 2일 | 1일 | 3일 |
| 4. TUI 기본 | 2일 | 1일 | 3일 |
| 5. TUI Live | 2일 | 1일 | 3일 |
| 6. TUI History | 2일 | 1일 | 3일 |
| 7. 알림 | 1일 | 1일 | 2일 |
| **총계** | **13일** | **7일** | **20일** |

**버퍼 50%+**: AI가 반복 수정, 디버깅, 문서 확인 시간 포함

---

## Phase 상세

### Phase 1: Storage (SQLite)

**목표:** 데이터 저장소 구현
**예상 기간:** 2일 (+ 1일 버퍼)

#### Task 목록

| ID | Task | 예상 시간 | 검증 명령어 | 완료 기준 |
|----|------|----------|------------|----------|
| 1-1 | SQLite 스키마 설계 (Session, Request 테이블) | 4h | - | schema.ts 작성, ERD 완성 |
| 1-2 | WAL 모드 설정 및 DB 초기화 | 3h | `bun test storage/connection.test.ts` | WAL 활성화, 연결 테스트 통과 |
| 1-3 | Session CRUD 쿼리 구현 | 4h | `bun test storage/session.test.ts` | 생성/조회/업데이트/삭제 테스트 통과 |
| 1-4 | Request CRUD 쿼리 구현 | 4h | `bun test storage/request.test.ts` | 생성/조회/필터링/집계 테스트 통과 |
| 1-5 | 단위 테스트 작성 (커버리지 80%+) | 5h | `bun test --coverage` | 커버리지 80% 이상 |

#### 커밋 순서
```bash
feat(phase-1-1): SQLite Session 테이블 스키마 설계
feat(phase-1-1): SQLite Request 테이블 스키마 설계
feat(phase-1-2): WAL 모드 설정 및 연결 풀 구현
test(phase-1-2): DB 연결 테스트 추가
feat(phase-1-3): Session CRUD 쿼리 구현
test(phase-1-3): Session CRUD 단위 테스트
feat(phase-1-4): Request CRUD 쿼리 구현
test(phase-1-4): Request CRUD 단위 테스트
feat(phase-1-5): 통합 테스트 및 커버리지 80% 달성

git tag phase-1-storage-complete
```

#### 검증 체크리스트
- [ ] SQLite 파일 생성 확인 (`~/.spyglass/spyglass.db`)
- [ ] Session 테이블 CRUD 정상 동작
- [ ] Request 테이블 CRUD 정상 동작
- [ ] WAL 모드 활성화 확인 (`PRAGMA journal_mode`)
- [ ] 테스트 커버리지 80% 이상

---

### Phase 2: Hooks (데이터 수집)

**목표:** Claude Code 훅에서 데이터 수집
**예상 기간:** 2일 (+ 1일 버퍼)
**선행 조건:** Phase 1 완료 (DB 스키마 필요)

#### Task 목록

| ID | Task | 예상 시간 | 검증 명령어 | 완료 기준 |
|----|------|----------|------------|----------|
| 2-1 | spyglass-collect.sh 스크립트 작성 | 4h | `bash hooks/spyglass-collect.sh test` | 훅 데이터 파싱 및 전송 |
| 2-2 | HTTP API 엔드포인트 구현 (/collect) | 4h | `curl -X POST http://localhost:PORT/collect` | POST /collect 받아서 SQLite 저장 |
| 2-3 | 토큰 파싱 로직 구현 | 5h | `bun test hooks/parser.test.ts` | 응답에서 input/output/total 토큰 추출 |
| 2-4 | 요청 타입 분류 (prompt/tool_call) | 4h | `bun test hooks/classifier.test.ts` | 휴리스틱 기반 타입 분류 |
| 2-5 | 통합 테스트 (훅 → 서버 → DB) | 5h | 실제 Claude Code 연동 테스트 | E2E 테스트 통과 |

#### 커밋 순서
```bash
feat(phase-2-1): spyglass-collect.sh 훅 스크립트 작성
test(phase-2-1): 훅 스크립트 단위 테스트
feat(phase-2-2): /collect HTTP 엔드포인트 구현
test(phase-2-2): collect API 테스트
feat(phase-2-3): 토큰 파싱 로직 구현
test(phase-2-3): 토큰 파싱 테스트
feat(phase-2-4): 요청 타입 분류 로직 구현
test(phase-2-4): 타입 분류 테스트
feat(phase-2-5): 훅 → 서버 → DB 통합 테스트

git tag phase-2-hooks-complete
```

#### 검증 체크리스트
- [ ] 훅 스크립트가 Claude Code에서 정상 실행
- [ ] /collect 엔드포인트로 데이터 수신
- [ ] 토큰 파싱 정확 (input/output/total)
- [ ] 요청 타입 분류 정확 (prompt/tool_call)
- [ ] 실제 세션에서 데이터 누적 확인

---

### Phase 3: Server (API + SSE)

**목표:** HTTP 서버 및 실시간 스트리밍 API
**예상 기간:** 2일 (+ 1일 버퍼)
**선행 조건:** Phase 2 완료 (데이터 수집 필요)

#### Task 목록

| ID | Task | 예상 시간 | 검증 명령어 | 완료 기준 |
|----|------|----------|------------|----------|
| 3-1 | Bun HTTP 서버 기본 구조 | 4h | `bun run server` | 서버 시작/종료, 라우팅 |
| 3-2 | REST API 엔드포인트 구현 | 5h | `curl http://localhost:PORT/api/sessions` | GET /sessions, GET /requests, GET /stats |
| 3-3 | SSE 스트리밍 구현 | 6h | `curl http://localhost:PORT/events` | 실시간 데이터 변경 브로드캐스트 |
| 3-4 | 글로벌 데몬 설정 | 4h | `spyglass start`, `spyglass stop` | 포트 관리, 프로세스 싱글톤 |
| 3-5 | 통합 테스트 | 5h | `bun test packages/server` | API 테스트, SSE 클라이언트 테스트 |

#### 커밋 순서
```bash
feat(phase-3-1): Bun HTTP 서버 기본 구조 구현
feat(phase-3-2): REST API 엔드포인트 구현 (/sessions, /requests, /stats)
test(phase-3-2): REST API 테스트
feat(phase-3-3): SSE 스트리밍 구현
test(phase-3-3): SSE 클라이언트 테스트
feat(phase-3-4): 글로벌 데몬 설정 (start/stop/status)
test(phase-3-4): 데몬 프로세스 테스트
feat(phase-3-5): 서버 통합 테스트

git tag phase-3-server-complete
```

#### 검증 체크리스트
- [ ] `spyglass start`로 서버 시작
- [ ] `curl`로 API 응답 확인
- [ ] SSE 연결 유지 확인
- [ ] `spyglass stop`로 정상 종료
- [ ] 프로세스 중복 실행 방지 확인

---

### Phase 4: TUI 기본

**목표:** Ink 기반 TUI 기본 레이아웃
**예상 기간:** 2일 (+ 1일 버퍼)
**선행 조건:** Phase 3 완료 (API 필요)

#### Task 목록

| ID | Task | 예상 시간 | 검증 명령어 | 완료 기준 |
|----|------|----------|------------|----------|
| 4-1 | Ink 프로젝트 설정 | 3h | `bun install` | 의존성 설치, 빌드 설정 |
| 4-2 | 기본 레이아웃 컴포넌트 | 5h | `bun run tui` | Header, Sidebar, Main, Footer 렌더링 |
| 4-3 | 탭 네비게이션 구현 | 5h | 키보드 F1~F4 테스트 | F1~F4 탭 전환 |
| 4-4 | 키보드 핸들러 | 5h | 키보드 q, ↑, ↓, Enter 테스트 | 단축키 처리 |
| 4-5 | 단위 테스트 | 4h | `bun test packages/tui` | 컴포넌트 테스트 |

#### 커밋 순서
```bash
feat(phase-4-1): Ink 프로젝트 설정
feat(phase-4-2): 기본 레이아웃 컴포넌트 (Header, Sidebar, Main, Footer)
test(phase-4-2): 레이아웃 컴포넌트 테스트
feat(phase-4-3): 탭 네비게이션 구현 (F1~F4)
test(phase-4-3): 탭 네비게이션 테스트
feat(phase-4-4): 키보드 핸들러 구현
test(phase-4-4): 키보드 핸들러 테스트
feat(phase-4-5): TUI 기본 통합 테스트

git tag phase-4-tui-base-complete
```

#### 검증 체크리스트
- [ ] `bun run tui`로 TUI 실행
- [ ] 화면에 Header, Sidebar, Main, Footer 표시
- [ ] F1~F4로 탭 전환
- [ ] q 키로 종료
- [ ] 방향키로 목록 이동

---

### Phase 5: TUI Live 탭

**목표:** 실시간 토큰 카운터 화면
**예상 기간:** 2일 (+ 1일 버퍼)
**선행 조건:** Phase 4 완료 (TUI 기반 필요)

#### Task 목록

| ID | Task | 예상 시간 | 검증 명령어 | 완료 기준 |
|----|------|----------|------------|----------|
| 5-1 | SSE 클라이언트 연결 | 4h | - | 서버 SSE 연결, 데이터 수신 |
| 5-2 | 실시간 카운터 UI | 6h | `bun run tui` | 누적 토큰, 세션 시간 표시 |
| 5-3 | 프로그레스 바 구현 | 5h | - | 토큰 사용량 시각화 |
| 5-4 | 최근 요청 목록 | 5h | - | 실시간 갱신되는 요청 리스트 |
| 5-5 | 통합 테스트 | 4h | 실제 세션 테스트 | 실제 데이터로 UI 테스트 |

#### 커밋 순서
```bash
feat(phase-5-1): SSE 클라이언트 연결
test(phase-5-1): SSE 연결 테스트
feat(phase-5-2): 실시간 토큰 카운터 UI
test(phase-5-2): 카운터 UI 테스트
feat(phase-5-3): 프로그레스 바 구현
test(phase-5-3): 프로그레스 바 테스트
feat(phase-5-4): 최근 요청 목록 구현
test(phase-5-4): 요청 목록 테스트
feat(phase-5-5): Live 탭 통합 테스트

git tag phase-5-tui-live-complete
```

#### 검증 체크리스트
- [ ] 실시간 토큰 카운터 갱신
- [ ] 프로그레스 바 표시
- [ ] 최근 요청 목록 실시간 갱신
- [ ] 실제 Claude Code 세션에서 토큰 표시 확인

---

### Phase 6: TUI History/Analysis 탭

**목표:** 과거 세션 및 요청 분석 화면
**예상 기간:** 2일 (+ 1일 버퍼)
**선행 조건:** Phase 5 완료 (Live 탭 기반 필요)

#### Task 목록

| ID | Task | 예상 시간 | 검증 명령어 | 완료 기준 |
|----|------|----------|------------|----------|
| 6-1 | History 탭 세션 목록 | 6h | `bun run tui` → F2 | 과거 세션 조회, 필터링 |
| 6-2 | Analysis 탭 요청 분석 | 6h | `bun run tui` → F3 | TOP 소모 요청, 통계 |
| 6-3 | 데이터 테이블 컴포넌트 | 5h | - | 정렬, 검색, 페이지네이션 |
| 6-4 | 상세 보기 모달 | 4h | Enter 키 테스트 | 요청 상세 정보 팝업 |
| 6-5 | 통합 테스트 | 3h | E2E 테스트 | E2E 테스트 통과 |

#### 커밋 순서
```bash
feat(phase-6-1): History 탭 세션 목록 구현
test(phase-6-1): 세션 목록 테스트
feat(phase-6-2): Analysis 탭 요청 분석 구현
test(phase-6-2): 분석 기능 테스트
feat(phase-6-3): 데이터 테이블 컴포넌트
test(phase-6-3): 테이블 컴포넌트 테스트
feat(phase-6-4): 상세 보기 모달 구현
test(phase-6-4): 모달 테스트
feat(phase-6-5): History/Analysis 통합 테스트

git tag phase-6-tui-history-complete
```

#### 검증 체크리스트
- [ ] History 탭에서 세션 목록 조회
- [ ] Analysis 탭에서 TOP 소모 요청 표시
- [ ] 데이터 테이블 정렬/검색 동작
- [ ] 상세 보기 모달 표시

---

### Phase 7: 알림 기능

**목표:** 토큰 누수 알림
**예상 기간:** 1일 (+ 1일 버퍼)
**선행 조건:** Phase 6 완료 (TUI 완성 필요)

#### Task 목록

| ID | Task | 예상 시간 | 검증 명령어 | 완료 기준 |
|----|------|----------|------------|----------|
| 7-1 | 알림 로직 구현 | 4h | - | 10K 토큰 초과 감지 |
| 7-2 | 알림 배너 UI | 4h | `bun run tui` | 상단 알림 표시 |
| 7-3 | 알림 레벨 (정상/주의/경고) | 3h | - | 색상 구분 |
| 7-4 | 알림 히스토리 | 3h | - | 알림 기록 저장 및 조회 |
| 7-5 | 통합 테스트 | 2h | 10K 토큰 테스트 | 알림 동작 테스트 |

#### 커밋 순서
```bash
feat(phase-7-1): 10K 토큰 알림 로직 구현
test(phase-7-1): 알림 로직 테스트
feat(phase-7-2): 알림 배너 UI 구현
test(phase-7-2): 배너 UI 테스트
feat(phase-7-3): 알림 레벨 구현 (정상/주의/경고)
test(phase-7-3): 레벨 테스트
feat(phase-7-4): 알림 히스토리 구현
test(phase-7-4): 히스토리 테스트
feat(phase-7-5): 알림 기능 통합 테스트

git tag phase-7-alerts-complete
```

#### 검증 체크리스트
- [ ] 10K 토큰 초과 시 알림 표시
- [ ] 알림 레벨 색상 구분 (🟢🟡🔴)
- [ ] 알림 히스토리 저장/조회
- [ ] 실제 10K 이상 요청에서 알림 확인

---

## 상태 관리 JSON

### 전체 진행 상황

```json
{
  "project": "spyglass",
  "version": "0.1.0",
  "development_mode": "ai_sequential",
  "current_phase": "phase-1-storage",
  "total_phases": 7,
  "phases": [
    {
      "id": "phase-1-storage",
      "name": "Storage (SQLite)",
      "status": "in_progress",
      "started_at": "2026-04-16T10:00:00Z",
      "completed_at": null,
      "commit_hash": null,
      "progress": 0.0,
      "tasks_total": 5,
      "tasks_completed": 0
    }
  ],
  "total_progress": 0.0,
  "estimated_completion": "2026-05-06"
}
```

### Phase별 상세

위치: `phases/{phase-name}/status.json`

```json
{
  "phase": "phase-1-storage",
  "status": "in_progress",
  "started_at": "2026-04-16T10:00:00Z",
  "completed_at": null,
  "commit_hash": null,
  "tasks": [
    {
      "id": "1-1",
      "name": "SQLite 스키마 설계",
      "status": "in_progress",
      "started_at": "2026-04-16T10:00:00Z",
      "completed_at": null
    }
  ],
  "verification": {
    "all_tests_passed": false,
    "coverage_met": false,
    "manual_verified": false
  },
  "blockers": [],
  "notes": ""
}
```

---

## Git Workflow

### 브랜치 전략

```
main
  └── phase/1-storage
        └── (완료 + 태그 → main 머지)
  └── phase/2-hooks
        └── (완료 + 태그 → main 머지)
  └── phase/3-server
        └── (완료 + 태그 → main 머지)
```

### 커밋 규칙

```
<type>(<scope>): <description>

[optional body]
```

**Type:**
- `feat(phase-{N}-{task-id})`: 새 기능
- `fix(phase-{N}-{task-id})`: 버그 수정
- `test(phase-{N}-{task-id})`: 테스트
- `docs(phase-{N}-{task-id})`: 문서

**예시:**
```
feat(phase-1-1): SQLite Session 테이블 스키마 설계

- Session 테이블 정의 (id, project_name, started_at, etc.)
- 인덱스 추가 (timestamp DESC)

test(phase-1-1): Session 스키마 검증 테스트
```

### 태그 관리

```bash
# Phase 완료 시
git tag phase-1-storage-complete
git tag phase-2-hooks-complete
...

# MVP 완료 시
git tag v0.1.0-mvp

# 문제 발생 시 bisect
git bisect start
git bisect bad HEAD
git bisect good phase-1-storage-complete
```

---

## 롤백 시나리오

### Task 롤백

```bash
# Task 실패 시
git log --oneline --grep="phase-1-3"
git revert <commit-hash>

# 다시 시작
git checkout -b fix/phase-1-3-retry
```

### Phase 롤백

```bash
# Phase 전체 롤백
git reset --hard phase-1-storage-complete

# 또는 새 브랜치에서 재시작
git checkout -b phase/1-storage-retry phase-1-storage-complete
```

---

## 개발 체크리스트

### Phase 시작 시

- [ ] 이전 Phase 완료 확인 (`git tag`로 태그 확인)
- [ ] 브랜치 생성: `git checkout -b phase/{N}-{name}`
- [ ] status.json 초기화
- [ ] Task 목록 확인

### Task 진행 시

- [ ] 검증 명령어로 테스트 실행
- [ ] 테스트 실패 시 디버깅
- [ ] 테스트 성공 시 커밋
- [ ] status.json 업데이트

### Task 완료 시

- [ ] 검증 명령어 통과
- [ ] 커밋: `feat(phase-{N}-{task-id}): <description>`
- [ ] status.json 업데이트

### Phase 완료 시

- [ ] 모든 Task 완료
- [ ] 모든 검증 통과
- [ ] 커밋: `feat(phase-{N}): <description>`
- [ ] 태그 생성: `git tag phase-{N}-{name}-complete`
- [ ] main 브랜치로 머지
- [ ] 다음 Phase 브랜치 생성

---

## 예상 일정 (AI 개발)

| Phase | 작업일 | 버퍼 | 합계 | 누적 |
|-------|--------|------|------|------|
| 1. Storage | 2일 | 1일 | 3일 | Day 3 |
| 2. Hooks | 2일 | 1일 | 3일 | Day 6 |
| 3. Server | 2일 | 1일 | 3일 | Day 9 |
| 4. TUI 기본 | 2일 | 1일 | 3일 | Day 12 |
| 5. TUI Live | 2일 | 1일 | 3일 | Day 15 |
| 6. TUI History | 2일 | 1일 | 3일 | Day 18 |
| 7. 알림 | 1일 | 1일 | 2일 | Day 20 |
| **총계** | **13일** | **7일** | **20일** | |

**시작일:** 2026-04-16
**완료 예정:** 2026-05-06 (20일 후)

---

## 참고 문서

- `docs/planning/01-overview-plan.md` - 프로젝트 개요
- `docs/planning/02-prd.md` - 제품 요구사항
- `docs/planning/03-adr.md` - 기술 결정 기록
- `docs/planning/04-tasks-ai.md` - 이 문서

---

*작성일: 2026-04-16*
*업데이트: 각 Phase 완료 시 자동 업데이트*

---

## 부록: 누락된 작업 사항 (2026-04-17 기준)

### Phase 4-7 진행 중 발견된 누락 작업

아래 작업들은 원래 문서에 명시되지 않았으나, 실제 개발 과정에서 필수적으로 처리한 사항입니다:

#### 1. ink 5.x API 변경 대응

**문제:** ink 4.x → 5.x 업그레이드로 인한 API 변경

**누락된 수정사항:**
- `useStdoutDimensions` 훅 제거됨 → `useStdout`로 대체
  ```typescript
  // Before (ink 4.x)
  import { useStdoutDimensions } from 'ink';
  const [columns, rows] = useStdoutDimensions();
  
  // After (ink 5.x)
  import { useStdout } from 'ink';
  const { stdout } = useStdout();
  const columns = stdout?.columns || 80;
  const rows = stdout?.rows || 24;
  ```

- `backgroundColor` prop 제거됨 → 텍스트 색상 + bold로 대체
  ```typescript
  // Before (ink 4.x)
  <Box backgroundColor="blue">
    <Text color="white">Selected</Text>
  </Box>
  
  // After (ink 5.x)
  <Box>
    <Text color="cyan" bold>{'> '}Selected</Text>
  </Box>
  ```

**영향 파일:**
- `packages/tui/src/components/Layout.tsx`
- `packages/tui/src/components/LiveTab.tsx`
- `packages/tui/src/components/TabBar.tsx`
- `packages/tui/src/components/RequestList.tsx`
- `packages/tui/src/components/AlertBanner.tsx`
- `packages/tui/src/components/AnalysisTab.tsx`
- `packages/tui/src/components/HistoryTab.tsx`

#### 2. 키보드 핸들러 수정

**문제:** ink 5.x Key 타입에 `key.function` 속성 없음

**누락된 수정사항:**
```typescript
// Before (잘못된 가정)
if (key.function) {
  switch (input) {
    case 'F1': onTabChange('live'); return;
    // ...
  }
}

// After (실제 구현)
interface ExtendedKey extends Key {
  name?: string;  // 'f1', 'f2', 'f3', 'f4', 'up', 'down', etc.
}

const extKey = key as ExtendedKey;
if (extKey.name === 'f1') { onTabChange('live'); return; }
// 숫자 1~4 키로도 탭 전환 지원 추가
if (input === '1') { onTabChange('live'); return; }
```

**영향 파일:**
- `packages/tui/src/hooks/useKeyboard.ts`

#### 3. JSX Transform 설정

**문제:** bun build 시 ink/jsx-runtime 해석 실패

**누락된 작업:**
- JSX pragma 추가: `/** @jsxImportSource react */`
- `bunfig.toml` 설정 파일 추가
  ```toml
  [jsx]
  jsx = "react-jsx"
  jsxImportSource = "react"
  
  [build]
  target = "node"
  ```
- 의존성 추가: `bun install react-devtools-core`

**영향 파일:**
- 모든 `.tsx` 파일 상단에 pragma 추가
- `bunfig.toml` (신규)

#### 4. SQLite 타입 호환성

**문제:** bun:sqlite SQLQueryBindings 타입 충돌

**누락된 수정사항:**
```typescript
// 타입 단언 필요
(db as any).run('DELETE FROM sessions WHERE id = ?', id);
// 또는
(db.query(sql) as any).all(...params);
```

**영향 파일:**
- `packages/storage/src/queries/session.ts`
- `packages/storage/src/queries/request.ts`

#### 5. Docker 구성

**문제:** 개발 환경 데이터 볼륨 관리

**누락된 작업:**
- `docker/docker-compose.yml` 작성 (SQLite는 파일 기반이라 별도 컨테이너 불필요, 데이터 볼륨만 관리)

**파일:**
- `docker/docker-compose.yml`

---

### 누락 원인 분석

1. **의존성 버전 변경**: 개발 중 ink 5.x로 업그레이드되면서 API가 변경됨
2. **타입 정의 불일치**: bun:sqlite와 TypeScript strict 모드 간 타입 호환성 문제
3. **JSX Transform**: bun의 JSX 처리 방식이 표준과 차이가 있어 별도 설정 필요
4. **빌드 타겟**: 브라우저/Node.js 타겟 혼란으로 인한 `target` 설정 필요

### 교훈

- **Phase 시작 시 의존성 버전 고정**: `package.json`에서 버전 범위 대신 정확한 버전 명시
- **API 변경 대응 시간 버퍼**: 메이저 버전 업그레이드 시 20% 추가 버퍼 권장
- **빌드 테스트 필수**: 각 Phase 완료 시 `bun build`로 컴파일 테스트 추가
