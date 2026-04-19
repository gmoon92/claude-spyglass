# CLAUDE.md

- 모든 Git 커밋 요청은 `git:commit` 스킬을 사용하세요.
- 소스 코드 분석엔 **LSP 도구를 우선 사용하세요.**
- 모든 디렉토리명과 파일명은 **kebab-case**로 작성하세요.
- 사용자가 **검토 요청**이나 **상세 분석**을 요청하면 반드시 **`sequential-thinking` MCP를 사용**하여 체계적으로 분석하세요.

## `.claude/` Claude Code 메타 문서 관리

### 경로 변수

- `PROJECT_ROOT`: ${CLAUDE_PROJECT_DIR}, 현재 작업 중인 프로젝트의 루트 경로 (환경변수)
- `CLAUDE_DIR`: `<PROJECT_ROOT>/.claude/`
- `CLAUDE_DOCS_DIR`: `<CLAUDE_DIR>/docs/`

### Claude Code 메타 문서 작성 지침

**기능(feature) 단위 원칙:**
- 모든 메타 문서는 기능(feature) 단위로 구성하세요.
- feature명은 도메인/모듈/컴포넌트 단위로 지정하세요 (예: auth, payment, dashboard).
- 동일 기능의 계획과 프롬프트는 동일한 feature명을 사용하세요.

**플랜 문서는 다음 조건 시 반드시 작성:**
- 3단계 이상 복잡한 작업, 다중 파일 변경, 2개 이상 도구 호출이 필요한 경우
- 위치: `<CLAUDE_DOCS_DIR>/plans/<feature>/<계획명>-plan.md`
- 포함 항목: 작업 목표, 단계별 실행 계획, 예상 소요 시간

**프롬프트 문서는 재사용 시 반드시 작성:**
- 2회 이상 재사용되는 시스템 프롬프트, 작업 지시문, 컨텍스트 템플릿
- 위치: `<CLAUDE_DOCS_DIR>/prompts/<feature>/<유형>/<이름>.md`
- 유형: tasks/ (작업용), agents/ (에이전트용)

## 개발 원칙 (사용자 지침)

사용자는 Java 개발자로 캡슐화·단일 책임을 중시합니다. 아래 원칙을 항상 따르세요.

### 함수/컴포넌트 캡슐화 원칙

- **동일 판단 로직은 한 곳에만** — 호출 측에서 `boolean`으로 재계산하지 말고, raw data를 함수에 전달하고 판단은 함수 내부에서 처리
- **기존 렌더링 함수를 반드시 재사용** — 아이콘, 배지, 행(row) 등 UI 요소는 기존 함수를 거치지 않고 직접 HTML 작성 금지

### 웹 대시보드 주요 함수 (누락 방지)

| 함수 | 파일 | 책임 |
|------|------|------|
| `toolIconHtml(toolName, eventType)` | `renderers.js` | 툴 아이콘 렌더링. `eventType='pre_tool'`이면 pulse 애니메이션(`.tool-icon-running`) 자동 적용. **반드시 `r.event_type`을 두 번째 인자로 전달할 것** |
| `makeTargetCell(r)` | `renderers.js` | Target 컬럼 전체 렌더링 (아이콘 + 이름 + 상태배지) |
| `makeRequestRow(r, opts)` | `renderers.js` | 로그 피드 행 렌더링 |
| `prependRequest(r)` | `main.js` | SSE 이벤트로 수신된 레코드를 피드 최상단에 추가. 동일 `id` 행이 있으면 인플레이스 업데이트(위치 보존) |

### pre_tool / post_tool 처리 규칙

- `event_type='pre_tool'`: 툴 실행 시작 — DB에 레코드 생성, SSE 브로드캐스트 **안 함**
- `event_type='tool'`: 툴 실행 완료 — 동일 `tool_use_id`의 pre_tool 레코드를 UPDATE, SSE 브로드캐스트 시 **DB의 실제 id(`pre-xxx`)** 사용
- 조회 쿼리 기본 필터: `event_type IS NULL OR event_type != 'pre_tool' OR tool_name = 'Agent'`
- 통계 쿼리 필터: `event_type IS NULL OR event_type = 'tool'` (`'post_tool'` 아님)
