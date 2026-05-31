/**
 * design-system/chips/index.ts — chips 배럴 export (P2-03)
 *
 * 책임:
 *  - src/components/design-system/chips/ 하위 Chip 컴포넌트를 단일 진입점으로 re-export.
 *  - 구 assets/js/design-system/chips/chip.js (renderChip) 의 React 대응물(병존).
 *
 * 사용 가이드:
 *  - `import { Chip } from '@/components/design-system/chips'`
 *
 * @module design-system/chips
 */
export { Chip, type ChipProps, type ChipTone } from './Chip';
