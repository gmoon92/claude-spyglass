# Track 2 — N+1 쿼리 제거

## 목표

`getAllSessions()`와 `getTurnsBySession()`의 N+1 및 메모리 그룹화 패턴을 SQL 수준에서 해소하여, 세션·턴 수가 많을 때 응답시간·메모리를 개선한다.

## 배경

`.claude/docs/evaluation/final-evaluation.md`의 P1(4.1 항목).

- `getAllSessions()`: 세션마다 `requests` COUNT·최근 timestamp를 개별 쿼리 → 1000 세션이면 2000회 추가 쿼리
- `getTurnsBySession()`: 세션의 모든 `requests`를 메모리로 로드 후 JS에서 턴별 그룹화 → O(n) 메모리

## 작업 범위

### 1. getAllSessions 리팩토링

**현재 (의심 패턴):**
```typescript
const sessions = db.prepare('SELECT * FROM sessions').all();
return sessions.map(s => ({
  ...s,
  requestCount: db.prepare('SELECT COUNT(*) FROM requests WHERE session_id = ?').get(s.id),
  lastActivity: db.prepare('SELECT MAX(timestamp) FROM requests WHERE session_id = ?').get(s.id),
}));
```

**개선:**
```sql
SELECT
  s.*,
  COUNT(r.id) AS request_count,
  MAX(r.timestamp) AS last_activity
FROM sessions s
LEFT JOIN requests r ON r.session_id = s.id
  AND (r.event_type IS NULL OR r.event_type != 'pre_tool' OR r.tool_name = 'Agent')
GROUP BY s.id
ORDER BY COALESCE(MAX(r.timestamp), s.started_at) DESC;
```

### 2. getTurnsBySession 리팩토링

현재 전 행 메모리 로드 후 JS 그룹화 → **SQL에서 turn_id로 그룹화**하거나, **DB 측 스트리밍**(iterator)으로 메모리 절감.

옵션 A — SQL 집계 (권장):
```sql
SELECT turn_id,
       MIN(timestamp) AS turn_start,
       MAX(timestamp) AS turn_end,
       COUNT(*) AS request_count,
       SUM(tokens_input) AS tokens_input_sum,
       SUM(tokens_output) AS tokens_output_sum,
       json_group_array(json_object(
         'id', id,
         'event_type', event_type,
         'tool_name', tool_name,
         'timestamp', timestamp
       )) AS requests_json
FROM requests
WHERE session_id = ?
GROUP BY turn_id
ORDER BY turn_start ASC;
```

옵션 B — 기존 쿼리 유지하되 `iterate()` 사용 (점진적 처리).

먼저 옵션 A 시도, 성능·호환성 문제 있으면 B로 대체.

## 변경 파일

- `packages/storage/src/queries/session.ts` (getAllSessions)
- `packages/storage/src/queries/turn.ts` 또는 `request.ts` (getTurnsBySession)
- 호출 측 (`packages/server/src/api.ts` 등) 시그니처 변경 없도록 주의

## 검증

- 기존 테스트 통과
- 100 세션·세션당 500 requests 생성 후 응답시간 비교
- SSE 실시간 업데이트가 여전히 동작하는지 확인 (세션 목록이 변경되지 않으면 됨)

## 주의사항

- `event_type` 필터는 Track 1의 `visible_requests` VIEW와 중복 정의될 수 있음. **Track 1과 독립적으로 작업**: Track 2에서는 기존 WHERE 절 그대로 사용하고, VIEW 적용은 별도 후속 작업에서 교체
- 반환 타입(`Session`, `Turn` 등)을 바꾸지 말 것 — 호출 측이 깨짐
