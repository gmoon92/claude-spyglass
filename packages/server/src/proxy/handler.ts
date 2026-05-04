/**
 * proxy/handler 모듈 호환 shim.
 *
 * srp-redesign Phase 8: 600줄 handler.ts를 handler/{index, _shared, inbound,
 * stream, non-stream, persist, broadcast, diag}.ts 8파일로 분해. import 경로 보존용.
 *
 * 새 코드는 `./handler/index` 직접 import 권장.
 */
export { handleProxy } from './handler/index';
