/**
 * render/anomaly-badges.tsx — anomaly 배지 React 컴포넌트 (B-2)
 *
 * 원본: assets/js/render/badges.js 의 HTML-string producer
 *   (bloatedSysBadge{Mini,Full,Dot}Html / contextSaturationBadgeFullHtml /
 *    agentSpikeBadgeHtml / turnSpikeSummaryHtml + _spikeSparklineSvg).
 *
 * 정공법(SSoT 이중화 금지):
 *  - 노출 여부·stage·pct·tone·n 판정은 lib/anomaly-field.ts(순수 SSoT) 가 단독 담당.
 *  - 라벨은 useTranslation 의 t 가 동일 i18n 키로 해석(원본 window.I18n.t 와 같은 키 문자열).
 *  - 마크업은 원본 span class / data-tone / data-*-stage / title / aria-label 을 1:1 재현
 *    (badges.css·tooltip·점멸 애니메이션 회귀 방지).
 *
 * 골든마스터: anomaly-badges-equivalence.test.tsx 가 React 출력을 원본 vanilla HTML 과
 *  정규화 후 동치(toMatchSnapshot)로 고정 — vanilla producer 제거 전 회귀 가드.
 *
 * @module render/anomaly-badges
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  bloatedSysInfo,
  contextSaturationInfo,
  agentSpikeInfo,
} from '../../lib/anomaly-field';

/** i18n 번역 함수 시그니처 — JSX/함수 양쪽 호출을 위해 prop 주입도 허용. */
type TFn = (key: string, vars?: Record<string, unknown>) => string;

/**
 * bloated-sys 배지 — variant: mini(첫 prompt 행) / full(세션 헤더) / dot(사이드바, critical 만).
 * 원본 _bloatedBadge 의 variant 분기 1:1.
 */
export function BloatedSysBadge({
  bloatedSys,
  variant,
  t: tProp,
}: {
  bloatedSys: unknown;
  variant: 'mini' | 'full' | 'dot';
  /** 함수 호출 컨텍스트(SessionRow 처럼 plain 함수로 호출)에서 t 직접 주입. 미주입 시 useTranslation. */
  t?: TFn;
}): ReactElement | null {
  const hook = useTranslation();
  const t: TFn = tProp ?? hook.t;
  const info = bloatedSysInfo(bloatedSys);
  if (!info) return null;
  // dot 은 critical 만 노출(ADR-005) — 원본 bloatedSysBadgeDotHtml 의 stage gate.
  if (variant === 'dot' && info.stage !== 'critical') return null;

  const { stage, pct, tone, stageCls, i18nBase } = info;
  const tooltip = t(`${i18nBase}.tooltip`, { pct });
  const action = t(`${i18nBase}.modal`, { pct });
  const fullTip = `${tooltip} · ${action}`;

  if (variant === 'dot') {
    return (
      <span
        className={`badge-bloated-sys badge-bloated-sys--dot${stageCls} ds-dot`}
        data-tone={tone}
        data-bloated-sys-stage={stage}
        title={fullTip}
        aria-label={fullTip}
      />
    );
  }
  const label = t(`${i18nBase}.label`, { pct });
  const cls = variant === 'full' ? 'badge-bloated-sys--full' : 'badge-bloated-sys--mini';
  return (
    <span
      className={`badge-bloated-sys ${cls}${stageCls} ds-badge`}
      data-tone={tone}
      data-bloated-sys-stage={stage}
      data-mini-badge-tooltip="bloated-sys"
      title={fullTip}
      aria-label={fullTip}
    >
      {label}
    </span>
  );
}

/**
 * context-saturation 세션 헤더 배지(full). 원본 contextSaturationBadgeFullHtml 1:1.
 * 원본은 i18n 누락 시 영문 fallback 라벨을 썼으나(전환기 방어), 현 locales 에 키가 모두 존재하므로
 * useTranslation 의 t 가 그대로 해석한다(키 부재 시 parseMissingKeyHandler 가 레거시/키 폴백).
 */
export function ContextSaturationBadge({ ctxSat }: { ctxSat: unknown }): ReactElement | null {
  const { t } = useTranslation();
  const info = contextSaturationInfo(ctxSat);
  if (!info) return null;
  const { stage, pct, tone, stageCls, i18nBase } = info;
  const label = t(`${i18nBase}.label`, { pct });
  const tooltip = t(`${i18nBase}.tooltip`, { pct });
  const action = t(`${i18nBase}.modal`, { pct });
  const fullTip = `${tooltip} · ${action}`;
  return (
    <span
      className={`badge-context-saturation badge-context-saturation--full${stageCls} ds-badge`}
      data-tone={tone}
      data-context-saturation-stage={stage}
      title={fullTip}
      aria-label={fullTip}
    >
      {label}
    </span>
  );
}

/**
 * Agent/Skill 부모 Target 셀 `↑×N` 배지. 원본 agentSpikeBadgeHtml 1:1.
 *  - `↑` glyph + 수식 자식(.agent-spike-count)으로 분리(CSS 에서 count 만 강조).
 *  - 미노출(stage 아님 / multiplier<3) 이면 null — 호출 측이 기본 spike 표지 유지.
 */
export function AgentSpikeBadge({ agentSpike }: { agentSpike: unknown }): ReactElement | null {
  const { t } = useTranslation();
  const info = agentSpikeInfo(agentSpike);
  if (!info) return null;
  const { n } = info;
  const tooltip = t('ui.anomaly.agent-spike.tooltip', { n });
  const action = t('ui.anomaly.agent-spike.modal', { n });
  const fullTip = `${tooltip} · ${action}`;
  return (
    <span
      className="mini-badge badge-spike ds-badge"
      data-tone="warn"
      data-spike-variant="agent"
      data-mini-badge-tooltip="agent-spike"
      title={fullTip}
      aria-label={fullTip}
    >
      ↑<span className="agent-spike-count">×{n}</span>
    </span>
  );
}

/** spike sparkline 기하 — 원본 _spikeSparklineSvg 의 점/경로 계산 1:1(순수). */
function spikeSparkGeometry(samples: number[]): {
  W: number;
  H: number;
  empty: boolean;
  linePath?: string;
  areaPath?: string;
  peak?: { x: string; y: string };
} {
  const W = 60;
  const H = 16;
  if (!Array.isArray(samples) || samples.length === 0) {
    return { W, H, empty: true };
  }
  const vals = samples.slice(-20).map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const n = vals.length;
  const max = Math.max(...vals, 1);
  const stepX = n > 1 ? W / (n - 1) : 0;
  const padY = 1;
  const innerH = H - padY * 2;
  const points = vals.map((v, i) => {
    const x = i * stepX;
    const y = padY + innerH - (v / max) * innerH;
    return [x, y] as const;
  });
  const linePath = 'M ' + points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ');
  const areaPath = `${linePath} L ${W} ${H} L 0 ${H} Z`;
  let peakIdx = 0;
  for (let i = 1; i < vals.length; i++) if (vals[i] > vals[peakIdx]) peakIdx = i;
  const [px, py] = points[peakIdx];
  return { W, H, empty: false, linePath, areaPath, peak: { x: px.toFixed(2), y: py.toFixed(2) } };
}

/** spike sparkline SVG — 원본 _spikeSparklineSvg 마크업 1:1(peak marker 포함). */
function SpikeSparkline({ samples }: { samples: number[] }): ReactElement {
  const g = spikeSparkGeometry(samples);
  if (g.empty) {
    return (
      <svg viewBox={`0 0 ${g.W} ${g.H}`} preserveAspectRatio="none" aria-hidden="true">
        <line
          x1="0"
          y1={g.H - 1}
          x2={g.W}
          y2={g.H - 1}
          stroke="currentColor"
          strokeOpacity="0.18"
          strokeWidth="1"
        />
      </svg>
    );
  }
  return (
    <svg viewBox={`0 0 ${g.W} ${g.H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={g.areaPath} fill="var(--color-accent-soft)" />
      <path
        d={g.linePath}
        stroke="var(--color-accent)"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={g.peak!.x} cy={g.peak!.y} r="2" fill="var(--color-accent)" />
    </svg>
  );
}

/**
 * 턴뷰 헤더 `.turn-spike-summary` + sparkline. 원본 turnSpikeSummaryHtml 1:1.
 *  - 미노출이면 null. samples 없으면 빈 baseline sparkline.
 *  - 함수/JSX 양쪽 호출을 위해 t 를 prop 으로도 주입 가능(미주입 시 useTranslation).
 */
export function TurnSpikeSummary({
  agentSpike,
  samples,
  t: tProp,
}: {
  agentSpike: unknown;
  samples: number[];
  t?: TFn;
}): ReactElement | null {
  const hook = useTranslation();
  const t: TFn = tProp ?? hook.t;
  const info = agentSpikeInfo(agentSpike);
  if (!info) return null;
  const label = t('ui.anomaly.agent-spike.summary', { n: info.n });
  return (
    <span className="turn-spike-summary" title={label} aria-label={label}>
      <span className="turn-spike-summary-label">{label}</span>
      <span className="turn-spike-summary-spark">
        <SpikeSparkline samples={samples} />
      </span>
    </span>
  );
}
