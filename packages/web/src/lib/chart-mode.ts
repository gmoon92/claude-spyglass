/**
 * lib/chart-mode.ts — 도넛/차트 모드 SSoT (P3-01)
 *
 * 원본: assets/js/chart.js donutMode 모듈 변수 + views/default/chart-policy.js setChartMode 의
 *   모드 매핑(default→model, detail→cache).
 *
 * lib/ universal leaf(architecture.md §1.3) 로 승격 — stores(donutMode 슬라이스)와
 *   components/Chart(prop) 양쪽이 동일 타입/매핑을 공유하되, components→stores 역참조를
 *   만들지 않기 위함(rule 1,3). 모드 타입 SSoT 를 한 곳에 둔다.
 *
 * @module lib/chart-mode
 */

/** 도넛 모드 — 'type'(요청 타입 분포) | 'model'(모델 분포) | 'cache'(캐시 퍼포먼스). */
export type DonutMode = 'type' | 'model' | 'cache';

/** 차트 섹션 모드 — chart-policy.js setChartMode 인자(default/detail). */
export type ChartMode = 'default' | 'detail';

/** 유효 도넛 모드 집합(스토어 setDonutMode 가드 SSoT). */
export const DONUT_MODES: readonly DonutMode[] = ['type', 'model', 'cache'];

/**
 * 차트 섹션 모드 → 도넛 모드 매핑(chart-policy.js setChartMode SSoT).
 *   - 'default' 진입 → 'model'(모델 분포 노출)
 *   - 'detail'  진입 → 'cache'(캐시 퍼포먼스 — ADR-WDO-010)
 */
export function chartModeToDonutMode(mode: ChartMode): DonutMode {
  return mode === 'detail' ? 'cache' : 'model';
}
