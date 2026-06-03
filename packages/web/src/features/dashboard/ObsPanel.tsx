/**
 * features/dashboard/ObsPanel.tsx — Observability 좌측 사이드바 4 카드 + Anomaly Badge (P3-09)
 *
 * 원본: assets/js/obs-panel.js renderBurnRate/renderCacheHealth/renderLivePulse/
 *       renderToolCategoriesCard/renderAnomalyBadge (ADR-005/008).
 *  - 원본은 document.getElementById(card) + el.innerHTML 로 그렸다(innerHTML 12 사이트).
 *  - 본 컴포넌트는 동일 마크업(클래스/구조)을 JSX 로 렌더. 분기/산술은 obs-card-data.ts(순수).
 *
 * 신규 계약(데이터 역전 — P3-01/P3-03 동형):
 *  - payload 만 prop 으로 주입(원본 호출처 main.js 가 dispatch). 무전역·무스토어 leaf.
 *  - delta 트렌드 아이콘은 P2-01 Chevron 컴포넌트 재사용(원본 svgChevron).
 *  - sparkline 은 P3-09 Sparkline.tsx 재사용(원본 sparklineBars/Line).
 *  - i18n: t prop 주입(필수 — DI). 호출처(BrowseSidebar)가 useTranslation t 주입, 테스트가 stub 주입.
 *    키 미스 전역 폴백은 lib/i18n.ts parseMissingKeyHandler 가 담당(window.I18n 직접참조 제거 — D-1).
 *  - 토큰/숫자/상대시각 포맷은 원본 formatters.js(병존) 재사용 — 표기 동치.
 *  - 셀렉터 계약 유지: 카드 id(cardBurnRate/cardCacheHealth/cardLivePulse/cardToolCategories),
 *    anomalyBadge, obs-card-* / obs-cat-* / anomaly-badge-* 클래스(향후 CSS/E2E 호환).
 *
 * @module features/dashboard/ObsPanel
 */
import type { ReactElement } from 'react';
import { fmt, fmtToken, fmtRelative } from '../../lib/formatters';
import { Chevron } from '../../components/design-system/icons/Chevron';
import { SparklineBars, SparklineLine } from './Sparkline';
import {
  isBurnRateEmpty,
  burnRateSeries,
  classifyDelta,
  isCacheHealthEmpty,
  cacheHealthTrendCls,
  isLivePulseEmpty,
  computeToolCategories,
  computeAnomalyBadge,
  type BurnRatePayload,
  type CacheHealthPayload,
  type LivePulsePayload,
  type ToolCategoriesPayload,
  type ToolCategoriesMode,
  type AnomalyPayload,
  type DeltaView,
} from './obs-card-data';

/** i18n 라벨러 — react-i18next t / 테스트 stub 공통 시그니처(필수 prop, DI). */
export type TFunc = (key: string, vars?: Record<string, unknown>) => string;

const SPARK_W = 76;
const SPARK_H = 24;

/** 트렌드 표지(deltaIconHtml 동치) — flat 이면 '—', 아니면 Chevron + 표기. */
function DeltaTrend({ delta }: { delta: DeltaView }): ReactElement {
  if (delta.tone === 'flat') {
    return <span className="obs-card-trend">—</span>;
  }
  return (
    <span className={`obs-card-trend ${delta.cls}`}>
      <span className="obs-card-trend-icon" aria-hidden="true">
        <Chevron dir={delta.dir ?? 'up'} size={10} />
      </span>
      {delta.text}
    </span>
  );
}

/** 빈 상태 — dim 텍스트 한 줄(원본 emptyCard). */
function EmptyCard({ message }: { message: string }): ReactElement {
  return <span className="obs-card-empty">{message}</span>;
}

// ── W1. Burn Rate ─────────────────────────────────────────────────────────────
export function BurnRateCard({
  payload,
  t,
}: {
  payload: BurnRatePayload | null;
  t: TFunc;
}): ReactElement {
  if (isBurnRateEmpty(payload)) {
    return (
      <div className="obs-card" id="cardBurnRate">
        <EmptyCard message={t('ui.obs-panel.no-data')} />
      </div>
    );
  }
  const p = payload as BurnRatePayload;
  const values = burnRateSeries(p);
  const total = p.current_total || 0;
  const sub =
    (p.yesterday_same_window ?? 0) > 0
      ? t('ui.obs-panel.yesterday', { val: fmtToken(p.yesterday_same_window) })
      : '';
  return (
    <div className="obs-card" id="cardBurnRate">
      <span className="obs-card-value">{fmtToken(total)}</span>
      <DeltaTrend delta={classifyDelta(p.delta_pct)} />
      <span className="obs-card-sub">{sub}</span>
      <span className="obs-card-spark">
        <SparklineBars values={values} width={SPARK_W} height={SPARK_H} />
      </span>
    </div>
  );
}

// ── W2. Cache Health ──────────────────────────────────────────────────────────
export function CacheHealthCard({
  payload,
  t,
}: {
  payload: CacheHealthPayload | null;
  t: TFunc;
}): ReactElement {
  if (isCacheHealthEmpty(payload)) {
    return (
      <div className="obs-card" id="cardCacheHealth">
        <EmptyCard message={t('ui.obs-panel.no-cache')} />
      </div>
    );
  }
  const p = payload as CacheHealthPayload;
  const hitPct = ((p.hit_rate_now as number) * 100).toFixed(1);
  const series = (p.buckets ?? []).map((b) => b.hit_rate ?? null);
  const sub = t('ui.obs-panel.savings', { val: fmtToken(p.savings_tokens_total || 0) });
  const trendCls = cacheHealthTrendCls(p.hit_rate_now as number);
  return (
    <div className="obs-card" id="cardCacheHealth">
      <span className="obs-card-value">{hitPct}%</span>
      <span className={`obs-card-trend ${trendCls}`}>
        <span className="obs-card-trend-icon">●</span>
      </span>
      <span className="obs-card-sub">{sub}</span>
      <span className="obs-card-spark">
        <SparklineLine values={series} width={SPARK_W} height={SPARK_H} />
      </span>
    </div>
  );
}

// ── W3. Live Pulse ────────────────────────────────────────────────────────────
export function LivePulseCard({
  payload,
  t,
}: {
  payload: LivePulsePayload | null;
  t: TFunc;
}): ReactElement {
  if (isLivePulseEmpty(payload)) {
    return (
      <div className="obs-card" id="cardLivePulse">
        <EmptyCard message={t('ui.obs-panel.no-activity')} />
      </div>
    );
  }
  const p = payload as LivePulsePayload;
  const lastTxt = p.last_event_ts ? fmtRelative(p.last_event_ts) : '—';
  const series = Array.isArray(p.recent_calls) ? p.recent_calls : [];
  return (
    <div className="obs-card" id="cardLivePulse">
      <span className="obs-card-value">{lastTxt}</span>
      <span className={`obs-card-trend ${(p.active_count ?? 0) > 0 ? 'is-up' : ''}`}>
        <span className="obs-card-trend-icon">●</span>
        {fmt(p.active_count || 0)}
      </span>
      <span className="obs-card-sub">{t('ui.obs-panel.recent-activity')}</span>
      <span className="obs-card-spark">
        <SparklineBars values={series} width={SPARK_W} height={SPARK_H} />
      </span>
    </div>
  );
}

// ── W4. Tool Categories ───────────────────────────────────────────────────────
export function ToolCategoriesCard({
  payload,
  mode = 'default',
  t,
}: {
  payload: ToolCategoriesPayload;
  mode?: ToolCategoriesMode;
  t: TFunc;
}): ReactElement | null {
  const view = computeToolCategories(payload, mode);
  // 'suppressed' — meta-docs 모드에서 배열 payload 도착 → 렌더 변경 없음(원본 early return).
  if (view.kind === 'suppressed') return null;
  if (view.kind === 'empty') {
    return (
      <div className="obs-card" id="cardToolCategories">
        <EmptyCard message={t(view.messageKey)} />
      </div>
    );
  }
  if (view.kind === 'meta-docs') {
    return (
      <div className="obs-card" id="cardToolCategories">
        <div className="obs-card-tools obs-card-meta-docs">
          {view.rows.map((r, i) => (
            <div className="obs-meta-row" key={i}>
              <span className="obs-meta-name" title={r.name}>
                {r.name}
              </span>
              <div className="obs-cat-bar">
                <span
                  className="obs-cat-bar-fill obs-cat-bar-fill--agent ds-bar-fill"
                  data-tone="warn"
                  style={{ width: `${r.pct}%` }}
                />
              </div>
              <span className="obs-cat-pct">{r.invocations}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  // kind === 'default'
  return (
    <div className="obs-card" id="cardToolCategories">
      <div className="obs-card-tools">
        {view.rows.map((r, i) => (
          <div className="obs-cat-row" data-obs-tooltip={r.tooltipKey} key={i}>
            <span className="obs-cat-name">{r.category}</span>
            <div className="obs-cat-bar">
              <span
                className={`obs-cat-bar-fill obs-cat-bar-fill--${r.cls} ds-bar-fill`}
                data-tone={r.dsTone}
                style={{ width: `${r.pct}%` }}
              />
            </div>
            <span className="obs-cat-pct">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Anomaly Badge ─────────────────────────────────────────────────────────────
export function AnomalyBadge({ payload }: { payload: AnomalyPayload | null }): ReactElement {
  const view = computeAnomalyBadge(payload);
  if (!view.visible) {
    return <div id="anomalyBadge" hidden />;
  }
  return (
    <div id="anomalyBadge" data-obs-tooltip="anomaly">
      <span
        className="anomaly-badge-dot ds-dot"
        data-tone="pulse"
        data-size="sm"
        aria-hidden="true"
      />
      <span className="anomaly-badge-count">{fmt(view.total)}</span>
    </div>
  );
}
