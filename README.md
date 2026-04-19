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

## 🚀 Quick Start (Docker)

spyglass는 **Docker 이미지(tar.gz)** 로 배포됩니다. 비공개 프로젝트이므로 레지스트리 없이 이미지 파일을 직접 전달받아 기동합니다.

### 사전 요구사항

- Docker Engine 20.10 이상 (`docker version`)
- Claude Code (호스트 설치, 훅 실행용)

### 1분 기동 (수신자)

```bash
# 1) 배포받은 이미지 로드
docker load < spyglass-v0.1.0-abcdef0.tar.gz

# 2) 컨테이너 기동 (9999 포트 + ~/.spyglass 볼륨)
docker compose up -d

# 3) 헬스체크
curl -sf http://localhost:9999/health && echo OK

# 4) 대시보드
open http://localhost:9999
```

> `docker-compose.yml`이 없으면: `docker run -d --name spyglass -p 9999:9999 -v "${HOME}/.spyglass:/data/.spyglass" spyglass:latest`

### 훅 설정은 글로벌 사용자 설정에

Claude Code 훅은 반드시 **글로벌 설정 파일 `~/.claude/settings.json`** 에 등록해야 합니다. 프로젝트 로컬 설정(`.claude/settings.local.json`)에 두면 다른 레포에서는 수집되지 않습니다.

```json
{
  "env": {
    "SPYGLASS_DIR": "/Users/<your-name>/spyglass-hooks"
  },
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1 }] }],
    "PreToolUse":  [{ "matcher": "*", "hooks": [{ "type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1 }] }],
    "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "bash $SPYGLASS_DIR/hooks/spyglass-collect.sh", "async": true, "timeout": 1 }] }]
  }
}
```

27개 전체 훅 설정·환경변수·문제해결 등 **상세 가이드는 반드시 [docs/install-guide.md](./docs/install-guide.md)** 를 참고하세요.

### 이미지 빌드 (배포자)

저장소 보유자가 배포 패키지를 만들 때:

```bash
bash scripts/build-image.sh
# dist/spyglass-v<version>-<hash>.tar.gz
# dist/spyglass-v<version>-<hash>.tar.gz.sha256
```

상세한 빌드·배포 절차는 [docs/install-guide.md §7](./docs/install-guide.md#7-이미지-빌드-배포자) 참고.

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

---

## 🤝 기여

기여는 언제나 환영합니다! Issue와 PR을 통해 참여해주세요.

## 📄 라이선스

MIT

---

<p align="center">Made with ❤️ for Claude Code developers</p>
