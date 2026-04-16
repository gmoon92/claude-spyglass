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
# 데몬으로 실행
bun run packages/server/src/index.ts start

# 상태 확인
bun run packages/server/src/index.ts status

# 서버 종료
bun run packages/server/src/index.ts stop
```

### TUI 실행

```bash
# 터미널 UI 실행
bun run packages/tui/src/index.tsx
```

### 훅 설정

Claude Code `settings.json`에 훅을 추가하세요:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "bash /path/to/spyglass/hooks/spyglass-collect.sh prompt",
        "async": true,
        "timeout": 1
      }]
    }],
    "PostToolUse": [{
      "hooks": [{
        "type": "command",
        "command": "bash /path/to/spyglass/hooks/spyglass-collect.sh tool",
        "async": true,
        "timeout": 1
      }]
    }]
  }
}
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
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ UserPrompt   │  │ PostToolUse  │  │ Notification        │  │
│  │    훅        │  │    훅        │  │     훅              │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         └──────────────────┼─────────────────────┘              │
│                            ▼                                    │
│                   ┌─────────────────┐                           │
│                   │ spyglass-collect │  (Bash)                  │
│                   │    스크립트      │  async, timeout=1ms      │
│                   └────────┬────────┘                           │
└────────────────────────────┼────────────────────────────────────┘
                             │ HTTP
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    spyglass Server (Bun)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   /collect   │  │  REST API    │  │      /events         │  │
│  │   (수집)     │  │  (/api/*)    │  │      (SSE)           │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                     │              │
│         └─────────────────┼─────────────────────┘              │
│                           ▼                                    │
│                    ┌──────────────┐                            │
│                    │   SQLite     │  (WAL Mode)                │
│                    │   (Storage)  │                            │
│                    └──────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    spyglass TUI (Ink)                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Live Tab   │  │ History Tab  │  │   Analysis Tab       │  │
│  │  (실시간)     │  │  (과거세션)   │  │   (통계분석)          │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📡 API 엔드포인트

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| POST | `/collect` | 훅 데이터 수집 |
| GET | `/events` | SSE 스트리밍 |
| GET | `/api/sessions` | 세션 목록 |
| GET | `/api/sessions/:id` | 세션 상세 |
| GET | `/api/sessions/active` | 활성 세션 |
| GET | `/api/requests` | 요청 목록 |
| GET | `/api/requests/top` | TOP 토큰 요청 |
| GET | `/api/stats/sessions` | 세션 통계 |
| GET | `/api/stats/requests` | 요청 통계 |
| GET | `/api/stats/projects` | 프로젝트별 통계 |
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
- [x] 훅 기반 데이터 수집
- [x] HTTP 서버 + REST API
- [x] SSE 실시간 스트리밍
- [x] TUI 기본 구조 (Ink)
- [x] 실시간 토큰 카운터
- [x] 히스토리/분석 탭
- [x] 10K 토큰 알림

### Phase 2 (예정)
- [ ] 히트맵/타임라인 시각화
- [ ] 동적 알림 임계값
- [ ] 데이터 날짜 필터
- [ ] CSV/JSON 날짜
- [ ] ccflare 통합

### Phase 3 (예정)
- [ ] 웹 대시보드
- [ ] 다중 계정 지원
- [ ] 로드밸런싱
- [ ] 고급 분석

---

## 🤝 기여

기여는 언제나 환영합니다! Issue와 PR을 통해 참여해주세요.

## 📄 라이선스

MIT

---

<p align="center">Made with ❤️ for Claude Code developers</p>
