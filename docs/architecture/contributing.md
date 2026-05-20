# Claude Spyglass 기여 가이드

Claude Spyglass 프로젝트에 기여해 주셔서 감사합니다. 이 문서는 코드·문서·디자인·DB 스키마 등 어떤 형태로든 기여하려는 분들을 위한 안내서입니다.

Claude Spyglass 는 **Claude Code 의 훅 이벤트를 수집해 토큰 사용량과 요청 흐름을 시각화**하는 모니터링 도구입니다.
**bun workspaces 모노레포**(`server`/`storage`/`tui`/`types`/`web`) 위에 **TypeScript + React Ink (TUI) + Vanilla JS (Web)** 스택과 **SQLite WAL** 저장소를 사용합니다.
`.claude/` 메타 문서로 자동화된 워크플로우를 갖추고 있습니다.

---

## 30초 안에 첫 PR 보내는 법

빠르게 시작하려면 다음 6단계만 따르세요. 자세한 내용은 아래 본문 섹션을 참조하세요.

```bash
# 1. Fork 후 clone
git clone https://github.com/<your-id>/claude-spyglass.git && cd claude-spyglass

# 2. 의존성 설치 (prepare 훅이 자동 등록됨)
bun install

# 3. 환경 점검
bun run doctor

# 4. 기능 브랜치 생성
git checkout -b feat/<short-name>

# 5. 변경 후 검증
bun test && bun run typecheck

# 6. 커밋·PR — Claude Code 안에서는 commit 스킬 사용
#    git commit -m "feat(scope): 설명"
```

> **Tip** — UI/UX 변경은 반드시 `designer` 서브에이전트에 위임하세요 ([§8](#8-uiux-변경)).
> DB 스키마 변경은 `data-analyst` 스킬을 통해 진행하세요 ([§7](#7-db-변경-마이그레이션-추가)).
> 머지 전에 [PR 체크리스트](#12-pr-체크리스트)를 반드시 확인하세요.

---

## 목차

1. [시작하기](#1-시작하기)
2. [개발 환경](#2-개발-환경)
3. [모노레포 작업](#3-모노레포-작업)
4. [코드 스타일](#4-코드-스타일)
5. [테스트](#5-테스트)
6. [타입 체크](#6-타입-체크)
7. [DB 변경 (마이그레이션 추가)](#7-db-변경-마이그레이션-추가)
8. [UI/UX 변경](#8-uiux-변경)
9. [문서 작업](#9-문서-작업)
10. [커밋과 Pull Request](#10-커밋과-pull-request)
11. [Claude Code 스킬·에이전트 카탈로그](#11-claude-code-스킬에이전트-카탈로그)
12. [PR 체크리스트](#12-pr-체크리스트)

---

## 1. 시작하기

### 1.1 저장소 Fork & Clone

GitHub 에서 본 저장소를 Fork 한 뒤, 본인 fork 를 clone 하고 upstream 을 등록합니다.

```bash
git clone https://github.com/<your-id>/claude-spyglass.git
cd claude-spyglass
git remote add upstream https://github.com/<원본-소유자>/claude-spyglass.git
```

### 1.2 의존성 설치 & 훅 등록

```bash
bun install
```

`bun install` 직후 `package.json`의 `prepare` 스크립트가 자동 실행되어 `git config core.hooksPath .githooks` 가 적용됩니다.
이로써 `post-push` 훅이 등록됩니다.
`packages/**` 또는 `hooks/**` 변경을 푸시한 직후 `claude -p` 가 호출되어 `docs/architecture.md` / `README.md` 가 자동 현행화됩니다.
자세한 동작은 [`.githooks/post-push`](../.githooks/post-push) 를 참조하세요.

`prepare` 가 실행되지 않은 환경에서는 `bun run prepare` 를 수동 실행하세요.
CI 등 훅이 불필요한 곳은 `git config --unset core.hooksPath` 로 해제합니다.

### 1.3 첫 실행

```bash
bun run doctor   # 환경·DB·서버 무결성 점검
bun start        # 서버 데몬 기동
bun run tui      # TUI 대시보드
# 웹 대시보드: http://localhost:18080 (기본)
```

서버가 떠 있는 상태에서 Claude Code 세션을 한 번 실행해 데이터를 적재하면 실제 데이터로 UI를 확인할 수 있습니다.

---

## 2. 개발 환경

### 2.1 런타임 요구사항

| 항목 | 버전 |
|------|------|
| **Bun** | `>=1.2.0` (`package.json#engines.bun`) |
| **Node.js** | LTS 20+ (도구·에디터 호환용; 실행은 Bun 권장) |
| **TypeScript** | `^5.0.0` (`tsc --noEmit`) |
| **SQLite** | 시스템 기본 (`~/.spyglass/spyglass.db` WAL) |
| **Claude Code CLI** | 최신 (post-push 자동 문서 현행화에 필요, 선택) |

### 2.2 권장 IDE 설정

**VS Code**
- *Biome*, *Bun for Visual Studio Code*, *vscode-styled-components* 확장 설치
- `"typescript.tsdk": "node_modules/typescript/lib"` 권장
- TUI 디버깅은 루트 의존성으로 포함된 `react-devtools-core` 활용

**IntelliJ IDEA / WebStorm**
- *Bun* 플러그인 설치 후 Runner 를 Bun 으로 지정
- *Languages & Frameworks → JavaScript → Code Quality Tools → Biome* 활성화
- `tsconfig.json` 의 `jsx = "react-jsx"` 에 맞춰 JSX 인식 활성화

### 2.3 데이터 디렉터리

런타임 데이터는 `~/.spyglass/` 하위에 저장됩니다.

| 파일/디렉터리 | 용도 |
|---------------|------|
| `spyglass.db` (WAL) | SQLite 메인 DB |
| `spyglass.db-wal`, `spyglass.db-shm` | WAL 모드 사이드카 파일 |
| `timing/{session_id}` | PreToolUse 타임스탬프 |
| `hook-raw.jsonl` | 디버깅용 raw 이벤트 |
| `spyglass.log`, `spyglass.pid` | 데몬 로그·PID |

DB 를 초기화하려면 `~/.spyglass/` 를 통째로 지우세요.
통계 테이블만 재구성하려면 `bun run rebuild-stats` 또는 `bun run rebuild-stats-proxy` 를 실행합니다.

---

## 3. 모노레포 작업

### 3.1 워크스페이스 구조

루트 `package.json` 의 `workspaces: ["packages/*"]` 설정으로 5개 패키지가 등록되어 있습니다.

| 패키지 | 이름 | 책임 |
|--------|------|------|
| `packages/server` | `@spyglass/server` | HTTP API · SSE · CLI · 훅 수집 엔드포인트 |
| `packages/storage` | `@spyglass/storage` | SQLite 스키마·마이그레이션·쿼리·통계 |
| `packages/tui` | `@spyglass/tui` | React Ink 기반 터미널 대시보드 |
| `packages/types` | `@spyglass/types` | 공용 도메인 타입 |
| `packages/web` | (private) | Vanilla JS 웹 대시보드 자산 |

각 패키지는 `"@spyglass/<name>": "workspace:*"` 프로토콜로 서로를 참조합니다.

### 3.2 패키지 추가하기

1. `packages/<new-pkg>/` 디렉터리 생성 (**kebab-case**).
2. `package.json` 작성 — `name: "@spyglass/<name>"`, `type: "module"`, `main`, `exports` 필수.
3. 다른 패키지에서 참조한다면 해당 패키지의 `package.json` 에 `"@spyglass/<new-pkg>": "workspace:*"` 등록.
4. 루트에서 `bun install` 을 재실행해 심볼릭 링크 갱신.

### 3.3 패키지 간 의존성 원칙

- **types → storage → server → tui/web** 단방향 의존.
- `storage` 가 `server` 를 import 하면 안 됨 (순환 차단).
- 공통 타입은 반드시 `@spyglass/types` 에 두고 양쪽에서 import.

### 3.4 공통 스크립트

루트에서 실행 가능한 명령(모두 `bun run <name>`):

| 명령 | 동작 |
|------|------|
| `start` / `dev` / `stop` / `status` | 서버 데몬 라이프사이클 |
| `doctor` | 환경·DB·서버 무결성 점검 (CLI) |
| `tui` | TUI 실행 |
| `test` | `bun test` (모든 패키지 테스트 일괄) |
| `typecheck` | `tsc --noEmit` (전체 모노레포) |
| `backfill:system-prompts` | 과거 세션 system_prompt 백필 |
| `rebuild-stats`, `rebuild-stats-proxy` | 집계 테이블 재계산 |

---

## 4. 코드 스타일

`CLAUDE.md` 의 개발 원칙을 그대로 따릅니다. 핵심 원칙은 다음과 같습니다.

### 4.1 파일·디렉터리 명명 (kebab-case)

> 모든 디렉토리명과 파일명은 **kebab-case**로 작성하세요. — `CLAUDE.md`

예: `tool-row-alignment.test.ts`, `cache-panel-tooltip.js`, `data-analyst/`. React 컴포넌트 파일도 `kebab-case.tsx` (PascalCase 컴포넌트명은 파일 내부에서만). 마이그레이션은 `NNN-<설명>.sql` (예: `021-add-thinking-mode.sql`).

### 4.2 캡슐화 · 단일 책임 (Java식 사고)

> 사용자는 Java 개발자로 캡슐화·단일 책임을 중시합니다. — `CLAUDE.md`

#### 원칙 1. 동일 판단 로직은 한 곳에만

호출 측에서 `boolean` 을 재계산하지 말고, **raw data 를 함수에 전달**하고 판단은 함수 내부에서 처리합니다.

```ts
// ❌ Bad — 호출 측에서 boolean 을 미리 계산
//         같은 판단이 여러 호출 지점에 분산되어 버그 위험
const isRunning = r.event_type === 'pre_tool';
const html = toolIconHtml(r.tool_name, isRunning);
```

```ts
// ✅ Good — raw event_type 을 그대로 전달
//          판단 로직은 toolIconHtml 내부 한 곳에만 존재
const html = toolIconHtml(r.tool_name, r.event_type);
```

#### 원칙 2. 기존 렌더링 함수를 반드시 재사용

아이콘·배지·행 등 UI 요소는 직접 HTML 을 작성하지 말고 기존 함수를 거칩니다.

```js
// ❌ Bad — innerHTML 직접 작성, 아이콘·배지 로직이 분산됨
row.innerHTML = `<td><svg>...</svg> ${r.tool_name}</td>`;
```

```js
// ✅ Good — 기존 함수 재사용, 변경 시 한 곳만 수정
row.appendChild(makeRequestRow(r));
```

### 4.3 웹 대시보드 핵심 함수 (직접 작성 금지)

다음은 `CLAUDE.md` 가 "누락 방지" 함수로 지정한 것들입니다 — 모든 UI 요소는 이 함수들을 거쳐야 하며, 페이지 코드에서 `innerHTML = '<svg …>'` 같은 직접 HTML 작성은 금지입니다.

| 함수 | 파일 | 책임 |
|------|------|------|
| `toolIconHtml(toolName, eventType)` | `packages/web/assets/js/renderers.js` | 툴 아이콘 + pulse(`pre_tool` 시 `.tool-icon-running`). **`r.event_type` 을 두 번째 인자로 반드시 전달** |
| `makeTargetCell(r)` | `renderers.js` | Target 컬럼 전체(아이콘 + 이름 + 상태배지) |
| `makeRequestRow(r, opts)` | `renderers.js` | 로그 피드 행 |
| `prependRequest(r)` | `packages/web/assets/js/main.js` | SSE 수신 레코드를 피드 상단에 prepend, 동일 `id` 는 인플레이스 업데이트 |

### 4.4 pre_tool / post_tool 이벤트 규칙

수집 훅과 SSE 처리는 다음 규칙을 깨면 안 됩니다.

| 이벤트 | 동작 | SSE |
|--------|------|-----|
| `pre_tool` | DB 레코드 생성 | **브로드캐스트 안 함** |
| `tool` | 동일 `tool_use_id` 의 pre_tool 레코드를 UPDATE | DB 의 실제 id (`pre-xxx`) 사용 |

쿼리 필터 규칙:

| 쿼리 종류 | 필터 |
|-----------|------|
| 조회 쿼리 | `event_type IS NULL OR event_type != 'pre_tool' OR tool_name = 'Agent'` |
| 통계 쿼리 | `event_type IS NULL OR event_type = 'tool'` (`'post_tool'` 아님) |

### 4.5 TypeScript · LSP 일반 규칙

- `tsconfig.json` 은 `strict: true`. 새 코드는 모두 strict 통과. `any` 금지(불가피하면 주석으로 사유 명시).
- `import type { ... }` 적극 활용. 외부 export 에는 JSDoc `@description` 한 줄 권장.
- 코드 탐색은 grep 보다 LSP("Find references", "Go to definition")를 우선 사용합니다 (`CLAUDE.md`).

---

## 5. 테스트

### 5.1 테스트 실행

```bash
# 모든 패키지 테스트
bun test

# 특정 패키지만
cd packages/storage && bun test
cd packages/server  && bun test
cd packages/tui     && bun test

# 단일 파일
bun test packages/storage/src/__tests__/request.test.ts

# 패턴 매칭
bun test --test-name-pattern="rebuild stats"
```

### 5.2 테스트 위치

모든 단위 테스트는 각 패키지의 `src/__tests__/` 디렉터리에 두며, 파일명은 `<대상>.test.ts` 형식입니다.

- `packages/server/src/__tests__/` — `server.test.ts`(라이프사이클·라우터), `collect.test.ts`(훅 수집), `requests-filter.test.ts`, `sse-payload.test.ts`
- `packages/storage/src/__tests__/` — `connection.test.ts`, `request.test.ts`, `session.test.ts`, `stats-integration.test.ts`, `*-regression.test.ts`, `proxy-stats.test.ts` 등 다수
- `packages/tui/src/__tests__/` — `tool-row-alignment.test.ts`, `detect-lang.test.ts`
- `packages/web/assets/js/__tests__/` — `renderers.test.ts`(스냅샷 포함), `formatters.test.ts` 등

### 5.3 새 테스트 추가 패턴

`bun:test` API 를 사용합니다. 표준 패턴:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SpyglassDatabase, closeDatabase } from '../index';

const TEST_DB_PATH = `/tmp/spyglass-my-feature-${Date.now()}.db`;

describe('My Feature', () => {
  let db: SpyglassDatabase;
  beforeEach(() => { db = new SpyglassDatabase({ dbPath: TEST_DB_PATH, autoInit: true }); });
  afterEach(() => {
    closeDatabase();
    try { require('fs').unlinkSync(TEST_DB_PATH); } catch {}
  });
  it('should …', () => { /* 준비 → 실행 → expect */ });
});
```

가이드라인:

- DB가 필요한 테스트는 `/tmp/spyglass-*-${Date.now()}.db` 로 격리. `closeDatabase()` + `unlinkSync` 로 정리.
- TUI 테스트는 `ink-testing-library` 의 `render()` 결과를 검증.
- Web 스냅샷이 변경되면 의도적 변경인지 PR 설명에 명시.

### 5.4 통합·회귀 테스트 컨벤션

- `*-integration.test.ts` — 여러 모듈을 함께 검증.
- `*-regression.test.ts` — 한 번 잘못 동작했던 케이스의 영구 잠금장치.
- **버그 수정에는 회귀 테스트 한 개 이상 추가**가 원칙입니다.

---

## 6. 타입 체크

```bash
bun run typecheck     # tsc --noEmit (전체 워크스페이스)
```

루트 `tsconfig.json` 의 `include: ["packages/**/*", "scripts/**/*"]` 가 모든 패키지를 일괄 검사합니다.
`strict: true` 이므로 implicit any, 미사용 변수, null·undefined 처리 누락은 빌드 실패입니다.
패키지별 별도 `tsconfig.json` (예: `packages/tui/tsconfig.json`) 이 있으면 그 설정이 우선됩니다.

> **PR 머지 전 반드시** `bun run typecheck` + `bun test` 가 모두 깨끗하게 통과해야 합니다.

---

## 7. DB 변경 (마이그레이션 추가)

DB 스키마·쿼리·집계·훅 데이터 흐름 변경은 모두 **`data-analyst` 스킬** 의 워크플로우를 따릅니다.

> "데이터 분석", "테이블 추가", "컬럼 추가", "쿼리 최적화", "스키마 변경",
> "마이그레이션 추가", "통계 개선" 등의 요청은 반드시 `data-analyst` 스킬을 사용합니다. — `CLAUDE.md`

### 7.1 마이그레이션 번호 규칙

`packages/storage/migrations/` 는 `001-init.sql`, `002-add-tool-detail.sql`, … `020-payload-audit-fields.sql` 처럼 SQL 시퀀스로 관리됩니다.

| 규칙 | 내용 |
|------|------|
| 번호 | 정확히 +1 — 건너뛰면 `data-engineer` Success Criteria 위반 |
| 파일명 | `NNN-<kebab-case-설명>.sql` (3자리 zero-padded) |
| SQL | **idempotent** — `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` 등 |

### 7.2 마이그레이션 추가 절차

다음 6단계를 순서대로 진행합니다.

1. **SQL 파일 생성** — `packages/storage/migrations/NNN-<설명>.sql` 작성 (`migrator.ts` 가 자동 로드).
2. **쿼리 업데이트** — 영향받는 쿼리 파일(`packages/storage/src/queries/**`) 수정.
3. **회귀 테스트 추가** — 새 컬럼/테이블이 기존 통계 쿼리에 영향을 주지 않는지 검증.
4. **로컬 검증** — `~/.spyglass/spyglass.db` 를 백업한 뒤 `bun start` → 마이그레이션 적용 확인.
5. **집계 재계산 검증** — `bun run rebuild-stats` / `rebuild-stats-proxy` 가 깨지지 않는지 확인.
6. **문서 동기화** — `docs/architecture.md` 의 테이블 목록은 push 시 `post-push` 훅이 자동 현행화. 훅이 없는 환경이면 `doc-spec` 스킬로 수동 갱신.

### 7.3 훅 수집 스크립트 변경

훅 수집 스크립트 `hooks/spyglass-collect.sh` 와 `.claude/settings.json` 의 훅 등록은 한 세트로 묶여 있습니다.
이벤트 종류·페이로드를 변경할 때는 아래 다섯 곳을 모두 갱신해야 합니다.

1. `hooks/spyglass-collect.sh` — 수집 로직
2. `.claude/settings.json` — 훅 등록
3. `packages/server/src/hook/` — 수신·파싱
4. `packages/storage/src/schema.ts` + 새 마이그레이션 — 저장 스키마
5. `packages/server/src/__tests__/collect.test.ts` — 회귀 테스트

---

## 8. UI/UX 변경

### 8.1 강제 규칙: `designer` 서브에이전트에 위임

> ## ⚠️ 강제 규칙
>
> **디자인·UI/UX 작업은 반드시 `designer` 서브에이전트에 위임하세요.**
>
> CSS, 레이아웃, 툴팁, 컴포넌트 스타일, 색상 등 **화면에 관련된 모든 작업**이 해당됩니다.
> 메인 세션에서 직접 CSS·JSX 를 작성하지 마세요. (`CLAUDE.md`)
>
> 사람이 직접 작업하더라도 아래 8.2 의 4단계 절차를 그대로 거쳐야 합니다.

### 8.2 디자인 작업 표준 절차

`designer` 에이전트는 다음 4단계를 **순서대로** 호출합니다.

```
1. doc-planning  →  plan.md     (목표·범위 정의)
2. doc-adr       →  adr.md      (기술 결정 기록)
3. doc-tasks     →  tasks.md    (작업 분해)
4. ui-designer   →  Phase 1~5   (실제 구현)
```

> **3개 문서(plan / adr / tasks)가 완성된 후에만** 4단계 구현을 진행합니다.

### 8.3 디자인 토큰 · 변수 사용

- CSS 변수 외 **하드코딩 색상 금지** (`#abc123` 직접 입력 금지).
- 토큰 위치
  - Web: `packages/web/assets/css/` (`--color-*`, `--space-*`)
  - TUI: `packages/tui/src/design-tokens.ts`
- 화면 카탈로그는 화면 추가·변경 시 **반드시 현행화**.
  - `packages/web/screen-inventory.md`
  - `packages/tui/screen-inventory.md`

### 8.4 TUI 작업 시 주의

Ink 컴포넌트는 `packages/tui/src/components/` 와 `screens/` 로 분리되어 있습니다.
키바인딩을 변경할 때는 `HelpOverlay.tsx` 도 함께 업데이트하세요.
`bun run tui` 로 직접 띄워 검증한 뒤 `ink-testing-library` 로 스냅샷 테스트를 추가합니다.

---

## 9. 문서 작업

### 9.1 문서 트리

```
docs/                              ← 사용자·외부 대상 문서
├── architecture.md                ← post-push 훅이 자동 현행화 (doc-spec)
├── index.md, install-guide.md, …
├── examples/, schema/             ← 사용 예시, DB 스키마 다이어그램
└── planning/                      ← 초기 개발 레거시 (수정 금지)

.claude/                           ← Claude Code 메타 (자동화)
├── docs/
│   ├── plans/<feature>/{plan,adr,tasks}.md
│   ├── research/                  ← 기술 조사·비교
│   ├── evaluation/                ← 스킬 평가
│   └── prompts/<feature>/{tasks,agents}/<이름>.md
├── skills/                        ← 사용 가능한 스킬
├── agents/                        ← 사용 가능한 서브에이전트
└── settings.json                  ← 훅 등록·권한 설정
```

### 9.2 어떤 문서를 어디에 쓰는가

| 문서 종류 | 위치 | 스킬 |
|-----------|------|-----------|
| 아키텍처(전체) | `docs/architecture.md` | `doc-spec` |
| 기능별 plan | `.claude/docs/plans/<feature>/plan.md` | `doc-planning` |
| 기능별 ADR | `.claude/docs/plans/<feature>/adr.md` | `doc-adr` |
| 기능별 tasks | `.claude/docs/plans/<feature>/tasks.md` | `doc-tasks` |
| 재사용 프롬프트 | `.claude/docs/prompts/<feature>/{tasks,agents}/<이름>.md` | (수동) |

> `docs/planning/` 은 초기 개발 레거시 — **수정 금지**. 새 ADR 은 `.claude/docs/plans/<feature>/adr.md` 에 작성합니다.

### 9.3 작성 트리거 (`CLAUDE.md` 인용)

- **plan 문서 필수**: 3단계 이상 복잡 작업 / 다중 파일 변경 / 2개 이상 도구 호출.
- **prompts 문서 필수**: 2회 이상 재사용되는 시스템 프롬프트·작업 지시문·컨텍스트 템플릿.
- **feature 명**: 도메인/모듈/컴포넌트 단위(예: `auth`, `dashboard`, `cache-panel`) — 동일 기능의 plan/adr/tasks/prompts 는 같은 이름을 공유.

### 9.4 자동 문서 현행화 (post-push)

`packages/**` 또는 `hooks/**` 변경을 push 하면 `.githooks/post-push` 가 동작합니다.
변경 diff (최대 200줄) 와 `.githooks/doc-sync-prompt.md` 를 `claude -p --dangerously-skip-permissions` 로 실행합니다.
`docs/architecture.md` / `README.md` 가 수정되면 `[skip-doc-sync]` 마커를 포함한 커밋·푸시가 자동 수행됩니다 (재귀 차단용).

> 자동화 대상은 위 두 파일로 한정됩니다.
> 기능별 ADR / plan / tasks 는 `doc-*` 스킬로 수동 관리하세요.

---

## 10. 커밋과 Pull Request

### 10.1 커밋은 항상 `commit` 스킬

> 모든 Git 커밋 요청은 `commit` 스킬을 사용하세요. — `CLAUDE.md`

Claude Code 안에서는 `Skill("commit")` 으로 위임합니다. 스킬이 다음 규칙으로 자동 분리합니다.

| 규칙 | 내용 |
|------|------|
| **Tidy First** | `refactor` 와 `feat`/`fix` 는 같은 커밋에 섞지 않음 (개발 소스 한정) |
| **커밋 순서** | `.claude/` 설정 → `refactor` → `feat`/`fix` → `docs` → `chore` |
| **스테이징 없이 커밋** | `git add` 대신 `git commit <path> -m …` 사용 |
| **메시지 언어** | 기본 **한국어** |

### 10.2 커밋 메시지 형식 (Conventional Commits)

```
<type>(<scope>): <description>

- <body item>
- <body item>
```

- **type**: `feat` | `fix` | `refactor` | `docs` | `test` | `style` | `chore`
- **description**: 동사·소문자 시작, 마침표 금지, 50자 이내.
- **body**: `-` 기호 사용, 최대 5개, 항목 사이 개행 금지.

예시:

```
feat(cache-donut): 캐시 비율 도넛에 호버 툴팁 추가

- read/creation 슬라이스에 마우스 오버 시 raw 토큰 표시
- 색상은 --color-cache-* 변수만 사용
- 회귀 테스트 추가 (cache-panel.test.ts)
```

### 10.3 브랜치 전략

- 기본 브랜치: `main`
- 기능 브랜치: `feat/<feature>`, `fix/<scope>-<요약>`, `docs/<scope>` 형태 권장
- 장기 작업은 `.claude/worktrees/` 의 git worktree 를 활용하면 main 과 격리됩니다.

### 10.4 .githooks 동작 요약

`post-push` 훅은 `git push` 직후 `packages/**` 또는 `hooks/**` 변경이 감지되면 `docs/architecture.md` · `README.md` 를 자동 현행화합니다.

- 재귀 방지 마커: `[skip-doc-sync]`
- 일시 비활성화: `git -c core.hooksPath=/dev/null push`

### 10.5 Pull Request 절차

1. fork 의 feature 브랜치를 push.
2. PR 생성. 제목은 한국어 커밋 메시지와 동일 톤(50자 이내).
3. 본문에 **변경 요약(3~5줄)**, **동기/컨텍스트**, **테스트 결과**(`bun test`, `bun run typecheck`), **스크린샷/녹화**(UI 변경 시), **연관 ADR/plan 링크**(예: `.claude/docs/plans/cache-panel/adr.md`)를 포함.
4. 본문 끝에 [PR 체크리스트](#12-pr-체크리스트)를 복사·체크.
5. 머지 방식은 **squash merge** 권장(커밋 그래프 단순화).

---

## 11. Claude Code 스킬·에이전트 카탈로그

이 저장소는 `.claude/skills/` 와 `.claude/agents/` 에 기여 워크플로우를 자동화하는 스킬·에이전트를 두고 있습니다. **각 요청 유형에 매핑된 스킬을 그대로 따르는 것이 권장 절차**입니다.

### 11.1 스킬 (`.claude/skills/`)

| 스킬 | 트리거 | 책임 |
|------|---------------|-----------|
| `commit` | "커밋해줘" | Conventional Commits + Tidy First 로 자동 분리 커밋 |
| `doc-planning` | "plan 문서" | feature 단위 `plan.md` 작성 |
| `doc-adr` | "ADR 추가" | feature 단위 `adr.md` 작성 |
| `doc-tasks` | "Task 완료" | feature 단위 `tasks.md` + JSON 인덱스 |
| `doc-spec` | "아키텍처 문서" | `docs/architecture.md` 현행화 |
| `dev-orchestrator` | "전문가 회의" | plan → ADR → tasks → 실행 전체 조율 |
| `dev-verify` | "검증해줘" | dev-orchestrator 결과를 코드/Playwright 검증 |
| `data-analyst` | "테이블 추가", "마이그레이션" | SQLite 스키마·집계·훅 데이터 흐름 |
| `ui-designer` | "디자인", "UI", "화면" 등 | UI/UX 디자이너 (4단계 워크플로우 강제) |
| `cc-docs-refactor` | "SKILL.md 수정" | Claude Code 메타 문서 리팩터링 |

### 11.2 서브에이전트 (`.claude/agents/`)

| 에이전트 | 위임 스킬 | 담당 |
|----------|-----------|------|
| `data-engineer` | `data-analyst` | DB·마이그레이션·쿼리·훅 스크립트 (Web/TUI 디자인 ✗) |
| `designer` | `doc-planning` → `doc-adr` → `doc-tasks` → `ui-designer` | 모든 UI/UX (DB·서버 API ✗) |

### 11.3 매핑 가이드 (요청 유형 → 권장 워크플로우)

| 작업 유형 | 권장 흐름 |
|-----------|-----------|
| 새 컬럼/테이블 추가 | `data-engineer` 에이전트 → `data-analyst` Phase 1~5 |
| 통계 쿼리 개선 | `data-analyst` 스킬 단독 |
| 새 화면/패널 추가 | `designer` 에이전트 → doc-planning → doc-adr → doc-tasks → ui-designer |
| 메타 문서 정리 | `cc-docs-refactor` 스킬 |
| 일반 기능 개발 | 복잡도 ≥ 3 → `dev-orchestrator` / 단순 → `doc-planning` + 직접 구현 |
| 기능 검증 | 구현 후 `dev-verify` 스킬 |
| 커밋 | 모든 경우 `commit` 스킬 |

### 11.4 `sequential-thinking` MCP

> 검토 요청이나 상세 분석 요청에는 반드시 **`sequential-thinking` MCP** 를 사용해 체계적으로 분석합니다 (`CLAUDE.md`). 리뷰·심층 분석성 요청은 `mcp__sequential-thinking__sequentialthinking` 도구를 우선 호출하세요.

---

## 12. PR 체크리스트

PR 을 열기 전에 항목을 확인하세요. **아래 코드 블록을 그대로 복사해 PR 본문 끝에 붙여넣으면 GitHub 에서 체크박스로 렌더링됩니다.**

### 12.1 미리보기 (렌더링된 모습)

**코드**

- [ ] 파일·디렉터리명이 모두 kebab-case
- [ ] 호출 측에서 boolean 재계산 없음 (raw data 전달, 판단은 함수 내부)
- [ ] 기존 렌더링 함수 (`toolIconHtml` / `makeTargetCell` / `makeRequestRow` / `prependRequest`) 재사용
- [ ] `event_type` (`pre_tool` / `tool`) 처리 규칙 준수
- [ ] (UI) 하드코딩 색상 없이 디자인 토큰만 사용

**테스트 · 타입**

- [ ] `bun test` 통과
- [ ] `bun run typecheck` 통과
- [ ] 새 기능에 단위 테스트 추가
- [ ] 버그 수정에 회귀 테스트 (`*-regression.test.ts`) 추가

**DB / 데이터 (해당 시)**

- [ ] 마이그레이션 번호가 정확히 +1
- [ ] 새 SQL 이 idempotent (`IF NOT EXISTS` 등)
- [ ] 영향받는 쿼리·집계 테이블 재계산 검증
- [ ] `data-analyst` 스킬 Phase 1~5 수행

**UI / UX (해당 시)**

- [ ] `designer` 서브에이전트 (또는 동일 절차) 사용
- [ ] `doc-planning` → `doc-adr` → `doc-tasks` 3종 문서 존재
- [ ] 해당 플랫폼의 `screen-inventory.md` 현행화

**문서**

- [ ] `docs/architecture.md` 영향 영역이 정확함 (post-push 신뢰 가능)
- [ ] 새 메타 문서가 feature 명 컨벤션 준수
- [ ] `docs/planning/` 레거시 건드리지 않음

**커밋 · PR**

- [ ] `commit` 스킬 사용 또는 동일 규칙으로 분리
- [ ] Conventional Commits 형식 (`<type>(<scope>): <description>`)
- [ ] PR 본문에 요약·동기·테스트 결과·연관 ADR 링크
- [ ] (UI) 스크린샷·녹화 포함

### 12.2 복사용 원본

```markdown
## PR 체크리스트

**코드**
- [ ] 파일·디렉터리명이 모두 kebab-case
- [ ] 호출 측에서 boolean 재계산 없음 (raw data 전달, 판단은 함수 내부)
- [ ] 기존 렌더링 함수(`toolIconHtml` / `makeTargetCell` / `makeRequestRow` / `prependRequest`) 재사용
- [ ] `event_type` (`pre_tool` / `tool`) 처리 규칙 준수
- [ ] (UI) 하드코딩 색상 없이 디자인 토큰만 사용

**테스트 · 타입**
- [ ] `bun test` 통과
- [ ] `bun run typecheck` 통과
- [ ] 새 기능에 단위 테스트 추가
- [ ] 버그 수정에 회귀 테스트(`*-regression.test.ts`) 추가

**DB / 데이터 (해당 시)**
- [ ] 마이그레이션 번호가 정확히 +1
- [ ] 새 SQL 이 idempotent (`IF NOT EXISTS` 등)
- [ ] 영향받는 쿼리/집계 테이블 재계산 검증
- [ ] `data-analyst` 스킬 Phase 1~5 수행

**UI / UX (해당 시)**
- [ ] `designer` 서브에이전트(또는 동일 절차) 사용
- [ ] `doc-planning` → `doc-adr` → `doc-tasks` 3종 문서 존재
- [ ] 해당 플랫폼의 `screen-inventory.md` 현행화

**문서**
- [ ] `docs/architecture.md` 영향 영역이 정확함 (post-push 신뢰 가능)
- [ ] 새 메타 문서가 feature 명 컨벤션 준수
- [ ] `docs/planning/` 레거시 건드리지 않음

**커밋 · PR**
- [ ] `commit` 스킬 사용 또는 동일 규칙으로 분리
- [ ] Conventional Commits 형식 (`<type>(<scope>): <description>`)
- [ ] PR 본문에 요약·동기·테스트 결과·연관 ADR 링크
- [ ] (UI) 스크린샷/녹화 포함
```

---

## 참고 링크

- `CLAUDE.md` — 프로젝트 최상위 개발 원칙
- `docs/architecture.md` — 현행 아키텍처 (자동 현행화)
- `docs/install-guide.md` — 사용자 설치 가이드
- `.claude/skills/` — 사용 가능한 스킬 카탈로그
- `.claude/agents/` — 사용 가능한 서브에이전트 카탈로그
- `.githooks/post-push`, `.githooks/doc-sync-prompt.md` — 자동 문서 현행화 훅

기여 과정에서 막히는 부분이 있다면 PR 초안을 먼저 올리고 댓글로 질문해 주세요.
완벽한 PR 보다, 빠른 피드백 루프가 훨씬 가치 있습니다.
