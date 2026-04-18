---
name: dev-verify
description: >
  개발 완료 기능을 체계적으로 검증하는 스킬. dev-orchestrator로 구현된 기능의
  plan.md / adr.md / tasks.md를 분석하여 검증 체크리스트(verify.md)를 작성하고,
  코드 검증(Glob/Grep/LSP)과 Playwright MCP 웹 UI 검증을 병렬로 실행합니다.
  "검증해줘", "개발 검증", "구현 확인", "verify", "테스트해줘" 요청에 트리거됩니다.
  dev-orchestrator 완료 후 반드시 이 스킬로 검증하세요.
---

# dev-verify

계획 문서 기반 검증 체크리스트 생성 → 코드 검증 + Playwright UI 검증 병렬 실행

## 개요

dev-orchestrator로 구현된 기능을 검증합니다.
계획 문서를 분석해 검증 항목을 추출하고, 병렬 서브에이전트로 빠르게 검증합니다.

## 문서 위치

`.claude/docs/plans/<feature>/verify.md` — 검증 보고서 (본 스킬이 생성)

---

## 실행 단계

### Phase 0: 문서 분석

`.claude/docs/plans/<feature>/`의 문서를 읽어 검증 항목을 추출합니다.

| 문서 | 추출 항목 |
|------|----------|
| `plan.md` | 기능 요구사항(R*), 완료 기준, UI 포함 여부 |
| `adr.md` | 채택된 기술 결정 (ADR-*) |
| `tasks.md` | 태스크 목록 (T-*), 대상 파일 경로, 검증 명령어 |

feature 이름이 불명확하면 사용자에게 먼저 확인합니다.

---

### Phase 1: verify.md 작성

**검증 실행 전에** 체크리스트 문서를 먼저 작성합니다.
이후 검증 결과로 항목을 채워 넣습니다.

```markdown
# <feature> 검증 보고서

> Feature: <feature-name>
> 검증일: YYYY-MM-DD
> 상태: 🔄 검증 중

## 검증 체크리스트

### 1. 태스크 구현 검증 (tasks.md 기반)
<!-- 각 태스크의 파일 존재, 함수/클래스 구현 여부 -->
- [ ] T-01: <설명> — `<대상 파일>`
- [ ] T-02: ...

### 2. ADR 결정 준수 검증 (adr.md 기반)
<!-- 채택된 기술 결정이 실제 코드에 반영되었는지 -->
- [ ] ADR-001: <결정 제목>

### 3. 기능 요구사항 검증 (plan.md 기반)
<!-- 완료 기준 항목 -->
- [ ] R1: <요구사항>

### 4. 웹 UI 검증 (Playwright)
<!-- UI 관련 기능이 없으면 이 섹션 생략 -->
- [ ] UI-01: <화면/기능>

## 검증 결과

### 코드 검증
> 검증 중...

### 웹 UI 검증
> 검증 중...

## 종합 결과

> 🔄 검증 진행 중
```

---

### Phase 2: 병렬 검증 실행

코드 검증 에이전트와 웹 UI 검증 에이전트를 **동시에** 서브에이전트로 실행합니다.
plan.md에 UI 관련 요구사항이 없으면 웹 UI 에이전트는 생략합니다.

---

#### 코드 검증 에이전트 지침

다음 순서로 검증합니다:

1. **파일 존재 확인**: tasks.md의 각 태스크 대상 파일을 `Glob`으로 확인
2. **구현 내용 확인**: `Grep`으로 함수/클래스/메서드가 실제로 존재하는지 검색
3. **타입 안전성**: `LSP` 도구로 TypeScript 타입 오류 확인
4. **태스크 검증 명령어**: tasks.md에 명시된 검증 명령어가 있으면 `Bash`로 실행
5. **ADR 준수**: adr.md의 기술 결정이 코드에 반영되었는지 확인

각 항목은 `✅ 통과`, `❌ 실패 — <이유>`, `⚠️ 부분 — <내용>` 중 하나로 결과를 기록합니다.

---

#### 웹 UI 검증 에이전트 지침 (Playwright MCP)

**서버 기동 확인**:
```
GET http://localhost:9999/api/dashboard 로 서버 동작 여부 먼저 확인.
응답이 없으면 사용자에게 `bun run dev` 실행을 요청하고 대기.
```

**검증 순서**:

1. `mcp__playwright__browser_navigate` — 대상 URL로 이동 (기본: `http://localhost:9999`)
2. `mcp__playwright__browser_snapshot` — 현재 화면 상태 캡처
3. plan.md의 UI 요구사항 항목별:
   - `mcp__playwright__browser_click` — 버튼/탭 클릭
   - `mcp__playwright__browser_fill_form` — 입력 필드 테스트
   - `mcp__playwright__browser_wait_for` — 비동기 렌더링 대기
   - `mcp__playwright__browser_take_screenshot` — 시각적 증거 캡처
4. 각 요구사항의 통과/실패 여부와 스크린샷 경로를 기록

스크린샷은 `.claude/docs/plans/<feature>/screenshots/` 에 저장합니다.

---

### Phase 3: 결과 집계 및 verify.md 업데이트

두 에이전트 결과를 취합하여 `verify.md`를 최종 업데이트합니다.

**체크리스트 항목 표기:**
- `- [x] T-01: ... ✅` — 통과
- `- [ ] T-02: ... ❌` — 실패 (이유 기재)
- `- [ ] T-03: ... ⚠️` — 부분 통과 (내용 기재)

**종합 상태 판정:**

| 조건 | 상태 |
|------|------|
| 모든 항목 통과 | `✅ 검증 완료` |
| 일부 실패 (Critical 아님) | `⚠️ 부분 실패 — 재작업 권장` |
| Critical 항목 실패 | `❌ 검증 실패 — 재구현 필요` |

실패 항목은 구체적인 실패 이유와 수정 방향을 기록합니다.

---

## 완성된 verify.md 예시

```markdown
# tui-badge-prompt-content 검증 보고서

> Feature: tui-badge-prompt-content
> 검증일: 2026-04-18
> 상태: ✅ 검증 완료

## 검증 체크리스트

### 1. 태스크 구현 검증
- [x] T-01: RequestTypeFormatter 클래스 생성 ✅
- [x] T-02: TokenFormatter 클래스 생성 ✅
- [x] T-09: requests 테이블 preview 컬럼 추가 ✅

### 2. ADR 결정 준수 검증
- [x] ADR-001: 클래스 기반 설계 채택 ✅ — 모든 formatter가 static 메서드 클래스로 구현됨

### 3. 기능 요구사항 검증
- [x] R1: 타입 뱃지 로직 모듈화 ✅
- [x] R2: 프롬프트 내용 표시 ✅

### 4. 웹 UI 검증
- [x] UI-01: 웹 대시보드 로드 ✅
- [x] UI-02: preview 텍스트 표시 확인 ✅

## 검증 결과

### 코드 검증
✅ formatters/ 4개 파일 존재 확인  
✅ RequestTypeFormatter.getLabel(), getColor() 구현 확인  
✅ 컴포넌트 인라인 함수 제거 확인  
✅ TypeScript 타입 오류 없음

### 웹 UI 검증
✅ http://localhost:9999 대시보드 정상 로드  
✅ 스크린샷: screenshots/dashboard-main.png

## 종합 결과

**✅ 검증 완료** — 12/12 항목 통과
```

---

## 관례

- feature 이름: kebab-case
- 검증 문서: `.claude/docs/plans/<feature>/verify.md`
- 스크린샷: `.claude/docs/plans/<feature>/screenshots/`
- 커밋: `docs(<feature>): 검증 보고서 작성`
