/**
 * design-system/badges/index.ts — badges 배럴 export (P2-03)
 *
 * 책임:
 *  - src/components/design-system/badges/ 하위 Badge 컴포넌트를 단일 진입점으로 re-export.
 *  - 구 assets/js/design-system/badges/badge.js (renderBadge) 의 React 대응물(병존).
 *
 * 사용 가이드:
 *  - `import { Badge } from '@/components/design-system/badges'`
 *
 * @module design-system/badges
 */
export { Badge, type BadgeProps, type BadgeTone } from './Badge';
