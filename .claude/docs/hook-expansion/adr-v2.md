# spyglass 훅 이벤트 확장 ADR v2 (와일드카드 방식 적용)

> 작성일: 2026-04-18
> 참여 전문가: 소프트웨어 아키텍트, 데이터 엔지니어, 데브옵스 엔지니어
> 변경사항: 이벤트별 설정 → 와일드카드 방식 전환

---

## ADR-001: 훅 트리거 방식 (변경됨)

### 상태
**변경됨** (2026-04-18)

### 배경
Claude Code 소스 분석 결과 `matcher: "*"`로 모든 25개 이벤트를 한 번에 수신 가능함이 확인되었습니다. 기존 이벤트별 개별 설정 방식은 불필요하게 복잡했습니다.

### 기존 결정 (Deprecated)
```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [...] }],
    "PostToolUse": [{ "hooks": [...] }],
    "SessionStart": [{ "hooks": [...] }]
    // ... 이벤트별 반복
  }
}
```

### 새로운 결정
**와일드카드 + 단일 스크립트 방식**

```json
{
  "hooks": {
    "*": [{
      "hooks": [{
        "command": "bash ${SPYGLASS_DIR}/hooks/spyglass-collect.sh",
        "async": true,
        "timeout": 1
      }]
    }]
  }
}
```

```bash
#!/bin/bash
# hook_event_name으로 이벤트 분기
payload=$(cat)
event_type=$(echo "$payload" | jq -r '.hook_event_name')

case "$event_type" in
  "PreToolUse"|"PostToolUse"|"PostToolUseFailure")
    # tool_calls 테이블
    ;;
  *)
    # events 테이블
    ;;
esac
```

### 이유

| 전문가 | 근거 |
|--------|------|
| **아키텍트** | 설정 파일 크기 90% 감소, 새 이벤트 자동 수용, 원자적 업데이트 |
| **데브옵스** | 설정 단순화, 중앙 집중 관리, 운영 부담 감소 |
| **데이터 엔지니어** | 표준화된 JSON 입력, hook_event_name으로 일관된 분기 |

### 대안 분석

| 방식 | 장점 | 단점 | 결정 |
|------|------|------|------|
| 와일드카드 | 설정 단순, 확장성 | 단일 장애점, 디버깅 어려움 | **✅ 채택** |
| 이벤트별 | 세밀한 제어, 장애 격리 | 설정 복잡, 유지보수 어려움 | ❌ 기각 |

---

## ADR-002: 데이터 저장소 (변경됨)

### 상태
**변경됨** (2026-04-18)

### 배경
25개 이벤트의 다양한 필드를 수용하면서도 세션 타임라인 조회 성능을 유지해야 합니다.

### 새로운 결정
**단일 테이블 + JSON TEXT payload (SQLite)**

> ⚠️ 기술 스택은 Bun + SQLite. PostgreSQL 전용 타입(BIGSERIAL, TIMESTAMPTZ, JSONB) 사용 불가.

```sql
CREATE TABLE IF NOT EXISTS claude_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,      -- UUID를 TEXT로 저장
    
    -- 공통 필드
    event_type TEXT NOT NULL,
    session_id TEXT NOT NULL,
    transcript_path TEXT,
    cwd TEXT,
    agent_id TEXT,
    agent_type TEXT,
    
    -- 시간 (epoch milliseconds)
    timestamp INTEGER NOT NULL,
    
    -- 이벤트별 고유 데이터 (JSON을 TEXT로 저장)
    payload TEXT NOT NULL DEFAULT '{}',
    
    -- 버전 관리
    schema_version INTEGER DEFAULT 1
);

-- 핵심 인덱스
CREATE INDEX IF NOT EXISTS idx_events_session_time ON claude_events(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_type_time ON claude_events(event_type, timestamp);
```

### 기존 테이블과의 관계 (통합 로드맵)

| 테이블 | 역할 | 단계 |
|--------|------|------|
| `sessions` | 세션 단위 집계 (토큰 합계 등) | 유지 (중기적으로 claude_events 집계로 대체) |
| `requests` | 기존 가공된 이벤트 (prompt/tool_call/system) | **Deprecated** → claude_events로 점진적 통합 |
| `claude_events` | raw hook payload 전체 수집 | **신규 — 최종 저장소** |

**통합 단계:**
1. **현재(단계 1)**: claude_events 추가, requests는 기존대로 병렬 운영
2. **단계 2**: UserPromptSubmit/PostToolUse도 claude_events에 중복 저장 시작
3. **단계 3**: TUI/Web이 claude_events 기반으로 전환
4. **단계 4**: requests 테이블 및 `/collect` 엔드포인트 제거

- `claude_events`는 `sessions` 테이블에 FK 없음 (독립 저장, 세션 미생성 이벤트도 수용)
- 신규 이벤트는 `/events` POST 엔드포인트를 통해 저장
- 기존 UserPromptSubmit/PostToolUse는 기존 `/collect` 파이프라인을 통해 저장 (단계 1)

### payload 예시

```json
// PreToolUse
{"tool_name": "Bash", "tool_input": {"command": "ls"}, "tool_use_id": "toolu_01"}

// SessionStart
{"source": "startup", "model": "claude-sonnet-4-6"}

// Stop
{"stop_hook_active": true, "last_assistant_message": "..."}
```

---

## ADR-003: 운영 전략 (신규)

### 상태
**결정됨** (2026-04-18)

### 결정
**와일드카드 수집 + 하이브리드 처리 + 단계적 롤아웃**

### 1. 하이브리드 처리

```
[Claude Code] → [와일드카드 수집] → [라우터] → [이벤트별 처리기]
```

- **수집**: `matcher: "*"`로 모든 이벤트 수신
- **라우팅**: `hook_event_name`으로 분류
- **처리**: 이벤트 유형별 전용 핸들러

### 2. 롤아웃 전략

| Phase | 기간 | 설정 | 목표 |
|-------|------|------|------|
| Shadow | 1-2주 | `async: true`, 로깅만 | 패턴 파악 |
| 선택적 | 1주 | 2-3개 이벤트만 | 안정성 검증 |
| 와일드카드 | 1주 | `*` 적용 | 전체 적용 |
| 최적화 | 지속 | 튜닝 | 성능 최적화 |

### 3. 모니터링

```bash
# 구조화된 로그
{"ts":"2026-04-18T10:00:00Z","event":"PreToolUse","status":"success","duration_ms":50}
```

| 메트릭 | 임계값 | 알림 |
|--------|--------|------|
| 스크립트 실패 | 연속 3회 | Slack |
| timeout 발생 | 1% 이상 | 로그 |
| 이벤트 폭증 | 평소 200% | Slack |

---

## ADR-004: 에러 처리 및 롤백 (신규)

### 상태
**결정됨** (2026-04-18)

### 결정
**비동기 + 로컬 버퍼링 + 긴급 롤백**

```bash
#!/bin/bash
set -euo pipefail

: "${SPYGLASS_ENDPOINT:?not set}"

payload=$(cat) || { echo "Failed to read stdin" >&2; exit 0; }

# Spyglass 전송 (실패필도 Claude 중단 안 함)
if ! curl -s -X POST "$SPYGLASS_ENDPOINT" \
     -d "$payload" --max-time 1; then
  # fallback: 로컬 파일에 저장
  echo "$payload" >> "${CLAUDE_TMP_DIR}/spyglass-failed.jsonl"
fi

exit 0
```

### 긴급 롤백

```bash
#!/bin/bash
# rollback-spyglass.sh
cp ~/.claude/settings.json.backup ~/.claude/settings.json
echo "롤백 완료. Claude Code 재시작 필요."
```

---

## 25개 이벤트 목록

| 카테고리 | 이벤트 |
|----------|--------|
| 도구 | PreToolUse, PostToolUse, PostToolUseFailure |
| 세션 | SessionStart, SessionEnd, Stop, StopFailure |
| 권한 | PermissionRequest, PermissionDenied |
| 에이전트 | SubagentStart, SubagentStop |
| 컴팩션 | PreCompact, PostCompact |
| 사용자 | UserPromptSubmit, Notification |
| 태스크 | TaskCreated, TaskCompleted |
| MCP | Elicitation, ElicitationResult |
| 워크스페이스 | WorktreeCreate, WorktreeRemove, CwdChanged, FileChanged |
| 시스템 | Setup, ConfigChange, InstructionsLoaded, TeammateIdle |

---

## 구현 체크리스트

- [ ] 스키마 마이그레이션 (claude_events 테이블)
- [ ] spyglass-collect.sh 와일드카드 지원 구현
- [ ] 이벤트 라우터 구현
- [ ] 로컬 버퍼링 (fallback) 구현
- [ ] 구조화된 로깅 구현
- [ ] 롤백 스크립트 작성
- [ ] README 설정 가이드 업데이트
- [ ] 단계적 롤아웃 가이드 작성
