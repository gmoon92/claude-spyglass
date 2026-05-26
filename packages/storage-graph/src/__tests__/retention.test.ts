/**
 * retention.test.ts — `deleteOldGraphDataOnClient` 가 4개 Cypher 를 cutoff 와 함께
 * 순서대로 호출하는지, 한 단계가 실패해도 나머지가 진행되는지 검증.
 *
 * mode/circuit 게이팅(`deleteOldGraphData`) 은 외부 singleton 의존이 커서 본 파일에서
 * 검증하지 않는다 — 본 테스트는 *순수 cleanup 로직* 만 격리해서 본다.
 */

import { describe, test, expect } from 'bun:test';
import {
  deleteOldGraphDataOnClient,
  RETENTION_DELETE_STEPS,
} from '../queries/retention';

interface CallRecord {
  cypher: string;
  params: Record<string, unknown>;
}

/** 호출을 기록만 하는 가벼운 client stub. */
function makeStub(throwOnLabel?: string): {
  query: (c: string, p: Record<string, unknown>) => Promise<{ rows: []; durationMs: 0 }>;
  calls: CallRecord[];
} {
  const calls: CallRecord[] = [];
  return {
    calls,
    query: async (cypher: string, params: Record<string, unknown>) => {
      calls.push({ cypher, params });
      if (throwOnLabel) {
        const step = RETENTION_DELETE_STEPS.find((s) => s.cypher === cypher);
        if (step?.label === throwOnLabel) {
          throw new Error(`mock failure on ${throwOnLabel}`);
        }
      }
      return { rows: [] as [], durationMs: 0 as 0 };
    },
  };
}

describe('deleteOldGraphDataOnClient', () => {
  test('정상 경로: 4개 Cypher 를 정의된 순서대로 cutoff 와 함께 호출', async () => {
    const stub = makeStub();
    const cutoff = 1_700_000_000_000;
    await deleteOldGraphDataOnClient(stub as never, cutoff);
    expect(stub.calls.length).toBe(4);
    // 순서 — Event → ToolCall → Turn → Session.
    expect(stub.calls[0].cypher).toContain('(e:Event)');
    expect(stub.calls[1].cypher).toContain('(c:ToolCall)');
    expect(stub.calls[2].cypher).toContain('(t:Turn)');
    expect(stub.calls[3].cypher).toContain('(s:Session)');
    // 모든 호출이 동일 cutoff 인자 사용.
    for (const c of stub.calls) {
      expect(c.params).toEqual({ cutoff });
    }
  });

  test('모든 단계가 DETACH DELETE 사용', async () => {
    const stub = makeStub();
    await deleteOldGraphDataOnClient(stub as never, 0);
    for (const c of stub.calls) {
      expect(c.cypher).toContain('DETACH DELETE');
    }
  });

  test('MetaDocument / Agent 는 cleanup 대상에 없음 (보존 정책)', async () => {
    const stub = makeStub();
    await deleteOldGraphDataOnClient(stub as never, 0);
    const all = stub.calls.map((c) => c.cypher).join('\n');
    expect(all).not.toContain(':MetaDocument');
    expect(all).not.toContain(':Agent');
  });

  test('중간 단계 실패해도 다음 단계 진행 (부분 실패 흡수)', async () => {
    const stub = makeStub('ToolCall');
    await deleteOldGraphDataOnClient(stub as never, 0);
    // ToolCall 에서 throw 됐지만 Turn / Session 도 호출됨 = 총 4개 호출.
    expect(stub.calls.length).toBe(4);
  });

  test('cutoff=0 도 정상 처리 (호출자 책임 — 검증 없이 전달)', async () => {
    const stub = makeStub();
    await deleteOldGraphDataOnClient(stub as never, 0);
    expect(stub.calls.every((c) => c.params.cutoff === 0)).toBe(true);
  });
});

describe('RETENTION_DELETE_STEPS SoT', () => {
  test('4개 노드만 정의 — 정책과 정확히 일치', () => {
    expect(RETENTION_DELETE_STEPS.length).toBe(4);
    const labels = RETENTION_DELETE_STEPS.map((s) => s.label);
    expect(labels).toEqual(['Event', 'ToolCall', 'Turn', 'Session']);
  });

  test('모든 단계가 $cutoff 파라미터를 참조', () => {
    for (const step of RETENTION_DELETE_STEPS) {
      expect(step.cypher).toContain('$cutoff');
    }
  });
});
