/**
 * Metrics 모듈 호환 shim.
 *
 * srp-redesign Phase 4에서 481줄짜리 metrics.ts를
 * `metrics/{types, _shared, usage, activity, timeseries, index}.ts` 6파일로 분해한 결과로,
 * 외부 import 경로(`./queries/metrics`)를 그대로 유지하기 위한 한 줄 re-export.
 *
 * 새 코드는 가능하면 `./queries/metrics/{usage|activity|timeseries}` 직접 import를 권장.
 */

export * from './metrics/index';
