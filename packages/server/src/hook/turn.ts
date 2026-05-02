/**
 * hook 모듈 — turn_id 채번 / 조회
 *
 * 책임:
 *  - 한 세션 내에서 prompt 1번 + 그 prompt에 묶이는 N개의 tool_call/response를 동일 turn_id로 그룹화.
 *  - prompt 도착 시 turn_id 채번 (T1, T2, ...)
 *  - tool_call/response 도착 시 직전 prompt의 turn_id 재사용
 *
 * 포맷: `<session_id>-T<순번>` (1부터 시작)
 *
 * 외부 노출:
 *  - assignTurnId(db, sessionId): 새 turn_id 발급 (prompt 시점에만 호출)
 *  - getLastTurnId(db, sessionId): 직전 prompt의 turn_id 조회 (tool_call/response/proxy 측에서 사용)
 *
 * 호출자:
 *  - persist.ts: saveRequest에서 prompt면 assignTurnId, 아니면 getLastTurnId
 *  - events.ts: Stop 이벤트 응답 행 매핑
 *  - proxy.ts: proxy_requests.turn_id에 채워 같은 turn 묶음 (v19)
 *  - raw-handler.ts: 서브에이전트 자식 도구 INSERT 시 부모 Agent의 turn_id 조회
 *
 * 의존성: bun:sqlite Database
 */

import type { Database } from 'bun:sqlite';

/**
 * 세션 내 다음 turn_id 채번 — prompt 타입 수신 시 호출.
 *
 * 동일 session_id의 type='prompt' 행 수를 세서 +1 (1-based).
 * 동시 prompt가 들어올 가능성은 거의 없지만, 들어와도 SQLite UNIQUE 제약은 없으므로
 * 타이밍 경합 시 같은 turn_id가 부여될 수 있다 (실측상 문제 안 됨).
 */
export function assignTurnId(db: Database, sessionId: string): string {
  const row = db.query(
    `SELECT COUNT(*) as cnt FROM requests WHERE session_id = ? AND type = 'prompt'`,
  ).get(sessionId) as { cnt: number } | null;
  const next = (row?.cnt ?? 0) + 1;
  return `${sessionId}-T${next}`;
}

/**
 * 현재 세션의 마지막 turn_id 조회 (tool_call/response/proxy 저장 시 사용).
 *
 * 가장 최근 prompt 행의 turn_id를 반환. prompt가 아직 없으면 null.
 *
 * 호출 패턴:
 *   const turnId = getLastTurnId(db, sessionId) ?? undefined;
 *   createRequest(db, { ..., turn_id: turnId });
 */
export function getLastTurnId(db: Database, sessionId: string): string | null {
  const row = db.query(
    `SELECT turn_id FROM requests WHERE session_id = ? AND type = 'prompt' ORDER BY timestamp DESC LIMIT 1`,
  ).get(sessionId) as { turn_id: string } | null;
  return row?.turn_id ?? null;
}
