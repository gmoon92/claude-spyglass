/**
 * unified-flow-sequential.test.ts — cohort 타임라인 순차 DAG 복원 검증
 *
 * 검증 목표 (지시서 §2 + plan Step 1a):
 *   1. 중간 로우레벨 도구(bash/read/write)는 흐름도에서 제외(USES 없음 → 원천 필터).
 *   2. 남은 상위 메타 노드는 타임라인 인접 순서로 연결(경로 압축):
 *        agent(pm) → mcp(redmine) → skill(commit) → skill(notify)
 *   3. center 직결 스타 토폴로지가 아님 (center outdegree == 1).
 *   4. 인접쌍 빈도가 엣지 strength 로 환산됨.
 *
 * 격리: createMockClient() 인메모리 — 파일/포트/싱글톤 없음, 파일 병렬 안전.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { getUnifiedFlow } from '../queries/unified-flow';
import { createMockClient, seedSetD, seedSetDFrequency } from './seed-mocks';

const CENTER = { centerKind: 'agent', centerName: 'pm' } as const;

describe('Unified Flow Sequential — Set D (단일 trace 경로 압축)', () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    seedSetD(client);
  });

  test('center(pm) 시드가 존재', async () => {
    const r = await getUnifiedFlow(client, { ...CENTER, depth: 30 });
    expect(r.meta.seedCount).toBeGreaterThan(0);
    const center = r.nodes.find((n) => n.id === 'center');
    expect(center).toBeDefined();
    expect(center!.type).toBe('center');
    expect(center!.data.depth).toBe(0);
  });

  test('hidden 도구(bash/read/write)는 노드로 등장하지 않음', async () => {
    const r = await getUnifiedFlow(client, { ...CENTER, depth: 30 });
    const names = r.nodes.map((n) => `${n.data.kind}::${n.data.name}`);
    expect(names.some((n) => /bash|read|write/i.test(n))).toBe(false);
    // 상위 메타 노드만 — mcp / commit / notify.
    expect(r.nodes.some((n) => n.data.kind === 'mcp')).toBe(true);
    expect(r.nodes.some((n) => n.data.kind === 'skill' && n.data.name === 'commit')).toBe(true);
    expect(r.nodes.some((n) => n.data.kind === 'skill' && n.data.name === 'notify')).toBe(true);
  });

  test('엣지가 타임라인 순차 체인 — center 직결 스타가 아님', async () => {
    const r = await getUnifiedFlow(client, { ...CENTER, depth: 30 });

    const idOf = (kind: string, name: string) =>
      kind === CENTER.centerKind && name === CENTER.centerName ? 'center' : `${kind}::${name}`;
    const mcp = idOf('mcp', 'mcp__redmine__create_issue');
    const commit = idOf('skill', 'commit');
    const notify = idOf('skill', 'notify');

    const pairs = new Set(r.edges.map((e) => `${e.source}->${e.target}`));
    // 기대 인접쌍.
    expect(pairs.has(`center->${mcp}`)).toBe(true);
    expect(pairs.has(`${mcp}->${commit}`)).toBe(true);
    expect(pairs.has(`${commit}->${notify}`)).toBe(true);

    // 스타 금지: center 가 commit/notify 로 직결되면 안 됨.
    expect(pairs.has(`center->${commit}`)).toBe(false);
    expect(pairs.has(`center->${notify}`)).toBe(false);

    // center outdegree == 1 (mcp 로만).
    const centerOut = r.edges.filter((e) => e.source === 'center');
    expect(centerOut).toHaveLength(1);
    expect(centerOut[0].target).toBe(mcp);
  });

  test('컬럼/depth 가 타임라인 순서로 단조 증가 (mcp < commit < notify)', async () => {
    const r = await getUnifiedFlow(client, { ...CENTER, depth: 30 });
    const depthOf = (kind: string, name: string) =>
      r.nodes.find((n) => n.data.kind === kind && n.data.name === name)!.data.depth;
    const dMcp = depthOf('mcp', 'mcp__redmine__create_issue');
    const dCommit = depthOf('skill', 'commit');
    const dNotify = depthOf('skill', 'notify');
    expect(dMcp).toBeGreaterThan(0); // center(0) 이후
    expect(dCommit).toBeGreaterThan(dMcp);
    expect(dNotify).toBeGreaterThan(dCommit);
  });
});

describe('Unified Flow Sequential — Set D-Frequency (인접쌍 빈도 → strength)', () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    seedSetDFrequency(client);
  });

  test('자주 등장하는 인접쌍(commit→notify, 4/4)이 드문 쌍(pm→mcp, 1/4)보다 강함', async () => {
    const r = await getUnifiedFlow(client, { ...CENTER, depth: 30 });

    const commit = 'skill::commit';
    const notify = 'skill::notify';
    const mcp = 'mcp::mcp__redmine__create_issue';

    const edge = (src: string, tgt: string) =>
      r.edges.find((e) => e.source === src && e.target === tgt);

    const commitNotify = edge(commit, notify);
    const pmMcp = edge('center', mcp);

    expect(commitNotify).toBeDefined();
    expect(pmMcp).toBeDefined();

    const rank = { sparse: 0, weak: 1, medium: 2, strong: 3 } as const;
    expect(commitNotify!.strength).toBe('strong'); // 4/4
    expect(rank[commitNotify!.strength!]).toBeGreaterThan(rank[pmMcp!.strength!]);
  });
});
