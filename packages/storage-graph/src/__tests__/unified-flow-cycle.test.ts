/**
 * unified-flow-cycle.test.ts — 코호트 양방향 엣지(cycle) 회귀 가드
 *
 * 책임:
 *   코호트 집계는 여러 turn 의 인접쌍을 합치므로 A→B 와 B→A 가 동시에 생기는 cycle 이
 *   필연적이다. 과거에는 이 cycle 이 Kahn 위상정렬의 cycle-fallback(모든 cycle 노드를
 *   단일 layer 로 덤프)을 자극해 descendant 가 *한 열*에 수직 밀집(column 붕괴)됐다.
 *
 *   buildAcyclicLayeringEdges 가 layering 입력을 started_at 기준 DAG 로 정규화한 뒤로는
 *   cycle 이 사라지고 longest-path layer 가 좌→우로 펼쳐져야 한다. 본 테스트가 그 방어선.
 *
 * 시드 의도 (center = agent::pm, 2 turn 에서 aa/bb 순서를 뒤집어 aa↔bb cycle 유발):
 *   T1: pm → aa → bb     (엣지 CENTER→aa, aa→bb)
 *   T2: pm → bb → aa     (엣지 CENTER→bb, bb→aa)   ← aa↔bb 양방향 = cycle
 *
 *   집계 started_at: aa < bb (T1 의 이른 시각이 min). DAG 정규화 후:
 *     CENTER→aa, aa→bb, CENTER→bb  → longest-path: pm(L0), aa(L1), bb(L2).
 *   따라서 descendant 가 최소 2개의 서로 다른 컬럼으로 분산되어야 한다.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { getUnifiedFlow } from '../queries/unified-flow';
import { createMockClient } from './seed-mocks';

type Client = ReturnType<typeof createMockClient>;

const T1_BASE = 1_700_000_000_000;
const T2_BASE = 1_700_000_900_000; // T1 보다 충분히 뒤 — 집계 min 이 T1 시각을 채택하도록.

function addMetaDoc(client: Client, kind: string, name: string): string {
  const id = `${kind}::${name}`;
  client._addNode('MetaDocument', { id, kind, name });
  return id;
}

/** ToolCall + USES(→MetaDocument) 엣지 1개 등록. */
function addCall(
  client: Client,
  sessionId: string,
  turnId: string,
  toolUseId: string,
  startedAt: number,
  mdId: string,
): void {
  client._addNode('ToolCall', {
    tool_use_id: toolUseId,
    session_id: sessionId,
    turn_id: turnId,
    started_at: startedAt,
    duration_ms: 50,
  });
  client._addEdge('ToolCall', toolUseId, 'MetaDocument', mdId, 'USES');
}

describe('Unified Flow — 코호트 cycle 회귀 (column 붕괴 방지)', () => {
  let client: Client;

  beforeEach(() => {
    client = createMockClient();
    const sess = 'sess-CY-1';
    const mdPm = addMetaDoc(client, 'agent', 'pm');
    const mdAa = addMetaDoc(client, 'skill', 'aa');
    const mdBb = addMetaDoc(client, 'skill', 'bb');

    // T1: pm → aa → bb
    addCall(client, sess, 'sess-CY-1-T1', 'tu-CY-1-pm', T1_BASE + 0, mdPm);
    addCall(client, sess, 'sess-CY-1-T1', 'tu-CY-1-aa', T1_BASE + 100, mdAa);
    addCall(client, sess, 'sess-CY-1-T1', 'tu-CY-1-bb', T1_BASE + 200, mdBb);

    // T2: pm → bb → aa  (aa↔bb 양방향 엣지 유발)
    addCall(client, sess, 'sess-CY-1-T2', 'tu-CY-2-pm', T2_BASE + 0, mdPm);
    addCall(client, sess, 'sess-CY-1-T2', 'tu-CY-2-bb', T2_BASE + 100, mdBb);
    addCall(client, sess, 'sess-CY-1-T2', 'tu-CY-2-aa', T2_BASE + 200, mdAa);
  });

  test('양방향 엣지가 있어도 cycleDetected=false — layering 입력이 DAG 로 정규화됨', async () => {
    const result = await getUnifiedFlow(client, { centerKind: 'agent', centerName: 'pm', depth: 3 });
    expect(result.meta.seedCount).toBeGreaterThan(0);
    expect(result.meta.cycleDetected).toBe(false);
  });

  test('descendant 가 단일 컬럼으로 붕괴하지 않고 ≥2개 컬럼으로 분산', async () => {
    const result = await getUnifiedFlow(client, { centerKind: 'agent', centerName: 'pm', depth: 3 });

    const descendantDepths = new Set(
      result.nodes.filter((n) => n.data.depth > 0).map((n) => n.data.depth),
    );
    // 붕괴 버그였다면 모든 descendant 가 depth=0(center 열) 또는 단일 depth 로 뭉친다.
    expect(descendantDepths.size).toBeGreaterThanOrEqual(2);

    // 구체 검증: aa(먼저) 가 bb(나중) 보다 좌측 컬럼.
    const aa = result.nodes.find((n) => n.data.name === 'aa');
    const bb = result.nodes.find((n) => n.data.name === 'bb');
    expect(aa).toBeDefined();
    expect(bb).toBeDefined();
    expect(aa!.data.depth).toBeGreaterThan(0);
    expect(bb!.data.depth).toBeGreaterThan(aa!.data.depth);
  });

  test('column 인덱스 정합 — 모든 노드 data.column 이 columns 배열 범위 안', async () => {
    const result = await getUnifiedFlow(client, { centerKind: 'agent', centerName: 'pm', depth: 3 });
    for (const n of result.nodes) {
      expect(n.data.column).toBeGreaterThanOrEqual(0);
      expect(n.data.column).toBeLessThan(result.columns.length);
    }
  });
});
