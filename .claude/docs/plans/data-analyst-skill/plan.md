# data-analyst-skill 개발 계획

> Feature: data-analyst-skill  
> 작성일: 2026-04-19  
> 작성자: Claude Code

---

## 목표

claude-spyglass 프로젝트에서 데이터 관련 작업(스키마 분석, 신규 테이블/컬럼 추가, 쿼리 개선, 훅 스크립트 수정)을 체계적으로 수행할 수 있는 **프로젝트 전용 데이터 분석 에이전트 스킬**을 만든다.

### 문제 상황

현재 데이터 관련 요청이 들어올 때마다:
- 매번 `packages/storage/src/schema.ts`, `queries/*.ts`, `hooks/spyglass-collect.sh`를 처음부터 읽어야 함
- 마이그레이션 버전 관리 규칙(v2~v7 패턴)을 컨텍스트 없이 파악해야 함
- 신규 컬럼 추가 시 변경 파일 순서(schema → queries → index → collect → script → api)를 매번 추론

### 해결 방안

프로젝트 데이터 구조를 완전히 숙지한 전용 스킬을 만들어, 데이터 분석/스키마 변경 요청 시 즉시 올바른 패턴으로 작업한다.

---

## 범위

### 포함

- `SKILL.md` — 스킬 본문 (트리거 조건, 데이터 흐름, 작업 흐름)
- `references/schema.md` — 전체 DDL, 마이그레이션 이력, 집계 쿼리 레퍼런스
- `doc-tasks` 스킬 경로 불일치 수정 (`.claude/docs/` → `.claude/docs/plans/`)

### 제외

- 실제 데이터 분석 기능 구현 (스킬은 에이전트 지침 문서, 코드 X)
- Web/TUI UI 변경 (ui-designer 스킬 영역)
- MCP 도구 연동

---

## 스킬이 다루는 작업 유형

| 유형 | 예시 요청 | 변경 파일 |
|------|-----------|-----------|
| 데이터 분석 | "세션별 캐시 효율 알려줘" | 쿼리 작성만 |
| 컬럼 추가 | "요청에 에러 메시지 컬럼 추가" | schema → queries → index → collect → script |
| 테이블 추가 | "알림 이력 테이블 설계해줘" | schema → queries → index → api |
| 쿼리 최적화 | "도구별 통계 쿼리 느린데 개선해줘" | queries/*.ts |
| 스크립트 수정 | "훅에서 에러 메시지도 수집해줘" | spyglass-collect.sh → collect.ts |

---

## 단계별 계획

### 1단계: 스킬 문서 작성 ✅

- `SKILL.md`: 트리거 조건, 데이터 흐름, 테이블 요약, 마이그레이션 패턴, 작업 흐름
- `references/schema.md`: 전체 DDL + PRAGMA + 마이그레이션 코드 패턴 + 집계 쿼리

### 2단계: 기존 스킬 정합성 수정 ✅

- `doc-tasks/SKILL.md`: 경로 불일치 수정

### 3단계: plan·adr·tasks 문서 작성 (본 문서)

- `plan.md`, `adr.md`, `tasks.md` 작성

### 4단계: 스킬 검증 (향후)

- 실제 데이터 분석 요청으로 스킬 테스트
- 누락된 컨텍스트 발견 시 SKILL.md 보완
- 자주 쓰는 쿼리 패턴 references에 추가

---

## 완료 기준

- [x] `data-analyst` 스킬이 Claude Code 스킬 목록에 등록
- [x] `SKILL.md`에 3개 테이블 전체 컬럼 문서화
- [x] `SKILL.md`에 마이그레이션 v2~v7 패턴 및 다음 버전 추가 방법 포함
- [x] `SKILL.md`에 신규 컬럼/테이블 추가 시 변경 순서 명시
- [x] `references/schema.md`에 전체 DDL 및 집계 쿼리 예시 포함
- [x] `doc-tasks` 경로 불일치 수정
- [ ] `plan.md` / `adr.md` / `tasks.md` 작성 (본 단계)
- [ ] 실제 데이터 요청으로 스킬 검증
