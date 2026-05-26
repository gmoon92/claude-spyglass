/**
 * Flow DAG Types — 5개 패턴 압축용 신규 타입 (P2 이후 사용)
 *
 * 현재(P1) 사용: 없음. P2 이후: Bypass / Conditional Branching / Shared Critic / Retry / Fan-out.
 *
 * 변경 이력 (migration-plan §B): MetaFlowEgoNodeKind 의존성을 제거하고 로컬 alias 로 대체.
 *   Ladybug 통합 unified-flow 쪽에는 MetaDocKind 가 SSoT (storage-graph 패키지 export).
 */

/** 메타 문서 노드 카테고리 — storage-graph 의 MetaDocKind 와 동일 어휘. */
type MetaFlowEgoNodeKind = 'command' | 'skill' | 'agent' | 'tool' | 'mcp';

/** 노드 정체성 — 고유한 (kind, name) 쌍. */
export type NodeKey = `${MetaFlowEgoNodeKind}:${string}`;

/** 엣지 정체성 — (fromKey, toKey, relation) 3-튜플. */
export type EdgeKey = `${NodeKey}|${NodeKey}|${'call' | 'turn-flow'}`;

/** 같은 turn 내 호출 경로 — 향후 다이아몬드 압축에 사용. */
export interface PerTurnPath {
  turnId: string;
  childPaths: NodeKey[][];  // turn 내 parent→child 경로들
  parentPaths: NodeKey[][];  // turn 내 child←parent 역경로들
}

/** 엣지 발생 빈도 및 성공률 — 향후 outcome 필드 채우기에 사용. */
export interface EdgeOccurrence {
  fromKey: NodeKey;
  toKey: NodeKey;
  relation: 'call' | 'turn-flow';
  turnSet: ReadonlySet<string>;
  count: number;
  outcome?: 'success' | 'fail' | 'mixed' | 'unknown';
}

/** 향후 P2 압축 결과 — 현재 MetaFlowEgo와 호환이지만 더 풍부한 메타. */
export interface FlowDAGNode {
  kind: MetaFlowEgoNodeKind;
  name: string;
  depth: number;
  timeline: 'after' | null;
  count: number;
  pct: number;
  // P2 추가 필드
  retries?: number;          // 같은 턴에서 2회 이상 호출
  outcome?: 'success' | 'fail' | 'mixed' | 'unknown';
}

export interface FlowDAGEdge {
  fromKind: MetaFlowEgoNodeKind;
  fromName: string;
  toKind: MetaFlowEgoNodeKind;
  toName: string;
  relation: 'call' | 'turn-flow';
  count: number;
  // P2 추가 필드
  optionality?: 'always' | 'sometimes' | 'bypass';
}
