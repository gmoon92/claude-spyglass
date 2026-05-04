/**
 * Request 모듈 호환 shim.
 *
 * 이 파일은 srp-redesign Phase 1A에서 1165줄짜리 request.ts를
 * `request/{read, write, aggregate, turn, index}.ts` 5파일로 분해한 결과로,
 * 외부 import 경로(`./request`)를 그대로 유지하기 위한 한 줄 re-export.
 *
 * 새 코드는 가능하면 `./request/{read|write|aggregate|turn}` 직접 import를 권장.
 */

export * from './request/index';
