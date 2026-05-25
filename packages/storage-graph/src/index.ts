/**
 * @spyglass/storage-graph — Public Barrel Export
 *
 * 책임 (Single Responsibility):
 *   SQLite를 SSoT(source of truth)로 두고, 그 위에 **읽기 전용 그래프 projection**을
 *   구축하기 위한 모든 진입점을 한 곳에서 노출한다. 이 패키지는 절대 SQLite에
 *   write하지 않으며, 그래프 DB(LadybugDB) 파일은 언제든 삭제해도 안전한
 *   throw-away cache로만 취급한다.
 *
 * 의존성:
 *   - @spyglass/storage  — SQLite Database 인스턴스, 마이그레이션 시스템.
 *   - @spyglass/types    — 도메인 공유 타입.
 *   - @ladybugdb/core    — LadybugDB native binding (devDependency, lazy import).
 *
 * 호출 흐름 (server 부팅 기준):
 *   1) server `runtime/lifecycle.ts`가 부팅 직후 `startGraphSyncWorker()` 호출.
 *   2) Worker는 `runtime/flag.ts`의 mode가 'off'면 즉시 no-op으로 종료(완전 dormant).
 *   3) mode가 shadow/primary면 `client.connect()`로 Ladybug를 lazy load,
 *      `schema/apply.ts`로 DDL을 idempotent하게 적용한 뒤 200ms 틱 시작.
 *   4) API 라우터(`server/routes/graph.ts`)는 요청마다 `flag.mode`를 보고 SQLite/Graph
 *      경로를 분기하며, 어떤 단계든 실패하면 `circuit-breaker`가 회로를 OPEN으로
 *      전이시키고 다음 요청부터 SQLite-only 폴백.
 *
 * 비범위:
 *   - SQLite 데이터 변경 (영구히 read-only로 접근)
 *   - macOS code signing / notarization
 *   - 새 UI (React Flow 등은 별도 PR)
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/.tmp/plans/spyglass/graph-db-research/00-FINAL-INTEGRATED-REPORT.md
 *   본 패키지의 도입 배경과 Tier 2 운영 전략.
 */

// =============================================================================
// Runtime — feature flag, circuit breaker, paths
// =============================================================================

export {
  getGraphMode,
  setGraphMode,            // 런타임 setter — 영속화는 호출 측 (saveServerConfig 별도) 책임
  getGraphModeSource,      // 'env' | 'file' | 'default' — UI 가 사용자에게 출처 노출
  refreshGraphModeFromFile,// 부팅 lifecycle 가 await — file source 평가
  isGraphEnabled,
  resetGraphModeCache,     // 테스트 전용
  type GraphMode,          // type-only export — ESM runtime 가 value 로 오해하지 않도록 명시.
  type GraphModeSource,    // type-only export
} from './runtime/flag';

// PR 1 영속화 — server-config.json SSoT.
//   다른 영속 설정 (port, plugin enabled 등) 도 향후 본 파일에 통합 예정.
export {
  loadServerConfig,
  saveServerConfig,
  getServerConfigPath,
  getServerConfigTmpDir,
  SERVER_CONFIG_VERSION,
  type ServerConfig,
} from './runtime/config-file';

export {
  CircuitBreaker,
  getCircuitBreaker,
  resetCircuitBreaker, // 테스트 전용
  type CircuitState,
} from './runtime/circuit-breaker';

export {
  getGraphDir,
  getGraphDbPath,
  getSyncStatePath,
  getGraphReadmePath,
} from './runtime/paths';

// =============================================================================
// Client + Schema
// =============================================================================

export {
  LadybugClient,
  LadybugUnavailableError,
  getLadybugClient,
  closeLadybugClient,
  type LadybugQueryResult,
} from './client';

export { SCHEMA_VERSION, NODE_TABLES, REL_TABLES } from './schema/ddl';
export { applySchema, throwAwayAndRebuild } from './schema/apply';

// =============================================================================
// Sync Worker — 200ms outbox 폴링
// =============================================================================

export {
  startGraphSyncWorker,
  stopGraphSyncWorker,
  getSyncWorkerStatus,
  type SyncWorkerStatus,
} from './sync/worker';

// =============================================================================
// Queries — 첫 hook (Flow BFS) + Sequential Flow + Kahn topological sort
// =============================================================================

export {
  bfsTurnsNear,
  type FlowBfsParams,
  type FlowBfsResult,
} from './queries/flow-bfs';

export {
  getSequentialFlow,
  type SequentialFlowParams,
  type SequentialFlowResult,
  type SequentialNode,
  type SequentialEdge,
  type MetaDocKind,
} from './queries/sequential-flow';

export {
  topologicalLayers,
  type TopologicalInput,
  type TopologicalResult,
  type SortableNode,
  type SortableEdge,
} from './queries/topological-sort';
