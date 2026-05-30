/**
 * @spyglass/metrics — 외부 진입점
 *
 * 옵저빌리티 지표 HTTP 라우터 + anomaly/burn-rate/cache-trend 계산기 패키지.
 * 외부(server)에서는 이 barrel만 import:
 *   import { metricsRouter } from '@spyglass/metrics';
 *   import { enrichRowWithAnomalies ... } from '@spyglass/metrics'; // (domain/anomaly-enricher 경유 심볼)
 *
 * 외부 의존: @spyglass/storage 단 하나 (read 함수 + 추론 유틸 + anomaly-thresholds).
 */

// HTTP 라우터 — 소비처: server/api.ts
export { metricsRouter } from './router';

// Anomaly 검출 도메인 심볼 — 소비처: server/domain/anomaly-enricher.ts
export {
  computeRowAnomalies,
  detectAgentSpike,
  detectAgentSpikeBatch,
  buildAgentSpikeFromBatch,
  isAgentSpikeParentCandidate,
  detectBloatedSys,
  detectContextSaturation,
  toAgentSpikeField,
  toBloatedSysField,
  toContextSaturationField,
  computeAnomalyTimeSeries,
  type AnomalyTimeSeriesRow,
  type BloatedSysStage,
  type BloatedSysResult,
  type BloatedSysField,
  type AgentSpikeStage,
  type AgentSpikeResult,
  type AgentSpikeField,
  type ContextSaturationStage,
  type ContextSaturationResult,
  type ContextSaturationField,
  type RowAnomalyStages,
  type RowAnomalyInput,
} from './calculators/anomaly';
