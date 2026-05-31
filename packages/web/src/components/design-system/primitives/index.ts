/**
 * design-system/primitives/index.ts — primitives 배럴 export (P2-02)
 *
 * 책임:
 *  - src/components/design-system/primitives/ 하위 상호작용 원시 컴포넌트 3종을 단일 진입점으로 re-export.
 *  - 구 assets/js/design-system/primitives/*.js (renderCloseBtn/renderFilterBtn/renderTab) 의
 *    React 대응물(병존, 소비처 전환은 후속 wave).
 *
 * 사용 가이드:
 *  - 동시 사용: `import { CloseButton, FilterButton, Tab } from '@/components/design-system/primitives'`
 *  - 단일: `import { Tab } from '@/components/design-system/primitives/Tab'`
 *
 * 레이어 규칙:
 *  - primitive 는 표현(마크업·접근성 속성)만 책임. i18n 라벨·상태 결정은 상위(호출처)가 주입.
 *  - onClick 등 핸들러는 prop 으로 받아 <button> 에 배선(상호작용 정책은 호출처 소유).
 *
 * @module design-system/primitives
 */
export { CloseButton, type CloseButtonProps, type CloseBtnSize } from './CloseButton';
export { FilterButton, type FilterButtonProps, type FilterStrength } from './FilterButton';
export { Tab, type TabProps } from './Tab';
