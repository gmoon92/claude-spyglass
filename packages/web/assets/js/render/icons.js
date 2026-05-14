/**
 * render/icons.js — 디자인 시스템 아이콘 패밀리의 호환 shim.
 *
 * 책임:
 *  - 실제 구현은 ../design-system/icons/* 에 이전됨.
 *  - 기존 호출처(`import { svgTrash } from './render/icons.js'`)가 깨지지 않도록 re-export만 한다.
 *  - 신규 코드는 직접 ../design-system/icons/_index.js 또는 개별 파일을 import.
 *
 * 이력:
 *  - Wave 0: svgTrash, svgWarn, svgRefresh 추가 (메타 모드 피드백).
 *  - Wave 1: svgSearch(D-03), svgChevron(D-04), svgError(D-11), svgInfo(D-11) 추가.
 *  - Wave 5: 전체 구현을 design-system/icons/ 로 이전, 이 파일은 shim으로 전환.
 *  - Wave 6: svgBolt(D-27 ⚡), svgRadio/svgCheck(D-28 askq ○●☐☑), svgDiamond(D-29 ◆) 추가.
 *  - Wave 8-B: svgStatusActive/Stale/Ended(세션 상태), svgToolDot/AgentDot(도구 아이콘) 추가.
 */
export { svgTrash }        from '../design-system/icons/trash.js';
export { svgWarn }         from '../design-system/icons/warn.js';
export { svgRefresh }      from '../design-system/icons/refresh.js';
export { svgSearch }       from '../design-system/icons/search.js';
export { svgChevron }      from '../design-system/icons/chevron.js';
export { svgError }        from '../design-system/icons/error.js';
export { svgInfo }         from '../design-system/icons/info.js';
export { svgNote }         from '../design-system/icons/note.js';
export { svgBolt }         from '../design-system/icons/bolt.js';
export { svgRadio }        from '../design-system/icons/radio.js';
export { svgCheck }        from '../design-system/icons/check.js';
export { svgDiamond }      from '../design-system/icons/diamond.js';
export { svgStatusActive } from '../design-system/icons/status-active.js';
export { svgStatusStale }  from '../design-system/icons/status-stale.js';
export { svgStatusEnded }  from '../design-system/icons/status-ended.js';
export { svgToolDot }      from '../design-system/icons/tool-dot.js';
export { svgAgentDot }     from '../design-system/icons/agent-dot.js';
