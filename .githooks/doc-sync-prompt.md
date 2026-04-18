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

### 1. `docs/planning/05-spec.md` — 스펙 문서 (항상 검토)

**현행화 항목:**
- `Version`: `packages/server/package.json` 또는 루트 `package.json`의 version과 동기화
- `Last Updated`: 오늘 날짜로 업데이트
- **API 엔드포인트 목록**: `packages/server/src/api.ts`를 읽어 실제 엔드포인트와 일치하는지 확인
- **스키마/테이블 목록**: `packages/storage/src/schema.ts`를 읽어 실제 테이블과 일치하는지 확인
- **훅 목록**: `hooks/spyglass-collect.sh`를 읽어 지원 이벤트와 일치하는지 확인
- **기능 목록**: 새로운 기능이 추가/변경/제거된 경우 반영

### 2. `docs/planning/04-tasks.md` — 개발 Task 문서 (항상 검토)

**현행화 항목:**
- 최근 커밋 메시지를 분석하여 완료된 Phase/Task를 `✅ 완료`로 표시
- 진행 중인 작업이 있으면 `🚧 진행 중`으로 표시
- **주의**: Phase 구조, Task 내용, 개발 원칙은 변경하지 마세요. 상태만 업데이트하세요.

### 3. `docs/planning/04-tasks-ai.md` — AI 개발 Task 문서 (항상 검토)

**현행화 항목:**
- `04-tasks.md`와 동일하게 Phase/Task 완료 상태 업데이트
- AI 개발 진행 현황 반영

### 4. `README.md` — 사용자 대면 문서 (항상 검토)

**현행화 항목:**
- 버전 badge: `package.json`의 version 값과 동기화
- **기능 목록**: 스펙 문서(`05-spec.md`)의 기능과 일치하는지 확인
- **설치/실행 방법**: 실제 스크립트(`package.json`의 scripts)와 일치하는지 확인
- **주의**: README의 전체적인 톤과 스타일은 유지하세요.

### 5. `docs/planning/03-adr.md` — ADR 문서 (조건부)

**현행화 조건**: `packages/storage/**` 또는 `packages/server/**`에 아키텍처 수준의 변경이 있을 때만

**현행화 항목:**
- 새로운 기술 결정이 도입된 경우 새 ADR 항목 추가
- 기존 ADR의 상태 변경이 있는 경우 업데이트

**새 ADR 포맷:**
```
## ADR-NNN: <제목>

### 상태
**결정됨** (YYYY-MM-DD)

### 배경
<왜 이 결정이 필요했는가>

### 결정
<무엇을 결정했는가>

### 이유
<왜 이 결정을 내렸는가>
```

### 6. `docs/planning/02-prd.md` — PRD 문서 (조건부)

**현행화 조건**: 새로운 기능이 추가되거나 기존 기능이 제거/변경된 경우에만

**현행화 항목:**
- 새 기능의 요구사항 추가
- 제거된 기능 상태 변경

---

## 작업 순서

1. `packages/server/src/api.ts` 읽기 → 현재 API 파악
2. `packages/storage/src/schema.ts` 읽기 → 현재 스키마 파악
3. `hooks/spyglass-collect.sh` 읽기 → 현재 훅 동작 파악
4. 루트 `package.json` 읽기 → 현재 버전 파악
5. 각 문서를 읽고 → 변경이 필요한 항목만 수정 (Edit 도구 사용)

변경이 필요 없는 항목은 건드리지 마세요.
