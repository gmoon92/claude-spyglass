# spyglass ADR (Architecture Decision Records)

> **이 문서는 현행 기술 결정을 반영한 살아있는 문서입니다.**
> 초기 기획 ADR은 `docs/planning/03-adr.md`를 참고하세요.

---

## ADR-001: 실행 방식 — 글로벌 데몬

### 상태
**결정됨** (2026-04-16)

### 결정
단일 글로벌 데몬 인스턴스로 모든 프로젝트 데이터를 통합 관리.

### 이유
- 모든 프로젝트 세션을 한 곳에서 조회 가능
- 여러 인스턴스 중복 실행 방지
- `spyglass start` / `spyglass stop` 단순 관리

---

## ADR-002: 데이터 저장소 — SQLite (WAL 모드)

### 상태
**결정됨** (2026-04-16)

### 결정
SQLite + WAL 모드. 단일 파일, zero-config.

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
```

---

## ADR-003: UI 프레임워크 — Ink (React for Terminal)

### 상태
**결정됨** (2026-04-16)

### 결정
Ink 5.x 채택. React 컴포넌트 패턴으로 TUI 구현.

---

## ADR-004: 데이터 수집 방식 — 훅 기반 (프록시 없음)

### 상태
**결정됨** (2026-04-16) / **확장됨** (2026-04-18, ADR-008 참고)

### 결정
Claude Code settings.json 훅을 통한 opt-in 방식 수집.
프록시 없이 `async: true, timeout: 1ms`로 Claude Code 성능 영향 최소화.

---

## ADR-005: 알림 임계값 — 고정값 (10K 토큰)

### 상태
**결정됨** (2026-04-16)

### 결정
단일 요청 10K 토큰 초과 시 알림. MVP 이후 사용자 설정 가능하도록 확장 예정.

---

## ADR-006: 개발 언어/런타임 — Bun + TypeScript

### 상태
**결정됨** (2026-04-16)

### 결정
Bun 1.2.8+ + TypeScript 5.0+. TypeScript 네이티브 지원, 빠른 실행.

---

## ADR-007: 훅 트리거 방식 — 와일드카드 전환

### 상태
**결정됨** (2026-04-18)

### 배경
기존 설정은 UserPromptSubmit/PostToolUse 등 개별 이벤트에만 훅을 등록했음.
Claude Code 소스 분석 결과 `matcher: "*"`로 25종 전체 이벤트를 단일 훅으로 수신 가능함이 확인됨.

### 고려한 옵션

| 방식 | 장점 | 단점 |
|------|------|------|
| 이벤트별 개별 등록 | 세밀한 제어 | 설정 복잡, 새 이벤트 미수용 |
| 와일드카드 단일 훅 | 설정 단순, 자동 확장 | 단일 장애점 |

### 결정
**와일드카드 + 단일 스크립트** 방식 채택.

```json
{
  "hooks": {
    "*": [{ "hooks": [{ "command": "bash .../spyglass-collect.sh", "async": true, "timeout": 1 }] }]
  }
}
```

### 이유
- 설정 파일 크기 90% 감소
- 새 이벤트 자동 수용 (25종 → 향후 추가분 포함)
- 중앙 집중 관리, 운영 부담 감소

---

## ADR-008: 이벤트 저장소 — claude_events 테이블 도입

### 상태
**결정됨** (2026-04-18)

### 배경
기존 requests 테이블은 UserPromptSubmit/PostToolUse 이벤트만 가공하여 저장함.
와일드카드 수집으로 25종 전체를 수신하게 되면서 raw payload를 별도 저장할 공간이 필요해짐.

### 결정
**단일 테이블 + JSON TEXT payload** 방식으로 `claude_events` 테이블 신규 추가.

```sql
CREATE TABLE IF NOT EXISTS claude_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    session_id TEXT NOT NULL,
    transcript_path TEXT,
    cwd TEXT,
    agent_id TEXT,
    agent_type TEXT,
    timestamp INTEGER NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    schema_version INTEGER DEFAULT 1
);
```

### 기존 테이블과의 관계

| 테이블 | 역할 | 상태 |
|--------|------|------|
| `sessions` | 세션 단위 집계 | 유지 |
| `requests` | 가공된 이벤트 (prompt/tool_call) | Deprecated 예정 → claude_events로 통합 |
| `claude_events` | raw hook payload 전체 | **현재 최종 저장소** |

### 통합 로드맵

1. **현재 (단계 1)**: claude_events 추가, requests 병렬 운영
2. **단계 2**: 모든 이벤트 claude_events 중복 저장 시작
3. **단계 3**: TUI/Web → claude_events 기반 전환
4. **단계 4**: requests 테이블 및 `/collect` 엔드포인트 제거

---

## ADR-009: 자동 문서 현행화 — git post-push hook

### 상태
**결정됨** (2026-04-18)

### 배경
소스 변경 후 문서(spec, adr 등)를 수동으로 현행화하는 작업이 반복적으로 누락됨.

### 결정
**git post-push hook + claude -p 헤드리스 실행** 방식으로 자동 현행화.

```
git push → .githooks/post-push
           → packages/**, hooks/** 변경 감지
           → claude -p --dangerously-skip-permissions
           → 문서 현행화
           → git commit + push ([skip-doc-sync] 태그)
```

### 이유
- 문서 현행화는 diff를 이해하는 "지식 작업" → AI 위임이 적합
- 무한 루프 방지: `[skip-doc-sync]` 태그로 현행화 커밋 스킵
- `.githooks/` + `package.json prepare` 로 팀 공유 가능

---

## 결정 요약

| ADR | 주제 | 결정 | 날짜 |
|-----|------|------|------|
| 001 | 실행 방식 | 글로벌 데몬 | 2026-04-16 |
| 002 | 저장소 | SQLite (WAL) | 2026-04-16 |
| 003 | TUI | Ink | 2026-04-16 |
| 004 | 수집 방식 | 훅 기반 | 2026-04-16 |
| 005 | 알림 임계값 | 10K 고정 | 2026-04-16 |
| 006 | 언어/런타임 | Bun + TS | 2026-04-16 |
| 007 | 훅 트리거 | 와일드카드 | 2026-04-18 |
| 008 | 이벤트 저장소 | claude_events 테이블 | 2026-04-18 |
| 009 | 문서 현행화 | git post-push hook | 2026-04-18 |

---

*현행화 담당: doc-adr 스킬 / git post-push hook*
