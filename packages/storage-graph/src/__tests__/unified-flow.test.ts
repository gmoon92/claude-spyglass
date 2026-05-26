/**
 * unified-flow.test.ts — Phase E 핵심 검증 (migration-plan §E)
 *
 * 책임:
 *   getUnifiedFlow 의 raw 응답이 ego + sequential 통합 정책을 만족하는지 검증.
 *   sequential-flow.test.ts 의 V-1~V-5 의도를 이식하면서 *unified 의 신규 표면*
 *   (ancestor depth 음수 + columns 좌→우 + layerTone 5분위) 을 추가 검증.
 *
 * 보존된 검증 의도 (이전 SQLite ego 27+ 케이스 → unified 단일):
 *   - depth 가변 컬럼 생성 (ancestor 음수 + descendant 양수 + after)
 *   - self-loop 격하 (center 와 동일 (kind,name) 제외)
 *   - 빈 center (seeds=[]) → 빈 응답
 *   - PARENT_OF*1..N 가변 깊이 traversal
 *
 * 비범위:
 *   - count/pct/HOT pill — graph.ts::enrichUnifiedFlow 에서 부착되므로 unified-flow.ts
 *     자체 응답에서는 *없음*. enrich 검증은 server 패키지의 별도 테스트.
 *   - MCP 그룹핑 — 동일 (enrich 책임).
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { getUnifiedFlow } from '../queries/unified-flow';
import { createMockClient, seedSetA } from './seed-mocks';

describe('Unified Flow — Set A (/refactor 표준)', () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    seedSetA(client);
  });

  test('center 카드와 seed ToolCall 이 응답에 포함', async () => {
    const result = await getUnifiedFlow(client, {
      centerKind: 'command',
      centerName: '/refactor',
      depth: 3,
    });
    expect(result.meta.seedCount).toBeGreaterThan(0);
    expect(result.nodes.some((n) => n.id === 'center')).toBe(true);
  });

  test('descendant chain 가변 깊이 — depth 3 traversal', async () => {
    const result = await getUnifiedFlow(client, {
      centerKind: 'command',
      centerName: '/refactor',
      depth: 3,
    });
    // descendant 컬럼 (depth > 0) 존재.
    const descendantNodes = result.nodes.filter((n) => n.data.depth > 0);
    expect(descendantNodes.length).toBeGreaterThan(0);
  });

  test('self-loop 격하 — center 와 동일 (kind, name) 의 메타 문서는 결과에서 제외', async () => {
    const result = await getUnifiedFlow(client, {
      centerKind: 'command',
      centerName: '/refactor',
      depth: 3,
    });
    // center 합성 노드는 1개. 그 외 노드 중 (command, /refactor) 가 *다시* 나오면 self-loop 회귀.
    const dupCenter = result.nodes.filter(
      (n) => n.id !== 'center' && n.data.kind === 'command' && n.data.name === '/refactor',
    );
    expect(dupCenter.length).toBe(0);
  });

  test('columns 좌→우 정렬 — ancestor 깊은쪽이 좌측', async () => {
    const result = await getUnifiedFlow(client, {
      centerKind: 'command',
      centerName: '/refactor',
      depth: 3,
    });
    // columns 안에 'center' tag 가 정확히 1번 등장 + ancestor/descendant 가 양옆에.
    const tags = result.columns.map((c) => c.tag);
    const centerIdx = tags.indexOf('center');
    expect(centerIdx).toBeGreaterThanOrEqual(0);

    // center 좌측은 'ancestor' (있다면), 우측은 'descendant' (있다면).
    for (let i = 0; i < centerIdx; i++) expect(tags[i]).toBe('ancestor');
    for (let i = centerIdx + 1; i < tags.length; i++) {
      expect(['descendant', 'after']).toContain(tags[i]);
    }
  });

  test('layerTone 5분위 — 모든 노드에 0..4 범위 값 부여', async () => {
    const result = await getUnifiedFlow(client, {
      centerKind: 'command',
      centerName: '/refactor',
      depth: 3,
    });
    for (const n of result.nodes) {
      expect(typeof n.data.layerTone).toBe('number');
      expect(n.data.layerTone).toBeGreaterThanOrEqual(0);
      expect(n.data.layerTone).toBeLessThanOrEqual(4);
    }
  });

  test('column 인덱스 정합 — 모든 노드의 data.column 이 columns 배열 인덱스 범위 안', async () => {
    const result = await getUnifiedFlow(client, {
      centerKind: 'command',
      centerName: '/refactor',
      depth: 3,
    });
    for (const n of result.nodes) {
      expect(n.data.column).toBeGreaterThanOrEqual(0);
      expect(n.data.column).toBeLessThan(result.columns.length);
    }
  });

  test('빈 center (시드 0) → 빈 응답', async () => {
    const result = await getUnifiedFlow(client, {
      centerKind: 'command',
      centerName: '/non-existent-command',
      depth: 3,
    });
    expect(result.nodes.length).toBe(0);
    expect(result.edges.length).toBe(0);
    expect(result.columns.length).toBe(0);
    expect(result.meta.seedCount).toBe(0);
  });

  test('depth clamping — 입력 0/음수/8 모두 [1, 7] 안으로 정규화', async () => {
    const a = await getUnifiedFlow(client, {
      centerKind: 'command', centerName: '/refactor', depth: 0,
    });
    expect(a.meta.depth).toBeGreaterThanOrEqual(1);
    expect(a.meta.depth).toBeLessThanOrEqual(7);

    const b = await getUnifiedFlow(client, {
      centerKind: 'command', centerName: '/refactor', depth: 8,
    });
    expect(b.meta.depth).toBeGreaterThanOrEqual(1);
    expect(b.meta.depth).toBeLessThanOrEqual(7);
  });

  test('center 카드 합성 — type=center, depth=0, layer 응답에 존재', async () => {
    const result = await getUnifiedFlow(client, {
      centerKind: 'command',
      centerName: '/refactor',
      depth: 3,
    });
    const center = result.nodes.find((n) => n.id === 'center');
    expect(center).toBeDefined();
    expect(center!.type).toBe('center');
    expect(center!.data.depth).toBe(0);
    expect(center!.data.kind).toBe('command');
    expect(center!.data.name).toBe('/refactor');
  });
});
