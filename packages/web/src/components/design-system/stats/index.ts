/**
 * design-system/stats/index.ts — stats 배럴 export (P2-03)
 *
 * 책임:
 *  - src/components/design-system/stats/ 하위 Bar 컴포넌트를 단일 진입점으로 re-export.
 *  - 구 assets/js/design-system/stats/bar.js (renderBar) 의 React 대응물(병존).
 *
 * 사용 가이드:
 *  - `import { Bar } from '@/components/design-system/stats'`
 *
 * @module design-system/stats
 */
export { Bar, type BarProps, type BarTone } from './Bar';
