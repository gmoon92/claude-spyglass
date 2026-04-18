# data-analyst-skill Tasks

> Feature: data-analyst-skill  
> 시작일: 2026-04-19  
> 상태: 진행 중

---

## Phase 1: 스킬 문서 생성

- [x] **Task 1**: `SKILL.md` 초안 작성
  - 트리거 조건, 데이터 흐름, 테이블 요약, 마이그레이션 패턴 개요, 작업 워크플로우 포함
  - 파일: `.claude/skills/data-analyst/SKILL.md`

- [x] **Task 2**: `references/schema.md` 작성
  - 전체 DDL (sessions, requests, claude_events), PRAGMA 설정
  - 마이그레이션 코드 패턴 (v2~v7 + 다음 버전 추가 방법)
  - 주요 집계 쿼리 예시 (캐시 효율, 도구별 통계, 턴 그룹핑, 시간별 분포)
  - 파일: `.claude/skills/data-analyst/references/schema.md`

---

## Phase 2: 기존 스킬 정합성 수정

- [x] **Task 3**: `doc-tasks` 경로 불일치 수정
  - 수정 전: `.claude/docs/<feature>/tasks.md`
  - 수정 후: `.claude/docs/plans/<feature>/tasks.md`
  - 파일: `.claude/skills/doc-tasks/SKILL.md`

---

## Phase 3: 계획 문서 작성 (본 단계)

- [x] **Task 4**: `plan.md` 작성
  - 목표, 범위, 스킬이 다루는 작업 유형, 단계별 계획, 완료 기준
  - 파일: `.claude/docs/plans/data-analyst-skill/plan.md`

- [x] **Task 5**: `adr.md` 작성
  - ADR-001: 스킬 범위 (지침 문서형 결정)
  - ADR-002: 문서 구조 (SKILL.md + references 분리)
  - ADR-003: 트리거 설계 (작업 유형 기반 키워드)
  - ADR-004: 마이그레이션 가이드 위치
  - 파일: `.claude/docs/plans/data-analyst-skill/adr.md`

- [ ] **Task 6**: `tasks.md` 작성 (현재 문서)
  - 파일: `.claude/docs/plans/data-analyst-skill/tasks.md`

---

## Phase 4: 스킬 검증 및 실데이터 분석

- [x] **Task 7**: 실제 데이터 분석으로 스킬 검증
  - `duration_ms` 전체 0 원인 규명: `PreToolUse` 훅 미등록 + 스크립트 라우팅 누락
  - `tool_use_id` payload에 이미 존재하나 DB 컬럼으로 미추출 확인
  - `agent_id`, `agent_type` 컬럼 실데이터 전부 null 확인
  - transcript JSONL의 `uuid`/`parentUuid`/`tool_use_id` 완전한 트리 구조 확인

- [x] **Task 8**: `duration_ms` 측정 활성화
  - `hooks/spyglass-collect.sh`: `"PreToolUse"` case 추가 → `main "pre_tool"` 라우팅
  - `.claude/settings.json`: `PreToolUse` 훅 등록
  - `SKILL.md`: 등록된 훅 이벤트 테이블 + 데이터 흐름 현행화

- [ ] **Task 9**: `references/schema.md` 최신화 유지 정책 수립
  - 마이그레이션 추가 시 `schema.md`도 함께 업데이트하는 체크리스트 항목 추가

---

## Phase 5: 확장 옵션 (선택적)

> ADR-001에서 결정 보류. 실사용 후 필요성 확인 시 진행.

- [ ] **Task 10**: `data-analyst-mcp` feature 검토
  - SQLite MCP 서버 연동으로 실제 쿼리 실행 기능 추가
  - 환경별 DB 경로 처리 방안 설계
  - 별도 plan/adr/tasks 문서 작성 필요

---

## 완료 기준

- [x] `data-analyst` 스킬이 Claude Code 스킬 목록에 등록됨
- [x] `SKILL.md`에 3개 테이블 전체 컬럼 문서화
- [x] `SKILL.md`에 마이그레이션 v2~v7 패턴 및 v8 추가 방법 포함
- [x] `SKILL.md`에 신규 컬럼/테이블 추가 시 변경 파일 순서 명시
- [x] `references/schema.md`에 전체 DDL 및 집계 쿼리 예시 포함
- [x] `doc-tasks` 경로 불일치 수정
- [x] plan.md / adr.md / tasks.md 작성 완료
- [ ] 실제 요청 시나리오로 스킬 검증
