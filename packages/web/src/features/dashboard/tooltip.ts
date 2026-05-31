/**
 * features/dashboard/tooltip.ts — 대시보드 hover 툴팁 순수 로직 (P3-09)
 *
 * 원본: assets/js/{obs-tooltip,cache-panel-tooltip,cache-tooltip,stat-tooltip}.js.
 *  - 4종 모두 동형: 콘텐츠 키 맵(window.I18n getter) + body 직속 floating div + 전역
 *    mouseover/mousemove/mouseout 리스너 + position(e) 뷰포트 충돌 회피 산술.
 *  - 전역 document 리스너 부착(initX)은 DOM-imperative(React 포털 계층 후속) → 본 모듈은
 *    "콘텐츠 키 레지스트리"와 "위치 산술"의 순수부만 추출(테스트 가능 + 재사용).
 *
 * @module features/dashboard/tooltip
 */

/** obs-tooltip 콘텐츠 키 집합(카드4 + 카테고리4 + anomaly). 각 키는 .title/.desc i18n 키 베이스. */
export const OBS_TOOLTIP_KEYS = [
  'burn-rate',
  'cache-health',
  'live-pulse',
  'tool-categories',
  'cat-Agent',
  'cat-Skill',
  'cat-MCP',
  'cat-Native',
  'anomaly',
] as const;

/** cache-panel-tooltip 콘텐츠 키. */
export const CACHE_PANEL_TOOLTIP_KEYS = ['hit-rate', 'ratio'] as const;

/** stat-tooltip(command center strip) 콘텐츠 키. */
export const STAT_TOOLTIP_KEYS = [
  'sessions',
  'requests',
  'tokens',
  'active',
  'avg-duration',
  'p95',
  'err',
] as const;

/** stat-tooltip ctx/badge 보조 키. */
export const CTX_TOOLTIP_KEYS = ['context-growth'] as const;
export const MINI_BADGE_KEYS = ['spike', 'loop', 'slow', 'error', 'cache'] as const;

/** title/desc i18n 키 빌더 — 'ui.<ns>.<key>.title|desc'(원본 getter 규칙 SSoT). */
export function tooltipContentKeys(ns: string, key: string): { titleKey: string; descKey: string } {
  return { titleKey: `ui.${ns}.${key}.title`, descKey: `ui.${ns}.${key}.desc` };
}

export interface Viewport {
  width: number;
  height: number;
}
export interface TooltipSize {
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}

/**
 * 커서-옆 배치(원본 position): 기본 (clientX+8, clientY+12). 우/하단 넘치면 반대편.
 * obs/cache-panel/cache/stat 의 position() 공통 산술.
 */
export function positionNearCursor(
  cursor: Point,
  size: TooltipSize,
  viewport: Viewport,
): Point {
  let x = cursor.x + 8;
  let y = cursor.y + 12;
  if (x + size.width > viewport.width) x = cursor.x - size.width - 8;
  if (y + size.height > viewport.height) y = cursor.y - size.height - 8;
  return { x, y };
}

/**
 * 점 위 배치(원본 stat-tooltip positionAt): 기본 (clientX+12, clientY-th-10).
 * 좌/상/하 경계 보정. ctx-point-hover 수치 툴팁용.
 */
export function positionAbovePoint(
  cursor: Point,
  size: TooltipSize,
  viewport: Viewport,
): Point {
  let x = cursor.x + 12;
  let y = cursor.y - size.height - 10;
  if (x + size.width > viewport.width) x = cursor.x - size.width - 12;
  if (y < 4) y = cursor.y + 12;
  if (y + size.height > viewport.height) y = viewport.height - size.height - 4;
  return { x, y };
}

/** cache-tooltip read/write 토큰 파싱(원본 parseInt || 0). */
export function parseCacheTokens(readVal: unknown, writeVal: unknown): { read: number; write: number } {
  return {
    read: parseInt(String(readVal), 10) || 0,
    write: parseInt(String(writeVal), 10) || 0,
  };
}
