# 🔭 Spyglass

[English](README.md) | **한국어** | [日本語](README_ja.md) | [简体中文](README_zh.md) | [繁體中文](README_zh-TW.md)

`claude-spyglass`는 Claude Code 세션 내부에서 실제로 무슨 일이 일어나는지 들여다볼 수 있게 해줍니다:

* 숨겨진 시스템 프롬프트 증가
* rule · skill · agent 주입 전파
* 컨텍스트 팽창
* 런타임 이상 징후 (spike · loop · slow)
* 세션 구조와 도구 활동
* 컨텍스트 흐름 그래프 (turn → tool → 메타 문서 관계)
* API 토큰 사용량 · 비용 · 지연 시간

대부분의 Claude 도구가 생산성에 초점을 맞추는 것과 달리, `claude-spyglass`는 **가시성(visibility)**에 집중합니다.

---

## 설치

Spyglass는 두 가지 배포 모드를 지원합니다 — 둘 다 완전히 지원되며 `~/.spyglass/` 상태를 공유합니다.

### 1. Headless 모드 — Homebrew Formula (권장)

Bun standalone 서버 + CLI + 브라우저 대시보드.

```bash
brew tap gmoon92/spyglass
brew install spyglass

# 상시 실행 (로그인 시 자동 시작):
brew services start spyglass
spyglass open

# 또는 수동 모드 (현재 세션에서만):
spyglass start
spyglass open

# 업데이트:
brew upgrade spyglass
```

번들된 바이너리에 Bun 런타임이 내장되어 있어 **시스템에 Bun을 따로 설치할 필요가 없습니다.**

### 2. Local agent 모드 — Electron 앱

같은 백엔드를 dock 인식 셸로 감싼 형태입니다. dock 가시성과 OS 통합이 중요할 때(매일 로컬에서 사용하는 경우) 사용하세요. GitHub Releases에서 DMG를 내려받으세요.

### 제거

```bash
brew uninstall spyglass
rm -rf ~/.spyglass    # 선택 — 로컬 데이터 완전 삭제
```

### 소스에서 빌드 (기여자용)

```bash
git clone https://github.com/gmoon92/claude-spyglass.git
cd claude-spyglass
bun install
bun run dev
```

서버가 실행되면 대시보드에서 **Settings → Integration**을 열고
**"Hook · Proxy 한 번에 설치"**를 클릭하면 hook과 proxy를 한 번에 설정할 수 있습니다.

![Dashboard Settings — Integration tab one-click install](docs/images/settings-integration.png)

---

## 왜 만들었나

어느 날, 팀의 비개발자 한 명이 단 하나의 프롬프트로 갑자기 컨텍스트 사용량 80%에 도달하기 시작했습니다.

프롬프트 자체는 작았습니다.
큰 첨부 파일도 없었습니다.
세션은 거의 비어 있었습니다.

런타임 내부에서 무언가가 바뀐 것입니다.

`claude-spyglass`를 사용해 원인을 추적한 결과:

* rule 문서 약 30개
* 적절한 스코프 메타데이터 없이 실수로 커밋됨
* Claude Code 시스템 프롬프트에 전역으로 주입됨

시스템 프롬프트가 조용히 폭발한 것입니다.

런타임 가시성이 없었다면 근본 원인을 찾기가 극히 어려웠을 것입니다.

---

## spyglass가 보여주는 것

![Dashboard — real-time session feed and token metrics](docs/images/dashboard.png)

### 숨겨진 시스템 프롬프트 증가

rule, CLAUDE.md 파일, hook, 런타임 주입이 실제 프롬프트 크기에 어떤 영향을 주는지 확인합니다.

### 컨텍스트 팽창 원인

어떤 파일이나 런타임 구성 요소가 컨텍스트 예산을 소비하는지 식별합니다.

### 런타임 추적

Hook 경로 — 다음을 들여다봅니다:

* 도구 호출 흐름과 타이밍 (PreToolUse / PostToolUse)
* 세션 구조와 이벤트 순서
* turn 단위 토큰 누적

Proxy 경로 (opt-in) — 다음을 들여다봅니다:

* 전체 API 요청/응답 메타데이터
* input / output / cache 토큰과 추정 비용
* 초당 토큰 수(TPS)와 첫 토큰까지의 시간(TTFT)
* 시스템 프롬프트 내용과 해시

### 컨텍스트 흐름 그래프

세션이 단순한 평면 로그가 아니라 관계의 그래프로 어떻게 펼쳐지는지 봅니다.
turn → 도구 호출 → 메타 문서 간선이 백그라운드 sync worker에 의해 SQLite에서
로컬 임베디드 Ladybug 그래프로 스트리밍되므로, 대시보드는 조상/자손 흐름,
hot path, 그리고 특정 도구 호출이 어떤 rule이나 agent를 끌어들였는지 보여줄 수 있습니다.

### Behavior definition 카탈로그

세션에서 어떤 agent, skill, command가 활성화되어 있는지 파악합니다.
Spyglass는 프로젝트 체인과 전역 `~/.claude` 전반에서 `.claude/agents`, `.claude/skills`,
`.claude/commands`를 스캔하고, 우선순위를 해석하여, 워크스페이스별 유효 카탈로그를 보여줍니다.

![Meta-docs catalog — agents, skills, and commands per workspace](docs/images/meta-docs-catalog.png)

### Rule 전파

CLAUDE.md 파일과 rule이 세션 전반에 어떻게 주입되고 전파되는지 파악합니다.
각 프로젝트에서 어떤 rule이 활성화되어 있고 어디서 비롯됐는지 확인합니다.

### 런타임 이상 탐지

세 가지 범주의 런타임 이상을 탐지합니다:

* **spike** — 프롬프트 입력 토큰이 세션 평균의 200%를 초과
* **loop** — 같은 도구가 한 turn 안에서 연속 3회 이상 호출됨
* **slow** — 도구 호출 시간이 전체 호출의 P95 임계값을 초과

---

## 설계 원칙: Local-first

`claude-spyglass`는 전적으로 사용자의 머신에서 동작합니다.

호스팅 백엔드 없음.
원격 텔레메트리 없음.
프롬프트 업로드 없음.

사용자의:

* 프롬프트
* 소스 코드
* 내부 rule
* 세션 산출물
* 런타임 메타데이터

는 결코 로컬 환경을 벗어나지 않습니다.

---

## 동작 방식

`claude-spyglass`는 두 개의 독립적인 경로를 통해 Claude Code로부터 런타임 데이터를 수집합니다.

**Hook 경로** (항상 활성): Claude Code는 등록된 hook을 통해 각 turn마다 이벤트를 발생시킵니다.
hook 스크립트가 raw 페이로드를 로컬 서버로 보내면, 서버가 이를 정규화하여 저장합니다.

**Proxy 경로** (opt-in): `ANTHROPIC_BASE_URL`을 로컬 서버로 향하게 하면
모든 API 트래픽이 가로채집니다. 이를 통해 전체 요청/응답 캡처, TPS, TTFT가 활성화됩니다.

두 경로 모두 같은 로컬 SQLite 데이터베이스에 기록합니다. 업데이트는 SSE(`GET /events`)를 통해
클라이언트로 스트리밍되며, 백그라운드 sync worker가 데이터를 Ladybug 그래프로 투영합니다.

```text
── Hook Path (always on) ──────────────────────────────
Claude Code CLI
  →  spyglass-collect.sh
        →  POST /collect   (UserPromptSubmit · Pre/PostToolUse)
        →  POST /events    (SessionStart · Stop · SessionEnd · …)
── Proxy Path (opt-in) ────────────────────────────────
Claude Code CLI  →  Spyglass Server :9999/v1/*  →  Anthropic API
── Storage & streaming ────────────────────────────────
both paths  →  ~/.spyglass/spyglass.db (SQLite)
            →  SSE  GET /events                (live dashboard push)
            →  graph sync worker  →  Ladybug context-flow graph
```

이를 통해 다음이 가능해집니다:

* 런타임 추적
* 프롬프트 검사
* 컨텍스트 분석
* 토큰 및 지연 시간 텔레메트리
* 메타 문서 카탈로그 (rule, skill, CLAUDE.md)
* 런타임 diffing

---

## 아키텍처

![Claude Spyglass Architecture — Hook Path + Proxy Path with Storage, Meta-docs Catalog, Metrics & Analysis, SSE/REST channels, and Web/TUI clients](docs/architecture/images/architecture.png)

---

## 활용 사례

* 갑작스러운 컨텍스트 팽창 조사
* 숨겨진 프롬프트 및 rule 주입 이해
* Claude Code 런타임 동작 디버깅
* 워크스페이스별 활성 agent, skill, command 감사
* 세션 구조와 도구 호출 패턴 분석
* 실제 API 비용과 토큰 소모율 측정
* 프롬프트 spike, 도구 loop, slow 호출 탐지
* 팀 단위 Claude Code 거버넌스

---

## 철학

AI 코딩 어시스턴트는 점점 더 복잡한 런타임 시스템이 되어가고 있습니다.

하지만 그 동작의 대부분은 여전히 보이지 않습니다.

`claude-spyglass`는 Claude Code를 관측 가능하게(observable) 만들기 위해 존재합니다.
