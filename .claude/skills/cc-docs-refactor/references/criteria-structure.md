# 에이전트·스킬 구조 원칙 (기준 G·H)

cc:refactor 스킬의 기준 G(에이전트 구조)와 기준 H(스킬 구조)의 상세 탐지 기준 및 예시.

---

## 기준 G: 에이전트 구조 원칙 준수

**적용 조건**: `.claude/agents/` 하위 `.md` 파일에만 적용

에이전트는 스킬이 `Task()`로 위임하는 "단일 전문 역할 내부 서비스"입니다.
사용자가 직접 호출하는 스킬과 달리, 에이전트는 **단일 역할만 수행**하며 **stateless**합니다.

---

### G-1. `model:` frontmatter

에이전트 frontmatter에 `model:` 필드가 없으면 모든 호출이 현재 세션 모델로 실행됩니다.
비용·품질 최적화가 불가능하고, 세션 모델이 바뀌면 동작이 달라집니다.

**권장 모델 배치**:

| 에이전트 유형 | 권장 모델 | 이유 |
|------------|---------|------|
| 전략·분석·검토 (analyst, architect, critic, planner) | `claude-opus-4-6` | 고품질 판단 필요 |
| 구현·실행 (executor, debugger) | `claude-sonnet-4-6` | 비용·품질 균형 |
| 탐색·분류 (explore) | `claude-haiku-4-5-20251001` | 속도 우선 |

**탐지**: frontmatter에 `model:` 없음.

**보고서 안내 예시**: "`model:` frontmatter 없음. 구현 에이전트이면 `model: claude-sonnet-4-6` 추가 권장."

---

### G-2. 역할 경계 명시

에이전트가 하지 않는 책임을 명시해야 합니다.
"무엇을 금지하는가"로 역할 경계를 정의하는 것이 핵심입니다.

```
# ✅ 좋은 예 (analyst.md)
You are NOT responsible for:
  - code analysis (architect 에이전트 담당)
  - plan creation (planner 에이전트 담당)
  - plan review (critic 에이전트 담당)

# ❌ 나쁜 예
백엔드 개발을 수행하는 에이전트입니다.
```

**탐지**: `Role` 섹션 또는 첫 단락에서 아래 중 하나라도 없으면 문제:
- "NOT responsible for"
- "책임 외 영역"
- "담당하지 않"
- `Do_Not_Use_When`

**보고서 안내 예시**: "역할 경계 미명시. 'NOT responsible for: [담당 외 역할]' 추가 권장."

---

### G-3. `Success_Criteria`

완료를 판단하는 측정 가능한 기준이 필요합니다. 수치·패턴·검증 방법을 포함해야 합니다.

```
# ✅ 좋은 예
## Success_Criteria
- All modified files pass lsp_diagnostics with zero errors   ← 측정 가능
- Build and tests pass (fresh output shown, not assumed)     ← 검증 방법 명시
- No debug code left (console.log, TODO, HACK)              ← 구체적 패턴

# ❌ 나쁜 예
- 코드가 잘 동작하도록 수정됨  ← 측정 불가
- 테스트가 통과함              ← 어떤 테스트? 명시 필요
```

**탐지**: `Success_Criteria` 섹션 없음 또는 모든 기준에 수치·패턴이 없는 경우.

**보고서 안내 예시**: "`Success_Criteria` 없음. 측정 가능한 완료 기준 5개 이상 추가 권장."

---

### G-4. `Final_Checklist`

완료 전 에이전트가 자체 검증하는 체크리스트. 3개 이상 항목 권장.

```
# ✅ 좋은 예
## Final_Checklist
- [ ] Did I verify with fresh build/test output?
- [ ] Did I keep the change as small as possible?
- [ ] Did I match existing code patterns?

# ❌ 나쁜 예
(없음)
```

**탐지**: `Final_Checklist`, "완료 전", "자체 검증", "checklist" 관련 섹션 모두 없는 경우.

**보고서 안내 예시**: "`Final_Checklist` 없음. 완료 전 자체 검증 항목 추가 권장."

---

### G-5. `Failure_Modes_To_Avoid`

에이전트가 흔히 저지르는 실수 패턴을 명시합니다.
"하지 말아야 할 것"을 명시하면 LLM의 과잉 창의성을 억제하고 예측 가능성이 높아집니다.

```
# ✅ 좋은 예
<Failure_Modes_To_Avoid>
  Overengineering: Adding helpers not required. → make the direct change.
  Scope creep: Fixing adjacent code. → stay within the requested scope.
</Failure_Modes_To_Avoid>

# 또는 마크다운 형식
## 금지 사항
❌ 측정 없이 성능 최적화
❌ 테스트 없이 기능 구현
```

**탐지**: "금지 사항", `Failure_Modes_To_Avoid`, "하지 말 것", "❌", "금지" 패턴 중 하나라도 없는 경우.

**보고서 안내 예시**: "`Failure_Modes_To_Avoid` 없음. 안티패턴과 금지 동작 명시 권장."

---

### G-6. READ-ONLY 에이전트의 `disallowedTools`

분석·검토·비평 전용 에이전트는 Write, Edit 도구를 제한해야 합니다.
제한이 없으면 에이전트가 실수로 파일을 수정할 수 있습니다.

제한이 있으면 여러 스킬에서 **안전하게 병렬 위임**이 가능합니다 (Composability through Purity 원칙).

**READ-ONLY 에이전트 판별 기준**:

| 판별 신호 | 예시 |
|---------|------|
| 이름 | analyst, architect, critic, reviewer, checker, verifier |
| description | "분석", "검토", "평가", "리뷰" 전용으로 명시 |
| 역할 | 파일을 읽기만 하고 쓰지 않는 역할 |

**탐지**: 위 조건에 해당하는 에이전트에 `disallowedTools` 또는 `allowed-tools` 제한 없음.

**보고서 안내 예시**: "READ-ONLY 에이전트인데 `disallowedTools: [Write, Edit]` 없음. 추가 권장."

---

## 기준 H: 스킬 구조 원칙 준수

**적용 조건**: `.claude/skills/` 하위 `SKILL.md` 파일에만 적용

스킬은 사용자가 직접 호출하는 "워크플로우 전체 조율자"입니다.
에이전트를 위임하거나 다른 스킬을 순차 실행하여 복잡한 작업을 완성합니다.

---

### H-1. `level:` frontmatter

Claude가 이 스킬의 자율성 수준을 파악하는 자연어 힌트입니다.
`level`은 런타임에서 기계가 강제하지 않지만, Claude의 행동 경향에 실질적 영향을 줍니다.

| level | 의미 | 동작 경향 |
|-------|------|---------|
| 1–2 | 단순 유틸 | 사용자 확인 필요 시 즉시 질문 |
| 3 | 전문 분석·다중 에이전트 조율 | 높은 자율성, Opus 에이전트 투입 |
| 4 | 전체 파이프라인 조율 | 최대 자율성, 사용자 확인 최소화 |

**탐지**: frontmatter에 `level:` 필드 없음.

**보고서 안내 예시**: "`level:` frontmatter 없음. 오케스트레이션 스킬이면 `level: 4` 추가 권장."

---

### H-2. `Do_Not_Use_When`

스킬이 적합하지 않은 케이스와 대안 스킬을 명시합니다.
없으면 사용자가 잘못된 상황에서 스킬을 호출해 불필요한 작업이 실행됩니다.

```
# ✅ 좋은 예
## Do_Not_Use_When (또는 언제 사용하지 않는가)
| 상황 | 대신 사용할 스킬 |
|------|--------------|
| ARD만 추가 | `/ard-writer` |
| task만 분해 | `/task-writer` |
| 프론트엔드 개발 | `/interview` |

# ❌ 나쁜 예
(사용 제외 케이스 없음)
```

**탐지**: `Do_Not_Use_When`, "사용하지 않는 경우", "대신 사용", "언제 사용하지 않는가" 섹션 없음.

**보고서 안내 예시**: "`Do_Not_Use_When` 없음. 사용 제외 케이스와 대안 스킬 추가 권장."

---

### H-3. 오케스트레이션 스킬의 `pipeline:` frontmatter

여러 스킬/에이전트를 순서대로 조율하는 스킬이면 `pipeline:` 선언으로 의도를 명시합니다.
선언이 있으면 Claude가 "이 스킬이 파이프라인의 어느 단계이고, 다음이 무엇인지" 파악할 수 있습니다.

**오케스트레이션 스킬 판별 기준**:
- `Skill(...)` 또는 `Agent(...)` 순차 호출이 2개 이상
- 또는 단계 완료 후 다음 스킬로 핸드오프하는 흐름

```yaml
# ✅ 좋은 예
pipeline: [interview, ard-writer, task-writer]

# ❌ 나쁜 예
(본문에 Skill("interview") → Skill("task-writer") 순차 호출 있는데 pipeline 선언 없음)
```

**탐지**: 스킬 본문에 `Skill(...)` 또는 `Agent(...)` 순차 호출이 2개 이상인데 frontmatter에 `pipeline:` 없음.

**보고서 안내 예시**: "오케스트레이션 스킬인데 `pipeline:` frontmatter 없음. `pipeline: [A, B, C]` 추가 권장."

---

### H-4. Bounded Iteration (최대 반복 횟수 명시)

반복 루프가 있는 스킬은 반드시 최대 횟수와 조기 종료 조건을 명시해야 합니다.
없으면 무한 루프로 세션이 낭비되거나, LLM이 완료 시점을 판단하지 못합니다.

```
# ✅ 좋은 예
수정 루프 (최대 3회): 3회 초과 시 루프를 종료합니다.
Re-review Loop (max 5 iterations): 5회 초과 시 최선 버전으로 진행.

# ❌ 나쁜 예
승인될 때까지 반복합니다.
테스트가 통과할 때까지 재시도합니다.
```

**탐지**: "반복", "loop", "재실행", "iterate", "다시" 표현이 있는 섹션에서 "최대", "max", "N회", "회 초과" 같은 상한이 없는 경우.

**보고서 안내 예시**: "반복 루프에 최대 횟수 없음. '최대 N회, 초과 시 [처리]' 형식 추가 권장."

---

### H-5. Failsafe Delegation (외부 위임 실패 처리)

`Skill()` 또는 `Agent()` 호출이 있는 스킬은 위임 실패 시 동작을 정의해야 합니다.
없으면 외부 스킬/에이전트 호출 실패 시 스킬 전체가 중단됩니다.

```
# ✅ 좋은 예
**위임 실패 시**: Skill을 호출할 수 없는 경우, 수동 실행 방법을 안내하고 계속합니다.
Skip silently if delegation is unavailable. Never block on external consultation.

# ❌ 나쁜 예
Skill("task-writer")를 실행합니다. (실패 처리 없음)
Agent(subagent_type="architect") 호출. (실패 경로 없음)
```

**탐지**: `Skill(...)` 또는 `Agent(...)` 호출이 있는데 해당 호출 근처에 "위임 실패", "실패 시", "fallback", "skip", "수동" 처리 없음.

**보고서 안내 예시**: "`Skill(...)` 위임에 실패 처리 없음. '위임 실패 시 수동 경로 안내' 추가 권장."

---

### H-6. Final Checklist

완료 전 스킬이 자체 검증하는 체크리스트. 산출물 경로, 소스 코드 미수정 여부 등 포함 권장.

```
# ✅ 좋은 예
## Final Checklist
- [ ] plan.md가 지정 경로에 저장되었다
- [ ] ARD.md status가 approved로 변경되었다
- [ ] 소스 코드를 수정하지 않았다

# ❌ 나쁜 예
(없음)
```

**탐지**: `Final Checklist`, "완료 전 자체 검증", "체크리스트" 관련 섹션 없음.

**보고서 안내 예시**: "`Final Checklist` 없음. 완료 전 자체 검증 항목 추가 권장."

---

## 처리 규칙 (기준 G·H 공통)

기준 G·H에서 발견된 항목은 **수정 초안에서 직접 내용을 추가하지 않습니다.**

이유: 에이전트의 역할 경계, 성공 기준, 체크리스트는 해당 에이전트/스킬의 도메인 지식이 필요합니다.
cc:refactor가 임의로 내용을 추가하면 부정확한 내용이 삽입될 수 있습니다.

대신 Step 4 보고서의 "에이전트·스킬 구조 준수 검증" 섹션에 아래 형식으로 출력합니다:

```
### 에이전트·스킬 구조 준수 검증 (기준 G/H)
| # | 기준 | 누락 항목 | 사용자 안내 |
|---|------|---------|-----------|
| 1 | G-1  | model: frontmatter 누락 | "model: claude-sonnet-4-6 추가 권장 (구현 에이전트)" |
| 2 | H-4  | 반복 루프 최대 횟수 미명시 | "'최대 N회, 초과 시 ...' 형식으로 수정 권장" |
```
