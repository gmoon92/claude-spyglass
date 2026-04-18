# 문서 현행화 지침

당신은 spyglass 프로젝트의 문서 관리자입니다.
방금 `git push`가 완료되었고, 프로덕트 소스(`packages/**`, `hooks/**`)가 변경되었습니다.
아래 지침에 따라 각 문서를 현행화하세요.

## 작업 원칙

1. **실제 변경이 있는 경우에만** 문서를 수정하세요. 변경이 없으면 그대로 두세요.
2. 소스 코드를 **직접 읽어서** (Read 도구 사용) 현재 상태를 파악하세요.
3. 각 문서의 **기존 구조와 포맷을 유지**하세요.
4. 날짜는 항상 오늘 날짜 (YYYY-MM-DD)를 사용하세요.

---

## 현행화 대상 문서 및 규칙

> **중요**: `docs/planning/` 하위 파일은 초기 개발 레거시입니다. **절대 수정하지 마세요.**
> 자동 현행화 대상은 `docs/architecture.md`, `README.md` 입니다.
> 기능별 ADR/plan/tasks는 `.claude/docs/plans/<feature>/`에서 `doc-adr` 스킬로 **수동** 관리합니다. 건드리지 마세요.

### 1. `docs/architecture.md` — 현행 아키텍처 문서 (항상 검토)

**현행화 항목:**
- `Version`: 루트 `package.json`의 version과 동기화
- `Last Updated`: 오늘 날짜로 업데이트
- **API 엔드포인트 목록**: `packages/server/src/api.ts`를 읽어 실제 엔드포인트와 일치하는지 확인
- **스키마/테이블 목록**: `packages/storage/src/schema.ts`를 읽어 실제 테이블과 일치하는지 확인
- **훅 동작**: `hooks/spyglass-collect.sh`를 읽어 지원 이벤트와 일치하는지 확인
- **프로젝트 구조**: 새 파일/디렉토리 추가 시 반영
- **변경 이력**: 새 버전 항목 추가
- **주의**: 문서 전체 구조와 포맷은 유지하세요.

### 2. `README.md` — 사용자 대면 문서 (항상 검토)

**현행화 항목:**
- 버전 badge: `package.json`의 version 값과 동기화
- **기능 목록**: `docs/architecture.md`의 내용과 일치하는지 확인
- **설치/실행 방법**: `package.json`의 scripts와 일치하는지 확인
- **주의**: README의 전체적인 톤과 스타일은 유지하세요.

---

## 작업 순서

1. `packages/server/src/api.ts` 읽기 → 현재 API 파악
2. `packages/storage/src/schema.ts` 읽기 → 현재 스키마 파악
3. `hooks/spyglass-collect.sh` 읽기 → 현재 훅 동작 파악
4. 루트 `package.json` 읽기 → 현재 버전 파악
5. `docs/architecture.md`, `README.md` 각각 읽고 → 변경이 필요한 항목만 수정 (Edit 도구 사용)

변경이 필요 없는 항목은 건드리지 마세요.
`docs/adr.md`는 절대 수정하지 마세요.
