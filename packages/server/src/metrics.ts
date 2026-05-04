/**
 * metrics 모듈 호환 shim.
 *
 * srp-redesign Phase 3에서 561줄짜리 metrics.ts를
 * `metrics/{_shared, router, calculators/*}.ts` 5파일로 분해한 결과로,
 * 외부 import 경로(`./metrics`)를 그대로 유지하기 위한 한 줄 re-export.
 *
 * 새 코드는 가능하면 `./metrics/router` 직접 import를 권장.
 */

export { metricsRouter } from './metrics/router';
