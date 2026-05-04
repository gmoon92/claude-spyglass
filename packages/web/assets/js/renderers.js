// renderers.js — 호환 shim (srp-redesign Phase 5).
//
// 671줄짜리 단일 파일을 변경 이유별로 render/* 6파일로 분해한 결과,
// 외부 import 경로(`./renderers.js`)를 그대로 유지하기 위한 re-export 한 줄.
//
// 새 코드는 가능하면 `./render/{badges|model|cells|extract|expand|rows}.js`
// 로 직접 import 하는 것을 권장 (필요한 도메인만 선택적으로 가져오기 위함).

export * from './render/badges.js';
export * from './render/model.js';
export * from './render/cells.js';
export * from './render/extract.js';
export * from './render/expand.js';
export * from './render/rows.js';
