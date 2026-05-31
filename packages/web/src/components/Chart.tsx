/**
 * components/Chart.tsx — Canvas 차트 컴포넌트 (타임라인 + 도넛) (P3-01)
 *
 * 원본: assets/js/chart.js drawTimeline/drawDonut/renderTypeLegend.
 *  - 원본은 document.getElementById('timelineChart'|'typeChart') 로 캔버스를 직접 조회하고,
 *    setSourceData(kind,data) 외부 주입 + 모듈 변수 donutMode 로 활성 데이터셋을 골랐다.
 *
 * 원본 대비 변경(신규 계약):
 *  - getElementById → useRef<HTMLCanvasElement> 캡슐화. 그리기는 useLayoutEffect(레이아웃 측정 후
 *    paint 전 1회 — 깜빡임 최소화). 효과는 SSR/단위테스트(renderToStaticMarkup)에서 미발화.
 *  - setSourceData 외부주입 폐기 → dataByKind prop 주입. 활성 데이터셋 = dataByKind[donutMode].
 *  - donutMode 모듈 변수 폐기 → donutMode prop(컨트롤드). 상태 SSoT 는 호출처(app-store donutMode
 *    슬라이스). 컴포넌트는 무전역·무스토어(arch §1.3 components leaf).
 *  - 색 토큰 getComputedStyle lazy 캐시 폐기 → tokens prop 주입(chart-data ColorContext).
 *  - resize: chart-policy.js observeTimelineResize 의 rAF 디바운스 ResizeObserver 를 컴포넌트
 *    useEffect 로 내재화 + cleanup(disconnect/cancelAnimationFrame). DPR 변경 시 재측정 redraw.
 *
 * 셀렉터 계약 유지(arch §2.2): #timelineChart, #typeChart, class="donut-canvas". 향후 CSS·E2E 호환.
 *
 * 순수 변환은 chart-data.ts(테스트 골든마스터). 본 파일의 ctx.* 명령형은 단위테스트 불충분 →
 *   수동 verify(tasks.json P3-01: N px 리사이즈 후 깜빡임 0 + 도넛 재그림 1 + DPR 선명도).
 *
 * @module components/Chart
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import {
  computeDonutSlices,
  computeTimelinePoints,
  donutTotal,
  cacheCreationOf,
  cacheHitRateLabel,
  formatDonutCenter,
  nowMinute,
  type DataByKind,
  type DonutMode,
  type ModelTokens,
  type CacheTokens,
  type TypeColors,
} from './chart-data';

/** 색 토큰 묶음(design-tokens.css SSoT — 호출처가 getComputedStyle 으로 읽어 주입). */
export interface ChartTokens {
  modelTokens: ModelTokens;
  cacheTokens: CacheTokens;
  typeColors: TypeColors;
}

export interface ChartProps {
  /** 종류별 도넛 데이터(setSourceData 외부주입 대체). 활성셋 = dataByKind[donutMode]. */
  dataByKind: DataByKind;
  /** 활성 도넛 모드(컨트롤드 — app-store donutMode 슬라이스 주입). */
  donutMode: DonutMode;
  /** 타임라인 버킷(30분 sliding — 호출처가 use-chart-timeline 등으로 소유, 컨트롤드). */
  timelineBuckets: number[];
  /** 색 토큰(무전역 — 호출처가 design-tokens.css 에서 읽어 주입). */
  tokens: ChartTokens;
  /** 도넛 가운데 'total' 라벨(i18n — 호출처 주입, 기본 'total'). */
  totalLabel?: string;
  /** 타임라인 시각 라벨 locale(기본 'en-US'). */
  locale?: string;
  /** 도넛 캔버스 wrapper 스타일(옵션). */
  donutStyle?: CSSProperties;
}

// 원본 chart.js COLORS — CSS 변수 미주입 영역(축선/배경/텍스트)의 폴백 상수.
const COLORS = {
  border: '#272727',
  text: '#e8e8e8',
  textDim: '#888888',
} as const;

const DONUT_SIZE = 90;
const DONUT_R = 36;
const DONUT_INNER = 22;

/**
 * isomorphic layout effect — 클라이언트는 useLayoutEffect(측정 후 paint 전, 깜빡임 방지),
 * 서버(renderToStaticMarkup)는 useEffect 로 폴백해 "useLayoutEffect does nothing on the server"
 * 경고를 회피한다(React 권장 SSR 패턴). 효과 자체는 어느 쪽도 SSR 에서 발화하지 않는다.
 *
 * 판별 기준은 `window` 존재가 아니라 "렌더 가능한 실 DOM"(window.document.createElement) 유무다.
 *   일부 단위테스트가 window.I18n 스텁을 위해 globalThis.window = {} 를 정리 없이 주입하는데,
 *   `typeof window` 만 보면 그 스텁 환경에서도 useLayoutEffect 가 선택되어 SSR 경고가 샌다.
 *   실 DOM 메서드 유무로 좁혀 스텁/서버 환경을 정확히 useEffect 로 폴백한다.
 */
const hasRealDom =
  typeof window !== 'undefined' &&
  typeof (window as Window & typeof globalThis).document?.createElement === 'function';
const useIsomorphicLayoutEffect = hasRealDom ? useLayoutEffect : useEffect;

/**
 * 도넛 캔버스 명령형 그리기(drawDonut). null/ctx-null 가드 → SSR·canvas 미구현 환경 안전.
 * "무엇을 그릴지"는 computeDonutSlices(순수) 가 결정, 본 함수는 ctx 호출만 담당.
 */
export function drawDonutToCanvas(
  canvas: HTMLCanvasElement | null,
  dataByKind: DataByKind,
  donutMode: DonutMode,
  tokens: ChartTokens,
  totalLabel = 'total',
): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const data = dataByKind[donutMode] || [];
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  canvas.width = DONUT_SIZE * dpr;
  canvas.height = DONUT_SIZE * dpr;
  canvas.style.width = `${DONUT_SIZE}px`;
  canvas.style.height = `${DONUT_SIZE}px`;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, DONUT_SIZE, DONUT_SIZE);

  const cx = DONUT_SIZE / 2;
  const cy = DONUT_SIZE / 2;

  if (!data.length) {
    ctx.beginPath();
    ctx.arc(cx, cy, DONUT_R, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = DONUT_R - DONUT_INNER;
    ctx.stroke();
    return;
  }

  const slices = computeDonutSlices(data, donutMode, {
    modelTokens: tokens.modelTokens,
    cacheTokens: tokens.cacheTokens,
    typeColors: tokens.typeColors,
    items: data,
  });
  slices.forEach((s) => {
    ctx.beginPath();
    ctx.arc(cx, cy, DONUT_R, s.startAngle, s.endAngle);
    ctx.arc(cx, cy, DONUT_INNER, s.endAngle, s.startAngle, true);
    ctx.closePath();
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  });

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (donutMode === 'cache') {
    const creation = cacheCreationOf(data);
    const denom = data.reduce((sum, d) => sum + (d.tokens || 0), 0) || 1;
    const label = cacheHitRateLabel(creation, denom);
    ctx.fillStyle = tokens.cacheTokens.read;
    ctx.font = 'bold 18px monospace';
    ctx.fillText(label, cx, cy - 4);
  } else {
    const total = donutTotal(data, donutMode);
    ctx.fillStyle = COLORS.text;
    ctx.font = `bold ${total >= 1000 ? 12 : 15}px monospace`;
    ctx.fillText(formatDonutCenter(total), cx, cy - 3);
    ctx.fillStyle = COLORS.textDim;
    ctx.font = '8px monospace';
    ctx.fillText(totalLabel, cx, cy + 9);
  }
}

/** 타임라인 그리기 옵션. */
export interface TimelineDrawOpts {
  /** Date.now() 결과(시각 라벨/버킷 산정 — 컴포넌트가 주입, 결정론 위해 인자화). */
  now: number;
  /** 시각 라벨 locale. */
  locale: string;
}

/**
 * 타임라인(sparkline) 캔버스 명령형 그리기(drawTimeline). null/ctx-null/width<=0 가드.
 * 점 좌표는 computeTimelinePoints(순수) 가 결정.
 */
export function drawTimelineToCanvas(
  canvas: HTMLCanvasElement | null,
  buckets: number[],
  opts: TimelineDrawOpts,
): void {
  if (!canvas) return;
  const parent = canvas.parentElement;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const w = (parent ? parent.clientWidth : 0) - 32;
  const h = 100;
  if (w <= 0 || !buckets.length) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const padL = 26;
  const padR = 8;
  const padT = 6;
  const padB = 18;
  const dims = { padL, padR, padT, padB, width: w, height: h };
  const data = buckets;
  const maxVal = Math.max(...data, 1);
  const n = data.length;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  // grid + y 라벨
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 0.5;
  [0, 0.5, 1].forEach((t) => {
    const y = padT + chartH * (1 - t);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    if (t > 0) {
      ctx.fillStyle = COLORS.textDim;
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(maxVal * t)), padL - 3, y + 3);
    }
  });

  // x 시각 라벨
  ctx.fillStyle = COLORS.textDim;
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  const curMin = nowMinute(opts.now);
  [0, Math.floor(n / 2), n - 1].forEach((i) => {
    const minsAgo = n - 1 - i;
    const ts = new Date((curMin - minsAgo) * 60000);
    const label = ts.toLocaleTimeString(opts.locale, { hour: '2-digit', minute: '2-digit' });
    const x = padL + (n === 1 ? 0 : (i / (n - 1)) * chartW);
    ctx.fillText(label, x, h - 3);
  });

  const pts = computeTimelinePoints(data, dims);

  // area fill (orange gradient)
  const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH);
  grad.addColorStop(0, 'rgba(217,119,87,0.3)');
  grad.addColorStop(1, 'rgba(217,119,87,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, padT + chartH);
  pts.forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, padT + chartH);
  ctx.closePath();
  ctx.fill();

  // sparkline stroke (orange → amber)
  const lineGrad = ctx.createLinearGradient(padL, 0, w - padR, 0);
  lineGrad.addColorStop(0, '#FF7A45');
  lineGrad.addColorStop(1, '#FFD43B');
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255, 122, 69, 0.4)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';

  // last point dot + value
  const last = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#FFD43B';
  ctx.fill();
  if (data[data.length - 1] > 0) {
    ctx.fillStyle = '#FFD43B';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(String(data[data.length - 1]), last.x + 5, last.y + 3);
  }
}

/**
 * Chart 컴포넌트 — 타임라인 + 도넛 캔버스를 useRef 로 캡슐화.
 * 그리기는 useLayoutEffect(레이아웃 측정 후 paint 전). resize 는 rAF 디바운스 ResizeObserver.
 */
export function Chart({
  dataByKind,
  donutMode,
  timelineBuckets,
  tokens,
  totalLabel = 'total',
  locale = 'en-US',
  donutStyle,
}: ChartProps) {
  const timelineRef = useRef<HTMLCanvasElement>(null);
  const donutRef = useRef<HTMLCanvasElement>(null);

  // 도넛: 데이터/모드/토큰 변경 시 재그림(레이아웃 측정 불필요하나, 동일 타이밍 일관성 위해 layout effect).
  useIsomorphicLayoutEffect(() => {
    drawDonutToCanvas(donutRef.current, dataByKind, donutMode, tokens, totalLabel);
  }, [dataByKind, donutMode, tokens, totalLabel]);

  // 타임라인: 버킷/locale 변경 시 재그림(부모 clientWidth 측정 필요 → layout effect 로 깜빡임 방지).
  useIsomorphicLayoutEffect(() => {
    drawTimelineToCanvas(timelineRef.current, timelineBuckets, { now: Date.now(), locale });
  }, [timelineBuckets, locale]);

  // resize: 타임라인 부모 크기/DPR 변화에 rAF 디바운스 redraw. cleanup 으로 누수 방지.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const canvas = timelineRef.current;
    const parent = canvas?.parentElement;
    if (!parent) return undefined;
    let rafId = 0;
    const redraw = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() =>
        drawTimelineToCanvas(timelineRef.current, timelineBuckets, { now: Date.now(), locale }),
      );
    };
    if (typeof window.ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(redraw);
      ro.observe(parent);
      return () => {
        cancelAnimationFrame(rafId);
        ro.disconnect();
      };
    }
    window.addEventListener('resize', redraw);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', redraw);
    };
  }, [timelineBuckets, locale]);

  return (
    <>
      <canvas id="timelineChart" ref={timelineRef} height={64} />
      <canvas
        id="typeChart"
        className="donut-canvas"
        ref={donutRef}
        width={DONUT_SIZE}
        height={DONUT_SIZE}
        style={donutStyle}
      />
    </>
  );
}
