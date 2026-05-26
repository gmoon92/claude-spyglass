/**
 * retention.ts — 그래프 DB(LadybugDB) 데이터 보존 기간 정리.
 *
 * 책임:
 *   RDB(SQLite) 의 `deleteOldData` 와 *완전히 동일한 cutoff* 로 그래프의 타임스탬프 노드를
 *   삭제한다. SQLite 의 retention 일수는 `@spyglass/storage` 의 `getRetentionCutoffTs()` 가
 *   SSoT 이며, 호출자(`server/runtime/maintenance.ts`)가 동일 cutoff 를 본 모듈로 전달.
 *
 * 정책 — 타임스탬프 노드만 삭제:
 *   - Event       (timestamp  < cutoff) → DETACH DELETE
 *   - ToolCall    (started_at < cutoff) → DETACH DELETE
 *   - Turn        (started_at < cutoff) → DETACH DELETE
 *   - Session     (started_at < cutoff) → DETACH DELETE
 *
 *   MetaDocument / Agent 노드는 *카탈로그성* 노드라 보존. USES/CALLED 엣지는 타임스탬프
 *   노드가 DETACH DELETE 될 때 자동으로 함께 제거된다 — dangling MetaDocument/Agent 는
 *   다음 sync tick 에서 자연스럽게 다시 USES 엣지를 얻을 수 있다.
 *
 * 안전성:
 *   - mode='off' / circuit OPEN / Ladybug 미설치 시 즉시 no-op 반환. 절대 throw 하지 않는다
 *     (호출자 maintenance 스케줄이 SQLite 정리는 정상 진행해야 하므로).
 *   - 각 Cypher 실패는 console.warn 후 다음 단계로 진행 — 부분 실패가 다른 단계를 막지 않음.
 *   - **폴더 자체를 삭제하지 않는다.** 본 모듈은 데이터 단위 DELETE 만 수행하며, 그래프
 *     디렉토리(`~/.spyglass/graph/`) 는 어떤 경로로도 자동/수동 삭제되지 않는 정책.
 *
 * @see packages/storage/src/runtime/retention.ts — cutoff SoT
 * @see packages/server/src/runtime/maintenance.ts — 일별 호출자
 * @see packages/storage/src/queries/session/retention.ts::deleteOldData — RDB 대응
 */

import { getGraphMode } from '../runtime/flag';
import { getCircuitBreaker } from '../runtime/circuit-breaker';
import { getLadybugClient, LadybugUnavailableError, type LadybugClient } from '../client';

/**
 * 4 개 타임스탬프 노드 DELETE Cypher (의존성 깊이 순서: Event → ToolCall → Turn → Session).
 *
 *   본 상수가 테스트에서 호출 인자 검증의 SoT — 테스트가 production query 와 한 글자라도
 *   어긋나지 않도록 양쪽이 같은 배열을 참조.
 */
export const RETENTION_DELETE_STEPS: ReadonlyArray<{ label: string; cypher: string }> = [
  { label: 'Event',    cypher: `MATCH (e:Event)    WHERE e.timestamp  < $cutoff DETACH DELETE e` },
  { label: 'ToolCall', cypher: `MATCH (c:ToolCall) WHERE c.started_at < $cutoff DETACH DELETE c` },
  { label: 'Turn',     cypher: `MATCH (t:Turn)     WHERE t.started_at < $cutoff DETACH DELETE t` },
  { label: 'Session',  cypher: `MATCH (s:Session)  WHERE s.started_at < $cutoff DETACH DELETE s` },
];

/**
 * 주어진 LadybugClient 에 대해 4단계 DELETE Cypher 를 순차 실행. 본 함수는 *mode/circuit
 * 게이팅을 하지 않으므로* 테스트에서 mock client 와 함께 호출 가능. 운영 코드는
 * `deleteOldGraphData()` 를 사용하라.
 *
 *   각 단계 실패는 흡수하고 다음 단계 진행 — 부분 실패가 다른 단계를 막지 않음.
 */
export async function deleteOldGraphDataOnClient(
  client: LadybugClient | { query: LadybugClient['query'] },
  cutoff: number,
): Promise<void> {
  for (const { label, cypher } of RETENTION_DELETE_STEPS) {
    try {
      await client.query(cypher, { cutoff });
    } catch (err) {
      console.warn(`[graph-retention] ${label} cleanup failed (continuing): ${err}`);
    }
  }
}

/**
 * cutoff(ms) 이전의 타임스탬프 노드를 그래프에서 삭제. RDB retention 과 동일 cutoff 로
 * 호출되어야 양쪽 데이터가 일치한다.
 *
 *   - mode='off' / circuit OPEN / Ladybug unavailable → 즉시 no-op (정상 동작).
 *   - 각 단계 실패는 흡수하고 다음 단계 진행 — main flow 봉쇄 금지.
 */
export async function deleteOldGraphData(cutoff: number): Promise<void> {
  // 1) mode 게이트 — graph 가 꺼져 있으면 정리할 그래프 자체가 없음.
  if (getGraphMode() === 'off') return;

  // 2) circuit 게이트 — OPEN 이면 Ladybug 호출 자체 회피 (회로가 회복 결정).
  const breaker = getCircuitBreaker();
  if (!breaker.allowsTraffic()) return;

  // 3) lazy client — 미설치/실패 시 LadybugUnavailableError throw → 흡수 후 no-op.
  let client: LadybugClient;
  try {
    client = await getLadybugClient();
  } catch (err) {
    if (!(err instanceof LadybugUnavailableError)) {
      console.warn(`[graph-retention] client unavailable: ${err}`);
    }
    return;
  }

  // 4) 실제 DELETE — 의존성 깊이 순서. 각 단계 실패는 흡수.
  await deleteOldGraphDataOnClient(client, cutoff);
}
