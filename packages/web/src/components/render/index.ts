/**
 * render/index.ts — render 컴포넌트 패밀리 barrel export (P2-04)
 *
 * 책임:
 *  - 구 assets/js/render/* (badges/model/cells/rows) 의 HTML-string 렌더 함수에 대응하는
 *    React 컴포넌트를 단일 진입점으로 re-export. 원본 JS 는 병존(무수정).
 *  - 골든마스터(renderers.test.ts.snap) 대상 3함수의 컴포넌트화:
 *      makeRequestRow → RequestRow
 *      makeSessionRow → SessionRow
 *      makeTargetCell → TargetCell
 *
 * SSoT 재사용:
 *  - 분류/포맷/추출/anomaly 판정은 원본 JS 모듈을 import 재사용(재구현 금지).
 *  - SVG 글리프는 동치 검증된 design-system/icons TSX 재사용.
 *
 * @module render
 */
export { TypeBadge, ToolIcon, AnomalyBadges, SlowBadge } from './badges';
export { ModelChip, ModelCell } from './model';
export { ActionBadge, TargetCell, CacheCell, targetInner } from './cells';
export { RequestRow } from './RequestRow';
export { PromptExpandRow } from './PromptExpandRow';
export { SessionRow } from './SessionRow';
