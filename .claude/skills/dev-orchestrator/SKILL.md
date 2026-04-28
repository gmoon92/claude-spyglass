---
name: dev-orchestrator
description: >
  소프트웨어 개발 오케스트레이션 스킬. 계획 문서(plan.md)를 입력받아
  도메인 전문가 2-3명이 회의하여 ADR을 작성하고, 원자성 커밋 단위의 세부 작업 문서를
  생성한 뒤 작업 전문가 2명이 검토·실행하는 전체 개발 흐름을 조율합니다.
  "개발 계획 세워줘", "전문가 회의 진행해줘", "아키텍처 결정 문서 만들어줘",
  "작업 분해해줘", "개발 오케스트레이션", "ADR 작성해줘" 요청에 트리거됩니다.
  계획 문서가 있을 때 반드시 이 스킬을 사용하세요.
---

# dev-orchestrator

계획 문서 → 전문가 회의 → ADR → 원자성 작업 분해 → 검토 → 실행

## 개요

이 스킬은 소프트웨어 개발의 전체 기획-설계-실행 흐름을 오케스트레이션합니다.
전문가 서브에이전트를 병렬 실행하여 체계적인 기술 결정과 작업 계획을 생성합니다.

## 문서 구조

기능(feature)별 디렉토리로 관리합니다.

```
.claude/docs/plans/{feature-name}/
├── plan.md     # 입력 계획 문서
├── adr.md      # 전문가 회의 산출 ADR
├── task.json   # 태스크 인덱스 (doc-tasks 스킬 관리)
└── tasks/      # 개별 원자성 태스크 파일 (doc-tasks 스킬 관리)
```

- `{feature-name}`: kebab-case (예: `user-auth`, `payment-api`, `dashboard`)
- 기능이 명확하지 않으면 사용자에게 feature 이름을 먼저 확인합니다.
- 태스크 파일 구조·스키마·샘플은 `doc-tasks` 스킬 참조

---

## 실행 단계

### Phase 0: 계획 분석

`${CLAUDE_PROJECT_DIR}/.claude/docs/plans/{feature}/plan.md`를 읽고 다음을 파악합니다:

- **프로젝트 유형**: 웹 서비스 / CLI / 라이브러리 / 데이터 파이프라인 등
- **기술 스택**: 언어, 프레임워크, DB, 인프라
- **핵심 컴포넌트**: 구현해야 할 주요 모듈/계층
- **필요 전문성**: 어떤 도메인 전문가가 필요한지

분석 결과를 바탕으로 전문가 구성을 결정합니다.
전문가 선발 기준은 `references/expert-roles.md`를 참고합니다.

---

### Phase 1: 전문가 구성

2-3명의 전문가를 선발합니다. **소프트웨어 아키텍트는 항상 포함**합니다.

사용자에게 선발된 전문가 목록을 확인받고 시작합니다:

```
다음 전문가들로 회의를 진행하려 합니다:
1. 소프트웨어 아키텍트
2. {도메인 전문가 1}
3. {도메인 전문가 2}

이대로 진행할까요?
```

---

### Phase 2: 전문가 회의 (병렬 서브에이전트)

전문가 2-3명을 **동시에** 서브에이전트로 실행합니다.

각 서브에이전트에 전달하는 내용:
- `${CLAUDE_PROJECT_DIR}/.claude/docs/plans/{feature}/plan.md` 전체 내용
- 해당 전문가의 페르소나 (역할, 전문 영역, 관점)
- 회의 프로토콜 (`references/meeting-protocol.md` 내용 요약)

각 전문가의 출력물:
1. **관심 영역**: 이 전문가 관점에서 중요한 아키텍처 포인트
2. **기술적 우려사항**: 잠재적 위험, 병목, 보안/성능 이슈
3. **권고 결정사항**: 채택을 권장하는 기술/방법론/패턴
4. **대안 분석**: 주요 결정마다 대안과 트레이드오프

모든 전문가 응답이 완료되면 합성하여 `${CLAUDE_PROJECT_DIR}/.claude/docs/plans/{feature}/adr.md`를 작성합니다.
ADR 형식은 `references/meeting-protocol.md`를 따릅니다.

---

### Phase 3: 원자성 작업 분해

`plan.md`와 `adr.md`를 기반으로 태스크를 분해합니다.

원자성 분해 원칙:
- **하나의 태스크 = 하나의 커밋** (git bisect 가능)
- 각 커밋 후 코드베이스가 빌드/테스트 가능한 상태 유지
- 의존성 순서로 정렬 (선행 태스크 먼저)
- 병렬 가능한 태스크 식별

태스크 파일 생성은 **`doc-tasks` 스킬에 위임**합니다.
태스크 분해 원칙은 `references/atomic-task-guide.md`를 참고합니다.

---

### Phase 4: 작업 검토 (병렬 서브에이전트)

검토 전문가 2명을 **동시에** 서브에이전트로 실행합니다.

각 검토 전문가는 다음을 검토합니다:
- **완전성**: plan과 adr의 모든 요구사항이 tasks에 반영되었는가
- **원자성**: 각 태스크가 단일 커밋으로 분리 가능한가
- **의존성**: 태스크 순서가 올바른가 (선행 조건 충족)
- **검증 가능성**: 각 태스크의 완료 기준이 명확한가
- **위험도**: 롤백이 필요할 수 있는 고위험 태스크 식별

검토 결과는 `${CLAUDE_PROJECT_DIR}/.claude/docs/plans/{feature}/review-{reviewer}.md`로 저장합니다.

**검토 결과 처리:**
- 두 검토자 모두 승인 → Phase 5 진행
- 수정 의견 있음 → **`doc-tasks` 스킬로 태스크 수정** 후 재검토 요청

---

### Phase 5: 실행

검토가 승인되면 사용자에게 실행 여부를 확인합니다:

```
검토가 완료되었습니다.
- 총 {N}개 태스크
- 예상 커밋 수: {N}
- 시작하시겠습니까?
```

#### 5-A: 순차 실행 (기본)

- 태스크 시작/완료 시 **`doc-tasks` 스킬로 상태 갱신**
- 검증 명령어(`verification.commands`) 실행 후 다음 태스크로 이동
- 실패 시 즉시 중단하고 원인 보고. 고위험 태스크(`risk: "high"`)는 `rollback_checkpoint` 커밋으로 복귀

#### 5-B: git worktree 병렬 실행 (파일 겹침 없는 그룹)

태스크 그룹 간 **파일 겹침이 없고** 논리적 의존도 낮을 때, git worktree로 병렬 개발합니다.

**병렬화 조건 (모두 만족해야 함):**
1. 그룹 간 수정 파일 집합이 교집합 없음
2. 그룹 B가 그룹 A의 런타임 결과물에 논리적으로 의존하지 않음
3. 각 그룹이 독립적으로 `bun test` 통과 가능

**실행 절차:**

```bash
# 1. 각 브랜치용 worktree 생성 (현재 HEAD 기준)
git worktree add ../{feature}-branch-a -b {feature}/branch-a
git worktree add ../{feature}-branch-b -b {feature}/branch-b

# 2. 서브에이전트를 각 worktree에서 병렬 실행
#    Agent isolation: "worktree" 파라미터는 사용하지 않고,
#    각 에이전트 프롬프트에 worktree 경로를 명시함

# 3. 병렬 완료 후 main으로 순서대로 merge
git merge {feature}/branch-a
git merge {feature}/branch-b

# 4. 통합 검증 (T-N: 회귀 테스트 태스크)
bun test
```

**⚠️ 필수: worktree 정리 (merge 완료 직후 반드시 실행)**

```bash
# worktree 디렉토리 제거
git worktree remove ../{feature}-branch-a
git worktree remove ../{feature}-branch-b

# 피처 브랜치 삭제
git branch -d {feature}/branch-a {feature}/branch-b

# 정리 완료 확인 — main worktree만 남아 있어야 함
git worktree list
git branch
```

정리를 빠뜨리면 `git worktree list`에 고아 경로가 남고, 디렉토리가 디스크에 잔류합니다.
통합 검증(`bun test`) 직후, 사용자에게 결과를 보고하기 **전에** 반드시 실행하세요.

**서브에이전트 프롬프트에 반드시 포함할 내용:**
- 작업 경로: `worktree 절대 경로` (예: `/path/to/{feature}-branch-a`)
- 태스크 범위: 담당할 태스크 ID 목록
- 커밋 규칙: 각 태스크 완료 시 해당 worktree에서 커밋
- 완료 신호: 마지막 태스크 커밋 후 "DONE" 반환

**주의사항:**
- 각 서브에이전트는 자신의 worktree 내에서만 커밋
- main 브랜치나 다른 worktree 경로 접근 금지
- merge conflict 발생 시 오케스트레이터(메인)가 직접 해결

---

## 참고 파일

| 파일 | 내용 | 읽어야 할 때 |
|------|------|-------------|
| `references/expert-roles.md` | 전문가 유형과 선발 기준 | Phase 0-1 |
| `references/meeting-protocol.md` | 회의 진행 방식, ADR 형식 | Phase 2 |
| `references/atomic-task-guide.md` | 원자성 태스크 분해 원칙 | Phase 3 |
