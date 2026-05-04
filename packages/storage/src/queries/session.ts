/**
 * Session 모듈 호환 shim.
 *
 * srp-redesign Phase 9: 458줄 session.ts를 session/{index, types, _shared,
 * read, write, retention, aggregate}.ts 7파일로 분해. import 경로 보존용.
 *
 * 새 코드는 `./session/index` 직접 import 권장.
 */
export * from './session/index';
