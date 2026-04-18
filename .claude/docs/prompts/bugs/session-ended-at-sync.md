# Bug: Session End 이벤트와 sessions.ended_at 동기화 문제

## 문제 요약

`SessionEnd` 훅 이벤트가 발생하면 `claude_events` 테이블에는 기록되지만, `sessions` 테이블의 `ended_at` 컬럼이 업데이트되지 않습니다.

## 현재 동작 (Observed)

1. 세션이 종료되면 `claude_events` 테이블에 `event_type='SessionEnd'` 레코드가 생성됨
2. 하지만 `sessions` 테이블의 해당 세션 레코드는 `ended_at`이 `NULL`로 남아있음
3. 결과: "6시간 전 종료된 세션 삭제" 같은 쿼리가 실패함

## 예상 동작 (Expected)

`SessionEnd` 이벤트 수신 시 `sessions.ended_at` 컬럼이 해당 세션의 종료 시간으로 업데이트되어야 함

## 재현 방법

```sql
-- 1. 종료된 세션 확인 (ended_at이 NULL)
SELECT 
  s.id,
  s.started_at,
  datetime(s.started_at/1000, 'unixepoch', 'localtime') as started,
  s.ended_at,
  e.event_type,
  datetime(e.timestamp/1000, 'unixepoch', 'localtime') as ended
FROM sessions s
JOIN claude_events e ON s.id = e.session_id
WHERE e.event_type = 'SessionEnd'
  AND s.ended_at IS NULL;

-- 결과: 종료 이벤트는 있지만 ended_at은 NULL
```

## 관련 파일

- `packages/server/src/events.ts` - 이벤트 처리 로직
- `packages/server/src/collect.ts` - 데이터 수집 및 저장
- `hooks/spyglass-collect.sh` - 훅 호출 스크립트

## 요청사항

1. `SessionEnd` 이벤트 처리 시 `sessions.ended_at` 업데이트 로직 추가
2. 기존 NULL인 `ended_at` 데이터 마이그레이션 필요 여부 검토
3. 데이터 정합성 검증 방법 제안
