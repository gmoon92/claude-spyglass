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
 * 신규 계약: data prop 주입(무전역). i18n 정밀 툴팁은 t prop(필수 — DI, 호출처가 react-i18next t 주입).
 * 셀렉터 계약 유지: id(cachePanel/cachePanelOverall/cacheHitFill/cacheHitPct/cacheRatioCreate/
 *   cacheRatioRead/cacheRatioLabel), cache-panel/cache-panel-overall/cache-section/cache-panel-label/
 *   cache-bar-wrap/cache-bar-fill/cache-bar-pct/cache-ratio-wrap/cache-ratio-creation/read/cache-ratio-label.
 *
 * DOM 구조는 cache-panel.css 와 1:1 — index.html 레거시 마크업(.cache-panel > .cache-panel-overall >
 *   .cache-section > .cache-panel-label + .cache-bar-wrap > .cache-bar-fill + .cache-bar-pct)을 그대로
 *   복원한다. (이전 평면 span 구조는 .cache-bar-wrap 트랙·.cache-section 보더가 없어 CSS 가 적용되지 않았다.)
 *   skeleton(data-skeleton) 표지는 React 마운트가 곧 실제 값으로 렌더하므로 불요(원본 dismiss 동치).
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

export interface CachePanelProps {
  data: CacheStats | null;
  t: TFunc;
}

/**
 * Cache 패널 — hit-rate 바 + creation/read 비율 바.
 * data=null 이면 미렌더(원본 renderCachePanel `if (!data) return`).
 */
export function CachePanel({ data, t }: CachePanelProps): ReactElement | null {
  if (!data) return null;
  const hr = computeHitRateView(data.hitRate);
  const ratio = computeRatioView(data.cacheCreationTokens, data.cacheReadTokens);
  const precisionTip = t('ui.cache-panel.precision-tooltip', { pct: hr.pctExact.toFixed(2) });

  return (
    <div className="cache-panel" id="cachePanel">
      <div className="cache-panel-overall" id="cachePanelOverall">
        {/* Hit Rate 섹션 */}
        <div className="cache-section" data-cache-panel-tooltip="hit-rate">
          <span className="cache-panel-label">Hit Rate</span>
          <div className="cache-bar-wrap">
            <div
              id="cacheHitFill"
              className={`cache-bar-fill ${hr.legacyToneCls} ds-bar-fill`}
              data-tone={hr.dsTone}
              style={{ width: `${hr.pct}%` }}
              title={precisionTip}
            />
          </div>
          <span className="cache-bar-pct" id="cacheHitPct" title={precisionTip}>
            {hr.labelText}
          </span>
        </div>

        {/* Creation vs Read 비율 섹션 */}
        <div className="cache-section" data-cache-panel-tooltip="ratio">
          <span className="cache-panel-label">Creation / Read</span>
          <div className="cache-ratio-wrap">
            <div
              id="cacheRatioCreate"
              className="cache-ratio-creation ds-bar-fill"
              data-tone="creation"
              style={{ width: `${ratio.createPct}%` }}
            />
            <div
              id="cacheRatioRead"
              className="cache-ratio-read ds-bar-fill"
              data-tone="read"
              style={{ width: `${ratio.readPct}%` }}
            />
          </div>
          <span className="cache-ratio-label" id="cacheRatioLabel">
            {ratio.ratioLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
