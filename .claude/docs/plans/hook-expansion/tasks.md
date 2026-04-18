# spyglass 훅 이벤트 확장 작업 목록

> 기준: adr-v2.md (와일드카드 방식 + 통합 로드맵)  
> 총 작업: 17개 (TUI Phase 추가)  
> 예상 소요: 7-10일

---

## Phase 1: 스키마 설계 (1일) ✅

### Task 1: claude_events 테이블 생성
**파일**: `packages/storage/src/migrations/v2-create-events-table.sql`

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

CREATE INDEX idx_events_session_time ON claude_events(session_id, timestamp);
CREATE INDEX idx_events_type_time ON claude_events(event_type, timestamp);
```

**검증**:
```bash
sqlite3 ~/.spyglass/spyglass.db < v2-create-events-table.sql
.tables
.schema claude_events
```

**커밋**: `feat(storage): claude_events 테이블 생성`

---

### Task 2: storage 패키지 쿼리 함수 추가
**파일**: `packages/storage/src/queries/event.ts`

```typescript
export interface ClaudeEvent {
  id?: number;
  event_id: string;
  event_type: string;
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  agent_id?: string;
  agent_type?: string;
  timestamp: number;
  payload: Record<string, unknown>;
  schema_version: number;
}

export function createEvent(db: Database, event: ClaudeEvent): void;
export function getEventsBySession(db: Database, sessionId: string): ClaudeEvent[];
export function getEventsByType(db: Database, eventType: string, limit?: number): ClaudeEvent[];
```

**검증**:
```bash
bun test packages/storage/src/__tests__/event.test.ts
```

**커밋**: `feat(storage): 이벤트 쿼리 함수 추가`

---

## Phase 2: 수집 스크립트 (2일)

### Task 3: 와일드카드 수집 스크립트 구현
**파일**: `hooks/spyglass-collect-v2.sh`

> ⚠️ 수정사항:
> - `SPYGLASS_DIR` 기본값 추가 (미정의 시 `set -u` 오류 방지)
> - 핸들러 내부 `&` 제거 — 훅 자체가 `"async": true`로 실행되므로 이중 비동기 불필요
> - 로그 파일 경로를 기존 스크립트(`${SPYGLASS_LOG_DIR}/collect.log`) 패턴에 통일

```bash
#!/bin/bash
set -euo pipefail

: "${SPYGLASS_ENDPOINT:-http://localhost:9999/events}"
: "${CLAUDE_TMP_DIR:-$HOME/.spyglass}"
# SPYGLASS_DIR 기본값: 이 스크립트 위치 기준 상위 디렉토리
: "${SPYGLASS_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

SPYGLASS_LOG_DIR="${CLAUDE_TMP_DIR}/logs"
SPYGLASS_LOG_FILE="${SPYGLASS_LOG_DIR}/collect.log"
mkdir -p "$SPYGLASS_LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$SPYGLASS_LOG_FILE"; }

payload=$(cat) || { log "ERROR: failed to read stdin"; exit 0; }
event_type=$(echo "$payload" | jq -r '.hook_event_name // "unknown"')
session_id=$(echo "$payload" | jq -r '.session_id // "unknown"')

log "START event=$event_type session=$session_id"

# 이벤트 라우팅
case "$event_type" in
  "PreToolUse"|"PostToolUse"|"PostToolUseFailure")
    handler="${SPYGLASS_DIR}/hooks/handlers/tool-events.sh"
    ;;
  "SessionStart"|"SessionEnd"|"Stop"|"StopFailure")
    handler="${SPYGLASS_DIR}/hooks/handlers/session-events.sh"
    ;;
  *)
    handler="${SPYGLASS_DIR}/hooks/handlers/other-events.sh"
    ;;
esac

if [[ -f "$handler" ]]; then
  # 동기 실행 — 훅이 이미 "async": true로 Claude와 별도 프로세스에서 실행됨
  echo "$payload" | bash "$handler"
else
  # 기본 처리: 직접 전송
  if ! curl -s -X POST "$SPYGLASS_ENDPOINT" \
       -H "Content-Type: application/json" \
       -d "$payload" --max-time 1; then
    log "ERROR: failed to send event=$event_type"
    echo "$payload" >> "${CLAUDE_TMP_DIR}/spyglass-failed.jsonl"
  fi
fi

log "END event=$event_type"
exit 0
```

**검증**:
```bash
# 테스트 데이터
echo '{"hook_event_name":"PreToolUse","session_id":"test","tool_name":"Bash"}' | bash hooks/spyglass-collect-v2.sh
tail ~/.spyglass/logs/spyglass-$(date +%Y%m%d).log
```

**커밋**: `feat(hooks): 와일드카드 수집 스크립트 구현`

---

### Task 4: 이벤트 핸들러 구현
**파일**: 
- `hooks/handlers/tool-events.sh`
- `hooks/handlers/session-events.sh`
- `hooks/handlers/other-events.sh`

**tool-events.sh**:
```bash
#!/bin/bash
payload=$(cat)
# tool_calls 테이블 또는 events 테이블로 저장
curl -s -X POST "$SPYGLASS_ENDPOINT/events" -d "$payload" --max-time 1
```

**검증**:
```bash
chmod +x hooks/handlers/*.sh
# 각 핸들러 테스트
```

**커밋**: `feat(hooks): 이벤트별 핸들러 구현`

---

### Task 5: 로컬 버퍼링 (fallback) 구현
**파일**: `hooks/lib/fallback-buffer.sh`

> ⚠️ Race condition 주의: Claude는 여러 도구를 병렬 실행하므로 훅 프로세스가 동시에 실행될 수 있음.
> `tail | mv` 패턴은 동시 쓰기 시 데이터 유실 위험이 있으므로 `flock`으로 파일 잠금 적용.

```bash
#!/bin/bash
buffer_file="${CLAUDE_TMP_DIR}/spyglass-buffer.jsonl"
lock_file="${buffer_file}.lock"
max_buffer_size=1000

save_to_buffer() {
  local payload="$1"
  # flock으로 동시 쓰기 방지
  (
    flock -x 200
    echo "$payload" >> "$buffer_file"
    local count
    count=$(wc -l < "$buffer_file")
    if [[ $count -gt $max_buffer_size ]]; then
      tail -n $max_buffer_size "$buffer_file" > "$buffer_file.tmp"
      mv "$buffer_file.tmp" "$buffer_file"
    fi
  ) 200>"$lock_file"
}

retry_from_buffer() {
  if [[ ! -f "$buffer_file" ]]; then
    return 0
  fi
  
  local tmp_file="${buffer_file}.retrying"
  (
    flock -x 200
    mv "$buffer_file" "$tmp_file"
  ) 200>"$lock_file"
  
  while IFS= read -r line; do
    curl -s -X POST "$SPYGLASS_ENDPOINT" -d "$line" --max-time 1 || {
      echo "$line" >> "$buffer_file"
    }
  done < "$tmp_file"
  
  rm -f "$tmp_file"
}
```

**커밋**: `feat(hooks): 로컬 버퍼링 fallback 구현`

---

## Phase 3: 서버 API (1일)

### Task 6: /events 엔드포인트 추가
**파일**: `packages/server/src/api.ts`

```typescript
// POST /events - 새로운 이벤트 저장
// ⚠️ session_id가 sessions 테이블에 없어도 저장 가능 (FK 없음, 독립 테이블)
//    단, SessionStart 이벤트 수신 시 sessions 테이블에도 세션을 생성해야 함
export async function eventsHandler(req: Request, db: SpyglassDatabase): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  
  try {
    const payload = await req.json();
    const event: ClaudeEvent = {
      event_id: crypto.randomUUID(),
      event_type: payload.hook_event_name,
      session_id: payload.session_id,
      transcript_path: payload.transcript_path,
      cwd: payload.cwd,
      agent_id: payload.agent_id,
      agent_type: payload.agent_type,
      timestamp: Date.now(),
      payload: JSON.stringify(payload),
      schema_version: 1
    };
    
    // SessionStart 이벤트: sessions 테이블에도 세션 생성 (ensureSession 로직 필요)
    // TODO: SessionStart 시 sessions 테이블 upsert 구현
    if (payload.hook_event_name === 'SessionStart') {
      // ensureSession(db.instance, payload.session_id, payload.cwd, Date.now());
    }
    
    createEvent(db.instance, event);
    
    return new Response(JSON.stringify({ success: true, event_id: event.event_id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 });
  }
}
```

**검증**:
```bash
curl -X POST http://localhost:9999/events \
  -H "Content-Type: application/json" \
  -d '{"hook_event_name":"SessionStart","session_id":"test","source":"startup"}'
```

**커밋**: `feat(server): /events 엔드포인트 추가`

---

## Phase 4: 문서 및 설정 (1일)

### Task 7: README 설정 가이드 업데이트
**파일**: `README.md` (훅 설정 섹션)

```markdown
### 훅 설정 (와일드카드 방식)

한 번의 설정으로 모든 25개 이벤트를 수집합니다:

\`\`\`json
{
  "hooks": {
    "*": [{
      "hooks": [{
        "type": "command",
        "command": "bash /path/to/spyglass/hooks/spyglass-collect-v2.sh",
        "async": true,
        "timeout": 1
      }]
    }]
  }
}
\`\`\`
```

**커밋**: `docs: README 와일드카드 설정 가이드 추가`

---

### Task 8: 마이그레이션 가이드 작성
**파일**: `docs/hook-expansion/migration-guide.md`

```markdown
# 마이그레이션 가이드 (v1 → v2)

## 변경사항
- 이벤트별 설정 → 와일드카드 단일 설정
- requests 테이블 → claude_events 테이블

## 마이그레이션 절차
1. 백업: `cp ~/.spyglass/spyglass.db ~/.spyglass/spyglass.db.backup`
2. 스키마 업데이트: `bun run migrate`
3. 설정 업데이트: settings.json의 hooks를 와일드카드로 변경
4. 검증: 로그 확인

## 롤백
```bash
cp ~/.spyglass/spyglass.db.backup ~/.spyglass/spyglass.db
```
```

**커밋**: `docs: 마이그레이션 가이드 작성`

---

### Task 9: 롤백 스크립트 작성
**파일**: `scripts/rollback.sh`

```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="$HOME/.spyglass/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "spyglass 롤백 시작..."

# 설정 백업
if [[ -f "$HOME/.claude/settings.json" ]]; then
  cp "$HOME/.claude/settings.json" "$BACKUP_DIR/settings.json.$TIMESTAMP"
fi

# DB 백업
if [[ -f "$HOME/.spyglass/spyglass.db" ]]; then
  cp "$HOME/.spyglass/spyglass.db" "$BACKUP_DIR/spyglass.db.$TIMESTAMP"
fi

# 이전 설정 복원 (있다면)
if [[ -f "$BACKUP_DIR/settings.json.pre-wildcard" ]]; then
  cp "$BACKUP_DIR/settings.json.pre-wildcard" "$HOME/.claude/settings.json"
  echo "설정 롤백 완료. Claude Code 재시작 필요."
else
  echo "백업된 설정을 찾을 수 없습니다. 수동 롤백이 필요합니다."
fi

echo "롤백 완료"
```

**커밋**: `feat(scripts): 롤백 스크립트 추가`

---

## Phase 5: 테스트 및 검증 (2일)

### Task 10: 통합 테스트 작성
**파일**: `packages/server/src/__tests__/events-integration.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getDatabase } from '@spyglass/storage';

describe('Events Integration', () => {
  it('should handle wildcard event collection', async () => {
    // 모든 25개 이벤트 타입 테스트
    const events = [
      { hook_event_name: 'PreToolUse', tool_name: 'Bash' },
      { hook_event_name: 'SessionStart', source: 'startup' },
      { hook_event_name: 'Stop', stop_hook_active: true },
      // ... 나머지 이벤트
    ];
    
    for (const event of events) {
      const response = await fetch('http://localhost:9999/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...event, session_id: 'test-session' })
      });
      expect(response.status).toBe(200);
    }
  });
});
```

**검증**:
```bash
bun test packages/server/src/__tests__/events-integration.test.ts
```

**커밋**: `test: 이벤트 수집 통합 테스트`

---

### Task 11: 부하 테스트
**파일**: `scripts/load-test.sh`

```bash
#!/bin/bash
# 1000개 이벤트 빠르게 전송
for i in {1..1000}; do
  curl -s -X POST http://localhost:9999/events \
    -d "{\"hook_event_name\":\"PreToolUse\",\"session_id\":\"load-test\",\"tool_name\":\"Bash\"}" &
done
wait
echo "부하 테스트 완료"
```

**검증**:
```bash
bash scripts/load-test.sh
# DB 확인
sqlite3 ~/.spyglass/spyglass.db "SELECT COUNT(*) FROM claude_events WHERE session_id='load-test';"
```

**커밋**: `test: 부하 테스트 스크립트 추가`

---

### Task 12: 단계적 롤아웃 가이드 작성
**파일**: `docs/hook-expansion/rollout-guide.md`

```markdown
# 단계적 롤아웃 가이드

## Phase 1: Shadow (1-2주)
- 설정: 와일드카드 적용, 로깅만 수행
- 목표: 이벤트 패턴 파악, 볼륨 측정
- 검증: 로그 파일 분석

## Phase 2: 선택적 활성화 (1주)
- 설정: 2-3개 이벤트만 실제 저장
- 목표: 안정성 검증
- 검증: DB 저장 확인, 에러 로그 모니터링

## Phase 3: 와일드카드 전환 (1주)
- 설정: 모든 이벤트 저장
- 목표: 전체 기능 검증
- 검증: TUI에서 이벤트 확인

## Phase 4: 운영 최적화
- 설정: 성능 튜닝
- 목표: 안정적 운영
```

**커밋**: `docs: 단계적 롤아웃 가이드 작성`

---

---

## Phase 6: TUI 이벤트 뷰 (2일)

### Task 13: EventsTab 컴포넌트 추가
**파일**: `packages/tui/src/components/EventsTab.tsx`

세션 타임라인에서 claude_events를 조회하는 탭.
- `/api/events/stats` 조회 → 이벤트 타입별 카운트 표시
- `/api/sessions/:id/events` 조회 → 선택된 세션의 이벤트 타임라인 표시
- event_type별 색상 코딩 (도구/세션/권한/기타)

**커밋**: `feat(tui): EventsTab 이벤트 타임라인 추가`

---

### Task 14: useEvents 훅 추가
**파일**: `packages/tui/src/hooks/useEvents.ts`

```typescript
export function useEvents(sessionId?: string) {
  // GET /api/events/stats 또는 /api/sessions/:id/events
  // SSE를 통한 실시간 업데이트 연동
}
```

**커밋**: `feat(tui): useEvents 데이터 훅 추가`

---

### Task 15: LiveTab에 실시간 이벤트 스트림 추가
**파일**: `packages/tui/src/components/LiveTab.tsx`

기존 LiveTab에 claude_events 실시간 스트림 표시 추가.
- `hook_event_name` 기준으로 이벤트 필터링
- 최근 20개 이벤트를 스크롤 가능한 목록으로 표시

**커밋**: `feat(tui): LiveTab에 이벤트 스트림 추가`

---

### Task 16: TabBar에 Events 탭 추가
**파일**: `packages/tui/src/components/TabBar.tsx`

기존 탭(Live/Analysis/History/Settings) 옆에 Events 탭 추가.

**커밋**: `feat(tui): Events 탭 네비게이션 추가`

---

### Task 17: app.tsx에 EventsTab 라우팅 연결
**파일**: `packages/tui/src/app.tsx`

TabBar Events 탭 선택 시 EventsTab 컴포넌트 렌더링.

**커밋**: `feat(tui): Events 탭 라우팅 연결`

---

## 작업 의존성 그래프

```
Task 1 (스키마)
    ↓
Task 2 (쿼리) → Task 6 (API)
    ↓                ↓
Task 3 (수집) ←──────┘
    ↓
Task 4 (핸들러)
    ↓
Task 5 (버퍼링)
    ↓
Task 10 (테스트) → Task 11 (부하)

Task 7, 8, 9, 12 (문서) - 병렬 가능
```

---

## 완료 기준

- [ ] 모든 25개 이벤트 수집 확인
- [ ] 와일드카드 설정 단일화
- [ ] 로컬 버퍼링 동작 확인
- [ ] 롤백 스크립트 테스트
- [ ] 문서 작성 완료
