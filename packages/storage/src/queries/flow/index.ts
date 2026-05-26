/**
 * Flow Chart Queries — BFS + Compression Module
 *
 * 단계적 도입:
 *  - P1: Migration 040 (VIEW 생성) + 이 디렉토리 구조 정의
 *  - P1.5: BFS 로직을 meta-document.ts → flow/bfs.ts 로 이동 (FLOW_USE_VIEW=1 시)
 *  - P2: flow/compress.ts 추가 (5개 패턴 압축 알고리즘)
 *  - P3+: 캐시 및 per-turn observations
 *
 * 내보내기:
 *  - getMetaFlowEgo: 향후 flow/bfs.ts 래퍼 (지금은 meta-document.ts 직접 호출)
 *  - getMetaFlowAggregate: 향후 flow/ 에 이동 (지금은 meta-document.ts)
 *  - MetaFlowEgo*, MetaFlowFilter: 타입 재내보내기 (meta-document.ts 에서)
 *
 * SSoT 보호:
 *  - FLOW_ACTIVE_ROW_SQL (flow/filters.ts): 절대 외부 수정 금지
 *  - ACTIVE_REQUEST_FILTER_SQL (../request/read.ts): flow/ 코드 미수정
 */

// migration-plan §B: MetaFlowEgo* 타입은 폐기 (Ladybug unified-flow 로 대체).
// MetaFlowAggregate / MetaFlowFilter 는 별도 집계 SQL 함수이므로 유지.
export type {
  MetaFlowAggregate,
  MetaFlowFilter,
} from '../meta-document';

// 흐름 전용 타입 (P2+)
export type { NodeKey, EdgeKey, PerTurnPath, EdgeOccurrence, FlowDAGNode, FlowDAGEdge } from './types';

// 필터 상수 (P1+)
export { FLOW_ACTIVE_ROW_SQL } from './filters';

// BFS 진입점 (P1.5+: meta-document.ts 에서 이동)
// export { getMetaFlowEgo } from './bfs';
// export { getMetaFlowAggregate } from './bfs';
