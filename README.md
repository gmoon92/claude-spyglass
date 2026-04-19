# 🔭 spyglass

**Claude Code 실행 과정 가시화 도구 - 토큰 누수 탐지**

[![Version](https://img.shields.io/badge/version-0.1.0--mvp-blue)](./CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green)]()

Claude Code의 블랙박스를 열어 토큰 누수 지점을 정확히 찾아내는 개발자 도구입니다.

> **AI는 더 이상 블랙박스가 아닙니다.**

---

## ✨ 핵심 가치

| 가치 | 설명 |
|------|------|
| **투명성** | Claude Code의 실행 과정을 실시간으로 가시화 |
| **효율성** | 토큰 낭비 지점을 빠르게 식별하여 개발 비용 절감 |
| **인사이트** | 요청별/스킬별 토큰 사용 패턴 분석 |
| **편의성** | 터미널에서 즉시 확인, 별도 브라우저 불필요 |

---

## 🚀 시작하기

### 필수 조건

- [Bun](https://bun.sh) 1.2.8 이상

### 설치

```bash
# 저장소 클론
git clone <repository-url>
cd spyglass

# 의존성 설치
bun install
```

### 서버 실행

```bash
# 데몬으로 실행 (개발 모드)
bun run dev

# 상태 확인
bun run status

# 서버 종료
bun run stop
```

### TUI 실행

```bash
# 터미널 UI 실행
bun run tui
```

### 훅 설정

spyglass는 Claude Code의 훅을 통해 데이터를 수집합니다. 모든 이벤트는 `hook_event_name` 필드로 자동 분류됩니다.

**수집 경로:**

| 훅 이벤트 | 처리 방식 | 역할 |
|-----------|-----------|------|
| `UserPromptSubmit` | `/collect` | 프롬프트 토큰/세션 집계 |
| `PreToolUse` | 타이밍 파일 저장 | 도구 실행 시간 측정 시작 (`duration_ms`) |
| `PostToolUse` | `/collect` | 도구 결과 + `duration_ms` 계산 후 저장 |
| `SessionStart`, `SessionEnd`, `Stop` | `/events` | raw 이벤트 저장 (`claude_events` 테이블) |

> **`PreToolUse`**: DB에 레코드를 저장하지 않고 `~/.spyglass/timing/{session_id}` 파일에 타임스탬프만 기록합니다. `PostToolUse`가 이 파일을 읽어 경과 시간을 계산합니다.

#### 글로벌 설정 (권장)

모든 프로젝트에서 자동으로 수집되도록 **글로벌 설정**(`~/.claude/settings.json`)을 사용하세요:

```json
{
  "env": {
    "SPYGLASS_DIR": "/절대경로/claude-spyglass"
  },
  "hooks": {
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "PreToolUse":       [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "PostToolUse":      [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "SessionStart":     [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "Stop":             [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}],
    "SessionEnd":       [{"hooks": [{"type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1}]}]
  }
}
```

> **필수**: `SPYGLASS_DIR`을 실제 설치 경로로 변경하세요.  
> **참고**: `type: "command"` 필드가 없으면 Claude Code가 훅을 무시합니다.  
> **프로젝트 구분**: `project_name`은 실행 디렉토리명(`basename $PWD`)으로 자동 설정됩니다. `SPYGLASS_PROJECT` 환경변수로 수동 지정도 가능합니다.

#### 환경변수 설정 (선택)

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `SPYGLASS_DIR` | spyglass 설치 경로 | 필수 |
| `SPYGLASS_HOST` | spyglass 서버 호스트 | `localhost` |
| `SPYGLASS_PORT` | spyglass 서버 포트 | `9999` |
| `SPYGLASS_PROJECT` | 프로젝트명 (수동 지정) | 현재 디렉토리명 |
| `SPYGLASS_TIMEOUT` | HTTP 요청 타임아웃 (초) | `1` |

#### 설치 확인

훅 설정 후 Claude Code를 재시작하고, 다음 명령어로 데이터 수집 여부를 확인하세요:

```bash
# 수집 로그 실시간 확인
tail -f ~/.spyglass/logs/collect.log

# raw 이벤트 로그 확인
tail -f ~/.spyglass/logs/hook-raw.jsonl

# TUI에서 실시간 확인
bun run tui
```

---

## 🖥️ TUI 화면

```
┌─────────────────────────────────────────────────────────────────┐
│ spyglass                          ● LIVE  |  Sessions: 3        │
├─────────────────────────────────────────────────────────────────┤
│ [F1:Live] [F2:History] [F3:Analysis] [F4:Settings]              │
├──────────────┬──────────────────────────────────────────────────┤
│  Sessions    │   🔴 CRITICAL: Token Limit Exceeded              │
│  ├── proj-a  │   Request used 12,456 tokens (>10,000)          │
│  ├── proj-b  │                                                  │
│  └── proj-c  │   Total Tokens: 45.2K                           │
│              │   [████████████████████░░░░░░░░░░] 45%          │
│              │                                                  │
│              │   Active Sessions: 3                             │
│              │   Session Time: 00:15:32                         │
├──────────────┴──────────────────────────────────────────────────┤
│ ↑↓ Navigate | Enter Select | / Search | A Ack | q Quit         │
└─────────────────────────────────────────────────────────────────┘
```

### Command Center Strip

화면 상단 summary strip에서 아래 4개 지표를 실시간으로 확인할 수 있습니다:

| 지표 | 설명 |
|------|------|
| **COST** | 오늘 API 실사용 비용 (USD) — model별 단가 × tokens 계산 |
| **SAVED** | 프롬프트 캐시로 절약한 금액 (USD) |
| **P95** | tool_call 응답시간 P95 (95번째 백분위) |
| **ERR** | tool_call 오류율 (%) |

---

## ⌨️ 키보드 단축키

| 키 | 동작 |
|----|------|
| F1 | Live 탭 (실시간 모니터링) |
| F2 | History 탭 (과거 세션) |
| F3 | Analysis 탭 (통계 분석) |
| F4 | Settings 탭 (설정) |
| ↑/↓ | 목록 이동 |
| ←/→ | 섹션 전환 |
| Enter | 선택/상세보기 |
| / | 검색 |
| A | 알림 확인 |
| q | 종료 |

---

## 🏗️ 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code Session                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────────┐  │
│  │UserPrompt   │ │ PreToolUse  │ │ PostToolUse │ │Session   │  │
│  │Submit 훅    │ │     훅      │ │     훅      │ │Start/End │  │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └────┬─────┘  │
│         └───────────────┼───────────────┼─────────────┘         │
│                         ▼               ▼                        │
│                  ┌─────────────────────────────┐                │
│                  │    spyglass-collect.sh (Bash)│                │
│                  │    async, timeout=1s         │                │
│                  │  PreToolUse → 타이밍 파일 저장│                │
│                  │  PostToolUse → duration_ms 계산│              │
│                  └────────┬────────────┬────────┘                │
└───────────────────────────┼────────────┼────────────────────────┘
                            │            │ HTTP POST
                  타이밍 파일│            ▼
           ~/.spyglass/     │  ┌─────────────────────────────────┐
             timing/        │  │       spyglass Server (Bun)      │
                            │  │  ┌──────────┐  ┌─────────────┐  │
                            └──┤  │ /collect │  │   /events   │  │
                               │  │(토큰/세션)│  │(raw 이벤트) │  │
                               │  └─────┬────┘  └──────┬──────┘  │
                               │        └───────────────┘         │
                               │                ▼                 │
                               │        ┌──────────────┐         │
                               │        │    SQLite     │WAL Mode │
                               │        │  sessions     │         │
                               │        │  requests     │         │
                               │        │  claude_events│         │
                               │        └──────────────┘         │
                               │        ┌─────┐  ┌──────────┐   │
                               │        │REST │  │SSE /GET  │   │
                               │        │API  │  │ events   │   │
                               │        └──────┘  └──────────┘   │
                               └─────────────────────────────────┘
                                              │
                          ┌───────────────────┼───────────────────┐
                          ▼                   ▼                   ▼
                 ┌────────────────┐  ┌────────────────┐  ┌───────────────┐
                 │  TUI (Ink)     │  │ Web Dashboard  │  │  REST Client  │
                 │  Live/History/ │  │ (Vanilla JS)   │  │  (/api/*)     │
                 │  Analysis 탭   │  │  실시간 갱신    │  └───────────────┘
                 └────────────────┘  └────────────────┘
```

---

## 📡 API 엔드포인트

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| POST | `/collect` | UserPromptSubmit/PostToolUse 수집 (토큰 집계) |
| POST | `/events` | raw hook payload 수집 (claude_events 저장) |
| GET | `/events` | SSE 실시간 스트리밍 |
| GET | `/api/sessions` | 세션 목록 |
| GET | `/api/sessions/:id` | 세션 상세 |
| GET | `/api/sessions/active` | 활성 세션 |
| GET | `/api/sessions/:id/events` | 세션별 이벤트 |
| GET | `/api/requests` | 요청 목록 |
| GET | `/api/requests/top` | TOP 토큰 요청 |
| GET | `/api/stats/sessions` | 세션 통계 |
| GET | `/api/stats/requests` | 요청 통계 |
| GET | `/api/stats/projects` | 프로젝트별 통계 |
| GET | `/api/events` | 최근 이벤트 목록 |
| GET | `/api/events/stats` | 이벤트 타입별 통계 |
| GET | `/api/dashboard` | 통합 대시보드 |
| GET | `/health` | 헬스체크 |

---

## 🔔 알림

토큰 사용량이 임계값을 초과하면 시각적 알림이 표시됩니다:

| 레벨 | 조건 | 색상 |
|------|------|------|
| 🟢 정상 | < 5K 토큰 | 녹색 |
| 🟡 주의 | 5K ~ 10K 토큰 | 노란색 |
| 🔴 경고 | > 10K 토큰 | 빨간색 |

---

## 🛠️ 기술 스택

| 구성요소 | 기술 | 버전 |
|---------|------|------|
| 런타임 | Bun | 1.2.8+ |
| 언어 | TypeScript | 5.0+ |
| TUI | Ink (React) | 5.2.0 |
| 저장소 | SQLite (WAL) | 3.40+ |
| 통신 | HTTP + SSE | - |

---

## 📝 최근 변경사항

### Skill/Agent 이름 표시 개선 (2024-04-19)

**문제**: 대시보드에서 Skill 호출 시 `Skill(인자내용)` 형태로 표시되어 어떤 스킬인지 파악하기 어려움

**해결**: 
- **훅 스크립트 수정** (`hooks/spyglass-collect.sh`): Skill 호출 시 `skill` 필드 우선 추출
  - 기존: `tool_detail`에 `args` 저장 → `Skill(#266234)`
  - 개선: `tool_detail`에 스킬 이름 저장 → `Skill(backend-workflow)`
- **기존 데이터 마이그레이션**: 31개 Skill 레코드 업데이트 완료

**결과**:
- **행위 컬럼**: 스킬 이름 표시 (예: `Skill(backend-workflow)`)
- **메시지 컬럼**: args 내용 그대로 표시 (예: `#266234`)
- Agent도 동일한 패턴으로 description 우선 표시

---

## 📝 문서

- [개발 계획](./docs/planning/01-overview-plan.md)
- [제품 요구사항 (PRD)](./docs/planning/02-prd.md)
- [기술 결정 기록 (ADR)](./docs/planning/03-adr.md)
- [개발 작업](./docs/planning/04-tasks-ai.md)
- [최종 스펙](./docs/planning/05-spec.md) 📋

---

## 🗺️ 로드맵

### Phase 1 (MVP) ✅ 완료
- [x] SQLite 저장소 (WAL 모드)
- [x] 훅 기반 데이터 수집 (UserPromptSubmit, PostToolUse)
- [x] HTTP 서버 + REST API
- [x] SSE 실시간 스트리밍
- [x] TUI 기본 구조 (Ink)
- [x] 실시간 토큰 카운터
- [x] 히스토리/분석 탭
- [x] 10K 토큰 알림

### Phase 2 ✅ 완료
- [x] 웹 대시보드 (Vanilla JS SPA)
- [x] 동적 알림 임계값 (Settings 탭)
- [x] 데이터 날짜 필터
- [x] `claude_events` 테이블 (raw 이벤트 전체 수집)
- [x] `PreToolUse` 훅 — 도구 실행 시간(`duration_ms`) 측정
- [x] 글로벌 훅 설정 — 모든 프로젝트 자동 수집 + 프로젝트별 구분

### Phase 3 (예정)
- [ ] `tool_use_id` 컬럼 추출 — 도구 호출 체인 추적
- [ ] Agent 서브세션 링크 — 부모/자식 세션 관계 추적
- [ ] 히트맵/타임라인 시각화
- [ ] CSV/JSON 내보내기
- [ ] ccflare 통합

---

## 🤝 기여

기여는 언제나 환영합니다! Issue와 PR을 통해 참여해주세요.

## 📄 라이선스

MIT

---

<p align="center">Made with ❤️ for Claude Code developers</p>
