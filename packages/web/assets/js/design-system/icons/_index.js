/**
 * design-system/icons/_index.js — 아이콘 패밀리 barrel export
 *
 * 책임:
 *  - design-system/icons/ 하위 8개 아이콘 모듈을 단일 진입점으로 묶어 re-export.
 *  - 신규 코드는 이 파일 또는 개별 아이콘 파일을 직접 import.
 *  - 기존 호출처(render/icons.js shim)는 개별 파일을 직접 참조하므로 이 barrel은 선택적 편의 진입점.
 *
 * 사용 가이드:
 *  - 여러 아이콘을 동시에 쓸 때: `import { svgTrash, svgWarn } from '../design-system/icons/_index.js'`
 *  - 단일 아이콘만 쓸 때: `import { svgNote } from '../design-system/icons/note.js'`
 *
 * 디자인 패밀리:
 *  - 모든 아이콘은 stroke-only currentColor 패턴을 따름.
 *  - viewBox와 기본 size는 아이콘별 개별 파일 참조.
 *
 * @module design-system/icons
 */

export { svgTrash }        from './trash.js';
export { svgWarn }         from './warn.js';
export { svgRefresh }      from './refresh.js';
export { svgSearch }       from './search.js';
export { svgChevron }      from './chevron.js';
export { svgError }        from './error.js';
export { svgInfo }         from './info.js';
export { svgNote }         from './note.js';
export { svgBolt }         from './bolt.js';
export { svgRadio }        from './radio.js';
export { svgCheck }        from './check.js';
export { svgDiamond }      from './diamond.js';
export { svgStatusActive } from './status-active.js';
export { svgStatusStale }  from './status-stale.js';
export { svgStatusEnded }  from './status-ended.js';
export { svgToolDot }      from './tool-dot.js';
export { svgAgentDot }     from './agent-dot.js';
export { svgSkillDot }     from './skill-dot.js';
