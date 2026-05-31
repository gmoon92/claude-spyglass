/**
 * features/dashboard/sparkline-data.ts — sparkline 순수 기하 계산 (P3-09)
 *
 * 원본: assets/js/sparkline.js sparklineBars/sparklineLine (ADR-002).
 *  - 원본은 SVG **문자열**(`<svg>…</svg>`)을 반환해 innerHTML 로 주입했다.
 *  - 본 모듈은 "무엇을 그릴지"(rect 좌표/line path/empty baseline)만 **순수 계산**하고
 *    SVG 마크업 생성은 Sparkline.tsx(JSX)가 담당한다(데이터/뷰 분리).
 *
 * 원본 대비 변경(신규 계약):
 *  - 문자열 빌드 폐기 → SparkBar[]/SparkLine 뷰모델 반환. JSX 가 <rect>/<path> 로 렌더.
 *  - 좌표 산식·max/min/span·null 보간·빈 입력 폴백 정책은 원본과 byte 동치(회귀 0).
 *  - toFixed(2) 좌표 반올림도 원본과 동일(SVG 마크업 동치 보장).
 *
 * 병존: 원본 assets/js/sparkline.js 는 유지(obs-panel.js 등 vanilla 소비처). 본 모듈은 React 전용.
 *
 * @module features/dashboard/sparkline-data
 */

/** sparkline 공통 옵션 — 원본 opts 와 동일 시그니처(기본값 포함). */
export interface SparkOpts {
  width?: number;
  height?: number;
  color?: string;
  /** bars 전용: bar 사이 픽셀 간격(기본 1). */
  gap?: number;
  /** line 전용: 영역 fill 여부(기본 true). */
  fill?: boolean;
}

/** 막대 1건 — <rect> 속성으로 1:1 대응. 좌표는 원본과 동일하게 toFixed(2) 문자열. */
export interface SparkBar {
  x: string;
  y: string;
  width: string;
  height: string;
}

/** 막대 sparkline 뷰모델. bars 비면 baseline(empty) 로 렌더. */
export interface SparkBarsView {
  kind: 'bars';
  width: number;
  height: number;
  color: string;
  /** 비어 있으면 empty baseline. */
  bars: SparkBar[];
  /** empty 시 가운데 baseline y(원본 emptySvg: height-1). */
  baselineY: number;
}

/** 선 sparkline 뷰모델. linePath 비면 empty baseline. */
export interface SparkLineView {
  kind: 'line';
  width: number;
  height: number;
  color: string;
  /** 'M x y L x y …' (비어 있으면 ''). */
  linePath: string;
  /** fill 영역 path(fill=false 또는 empty 면 null). */
  areaPath: string | null;
  baselineY: number;
}

const DEFAULT_W = 96;
const DEFAULT_H = 22;
const DEFAULT_COLOR = 'currentColor';

/** 원본 emptySvg 의 baseline y: height - 1. */
function baselineY(height: number): number {
  return height - 1;
}

/**
 * 막대 sparkline 기하 — 원본 sparklineBars 와 동치.
 *  - 음수/null/NaN → 0. max===0(전부 0) → empty baseline.
 *  - barW = max(1, (width - gap*(n-1)) / n). h = max(1, (v/max)*(height-1)).
 */
export function computeSparkBars(
  values: ReadonlyArray<number | null | undefined>,
  opts: SparkOpts = {},
): SparkBarsView {
  const width = opts.width ?? DEFAULT_W;
  const height = opts.height ?? DEFAULT_H;
  const color = opts.color ?? DEFAULT_COLOR;
  const gap = opts.gap ?? 1;
  const base: Omit<SparkBarsView, 'bars'> = {
    kind: 'bars',
    width,
    height,
    color,
    baselineY: baselineY(height),
  };

  if (!Array.isArray(values) || values.length === 0) {
    return { ...base, bars: [] };
  }
  const safe = values.map((v) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0,
  );
  const max = Math.max(...safe, 1);
  if (max === 0) return { ...base, bars: [] };

  const n = safe.length;
  const barW = Math.max(1, (width - gap * (n - 1)) / n);
  const bars: SparkBar[] = safe.map((v, i) => {
    const h = Math.max(1, (v / max) * (height - 1));
    const x = i * (barW + gap);
    const y = height - h;
    return {
      x: x.toFixed(2),
      y: y.toFixed(2),
      width: barW.toFixed(2),
      height: h.toFixed(2),
    };
  });
  return { ...base, bars };
}

/**
 * 선 sparkline 기하 — 원본 sparklineLine 와 동치.
 *  - null/NaN → 직전 valid 값으로 보간(직선화). valid 0개 → empty baseline.
 *  - min/max/span(=max-min||1) 정규화. stepX = n>1 ? width/(n-1) : 0. padY=1.
 */
export function computeSparkLine(
  values: ReadonlyArray<number | null | undefined>,
  opts: SparkOpts = {},
): SparkLineView {
  const width = opts.width ?? DEFAULT_W;
  const height = opts.height ?? DEFAULT_H;
  const color = opts.color ?? DEFAULT_COLOR;
  const fill = opts.fill ?? true;
  const base: Omit<SparkLineView, 'linePath' | 'areaPath'> = {
    kind: 'line',
    width,
    height,
    color,
    baselineY: baselineY(height),
  };

  if (!Array.isArray(values) || values.length === 0) {
    return { ...base, linePath: '', areaPath: null };
  }
  const safe: Array<number | null> = values.map((v) =>
    typeof v === 'number' && Number.isFinite(v) ? v : null,
  );
  const valid = safe.filter((v): v is number => v !== null);
  if (valid.length === 0) return { ...base, linePath: '', areaPath: null };

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const span = max - min || 1;
  const n = safe.length;
  const stepX = n > 1 ? width / (n - 1) : 0;
  const padY = 1;
  const innerH = height - padY * 2;

  let lastValid = valid[0];
  const points: Array<[number, number]> = safe.map((vRaw, i) => {
    const v = vRaw === null ? lastValid : vRaw;
    if (vRaw !== null) lastValid = vRaw;
    const x = i * stepX;
    const y = padY + innerH - ((v - min) / span) * innerH;
    return [x, y];
  });

  const linePath =
    'M ' + points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ');
  const areaPath = fill ? `${linePath} L ${width} ${height} L 0 ${height} Z` : null;
  return { ...base, linePath, areaPath };
}
