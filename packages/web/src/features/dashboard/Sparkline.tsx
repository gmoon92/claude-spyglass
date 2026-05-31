/**
 * features/dashboard/Sparkline.tsx — inline SVG sparkline 컴포넌트 (P3-09)
 *
 * 원본: assets/js/sparkline.js sparklineBars/sparklineLine (SVG 문자열 → innerHTML).
 *  - 본 컴포넌트는 동일 SVG 마크업을 JSX 로 렌더(데이터/뷰 분리: 기하는 sparkline.ts 순수).
 *  - 출력 마크업은 원본과 동치: viewBox/preserveAspectRatio="none"/aria-hidden,
 *    bars=<rect rx="0.5">, line=<path stroke-width=1.5>, empty=<line opacity .18>.
 *
 * leaf(arch §1.3): 무전역·무스토어. values/opts 만 받는다.
 *
 * @module features/dashboard/Sparkline
 */
import type { ReactElement } from 'react';
import {
  computeSparkBars,
  computeSparkLine,
  type SparkOpts,
} from './sparkline-data';

export interface SparklineProps extends SparkOpts {
  values: ReadonlyArray<number | null | undefined>;
}

/** 빈/0 입력 placeholder — 가운데 baseline 한 줄(원본 emptySvg 동치). */
function EmptyBaseline({
  width,
  height,
  color,
  cy,
}: {
  width: number;
  height: number;
  color: string;
  cy: number;
}): ReactElement {
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1={cy} x2={width} y2={cy} stroke={color} strokeOpacity="0.18" strokeWidth="1" />
    </svg>
  );
}

/** 막대 sparkline(이산 데이터). */
export function SparklineBars({ values, ...opts }: SparklineProps): ReactElement {
  const v = computeSparkBars(values, opts);
  if (v.bars.length === 0) {
    return <EmptyBaseline width={v.width} height={v.height} color={v.color} cy={v.baselineY} />;
  }
  return (
    <svg viewBox={`0 0 ${v.width} ${v.height}`} preserveAspectRatio="none" aria-hidden="true">
      {v.bars.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.width} height={b.height} fill={v.color} rx="0.5" />
      ))}
    </svg>
  );
}

/** 선 sparkline(연속 추세 — hit rate/latency 등). */
export function SparklineLine({ values, ...opts }: SparklineProps): ReactElement {
  const v = computeSparkLine(values, opts);
  if (!v.linePath) {
    return <EmptyBaseline width={v.width} height={v.height} color={v.color} cy={v.baselineY} />;
  }
  return (
    <svg viewBox={`0 0 ${v.width} ${v.height}`} preserveAspectRatio="none" aria-hidden="true">
      {v.areaPath ? <path d={v.areaPath} fill={v.color} fillOpacity="0.15" /> : null}
      <path
        d={v.linePath}
        stroke={v.color}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
