/**
 * design-system/markers/index.ts — markers 배럴 export (P2-03)
 *
 * 책임:
 *  - src/components/design-system/markers/ 하위 마커 컴포넌트 2종을 단일 진입점으로 re-export.
 *  - 구 assets/js/design-system/markers/*.js (renderDot/renderSortHead) 의
 *    React 대응물(병존, 소비처 전환은 후속 wave).
 *
 * 사용 가이드:
 *  - 동시 사용: `import { Dot, SortHead } from '@/components/design-system/markers'`
 *  - 단일: `import { Dot } from '@/components/design-system/markers/Dot'`
 *
 * @module design-system/markers
 */
export { Dot, type DotProps, type DotTone, type DotSize } from './Dot';
export { SortHead, type SortHeadProps, type SortState } from './SortHead';
