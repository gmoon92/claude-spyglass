/**
 * features/dashboard/CachePanel.tsx — Cache Intelligence Panel (Hit Rate + Creation/Read 비율) (P3-09)
 *
 * 원본: assets/js/cache-panel.js renderCachePanel.
 *  - 원본은 #cacheHitFill/#cacheHitPct/#cacheRatioCreate/#cacheRatioRead/#cacheRatioLabel 를
 *    getElementById 로 찾아 style.width/className/textContent 를 직접 변형하고, skeleton 표지를
 *    제거(dismissCachePanelSkeleton)했다.
 *  - 본 컴포넌트는 동일 바 구조를 JSX 로 렌더(컨트롤드). 산술/경계/톤은 cache-stats.ts(순수).
 *    skeleton dismiss(초기 깜빡임 제거)는 React 마운트가 곧 실제 값으로 렌더하므로 불요.
 *
 * 신규 계약: data prop 주입(무전역). i18n 정밀 툴팁은 t prop(기본 window.I18n.t).
 * 셀렉터 계약 유지: id(cacheHitFill/cacheHitPct/cacheRatioCreate/cacheRatioRead/cacheRatioLabel),
 *   cache-bar-fill/ds-bar-fill/data-tone, cache-ratio-creation/read.
 *
 * @module features/dashboard/CachePanel
 */
import type { ReactElement } from 'react';
import {
  computeHitRateView,
  computeRatioView,
  type CacheStats,
} from './cache-stats';

export type TFunc = (key: string, vars?: Record<string, unknown>) => string;
declare const window: { I18n?: { t?: TFunc } };
const defaultT: TFunc = (k, vars) => window.I18n?.t?.(k, vars) ?? k;

export interface CachePanelProps {
  data: CacheStats | null;
  t?: TFunc;
}

/**
 * Cache 패널 — hit-rate 바 + creation/read 비율 바.
 * data=null 이면 미렌더(원본 renderCachePanel `if (!data) return`).
 */
export function CachePanel({ data, t = defaultT }: CachePanelProps): ReactElement | null {
  if (!data) return null;
  const hr = computeHitRateView(data.hitRate);
  const ratio = computeRatioView(data.cacheCreationTokens, data.cacheReadTokens);
  const precisionTip = t('ui.cache-panel.precision-tooltip', { pct: hr.pctExact.toFixed(2) });

  return (
    <div id="cachePanel">
      {/* Hit Rate 바 */}
      <span
        id="cacheHitFill"
        className={`cache-bar-fill ${hr.legacyToneCls} ds-bar-fill`}
        data-tone={hr.dsTone}
        style={{ width: `${hr.pct}%` }}
        title={precisionTip}
      />
      <span id="cacheHitPct" title={precisionTip}>
        {hr.labelText}
      </span>

      {/* Creation vs Read 비율 바 */}
      <span
        id="cacheRatioCreate"
        className="ds-bar-fill"
        data-tone="creation"
        style={{ width: `${ratio.createPct}%` }}
      />
      <span
        id="cacheRatioRead"
        className="ds-bar-fill"
        data-tone="read"
        style={{ width: `${ratio.readPct}%` }}
      />
      <span id="cacheRatioLabel">{ratio.ratioLabel}</span>
    </div>
  );
}
