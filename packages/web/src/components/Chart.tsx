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
import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useChartReveal } from '../hooks/use-chart-reveal';
import { useTooltipStore } from '../stores/tooltip-store';
import {
  computeDonutSlices,
  computeTimelinePoints,
  donutTotal,
  cacheCreationOf,
  cacheHitRateLabel,
  formatDonutCenter,
  nowMinute,
  buildDonutLegend,
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
  /** .chart-wrap 안 timeline canvas '위'에 렌더할 슬롯(레거시 #timelineMeta 복원 — 호출처 주입). */
  timelineMeta?: import('react').ReactNode;
  /** .chart-wrap 안 timeline canvas '아래(형제)'에 렌더할 슬롯 — detail 모드 #contextGrowthChart 복원.
   *  레거시 default-view.css(:254~258): #timelineChart/#contextGrowthChart 는 .chart-wrap(column flex)
   *  형제로 두 캔버스를 두고 .chart-mode-detail 클래스로 display 를 모드별 토글한다. 호출처(BrowseLayout)가
   *  ContextChart 를 주입하고 모드 클래스는 #chartSection 에 부여 — Chart 는 .chart-wrap 레이아웃 소유만. */
  contextSlot?: import('react').ReactNode;
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

/** 타임라인 포인트 호버 detail — TooltipLayer 가 tooltip-store 구독으로 "시각 · N건" 툴팁 표시. */
export interface TimelineHoverDetail {
  label: string;
  count: number;
  clientX: number;
  clientY: number;
}

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
  progress = 1,
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
  // reveal sweep — 12시(-π/2)부터 시계방향으로 progress 만큼 차오른다. 각 슬라이스 끝각을 sweepLimit 로 클램프.
  //   progress=1 이면 sweepLimit=3π/2 라 전체 슬라이스가 그대로(무영향).
  const sweepLimit = -Math.PI / 2 + progress * Math.PI * 2;
  slices.forEach((s) => {
    const end = Math.min(s.endAngle, sweepLimit);
    if (end <= s.startAngle) return; // 아직 sweep 이 도달 안 한 슬라이스
    ctx.beginPath();
    ctx.arc(cx, cy, DONUT_R, s.startAngle, end);
    ctx.arc(cx, cy, DONUT_INNER, end, s.startAngle, true);
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
    // 가운데 % 카운트업 — 분자에 progress 를 곱해 0%→최종% 로 자연스럽게 증가.
    const label = cacheHitRateLabel(creation * progress, denom);
    ctx.fillStyle = tokens.cacheTokens.read;
    ctx.font = 'bold 18px monospace';
    ctx.fillText(label, cx, cy - 4);
  } else {
    const total = donutTotal(data, donutMode);
    // total 카운트업 — progress 비율만큼 증가(반올림). 폰트 크기는 최종 total 기준 고정(흔들림 방지).
    const shown = Math.round(total * progress);
    ctx.fillStyle = COLORS.text;
    ctx.font = `bold ${total >= 1000 ? 12 : 15}px monospace`;
    ctx.fillText(formatDonutCenter(shown), cx, cy - 3);
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

/** 타임라인 점 1개 — x 좌표(CSS px) + 버킷 인덱스(호버 hit-test 용). */
export interface TimelineHitPoint {
  x: number;
  index: number;
}

/**
 * 타임라인(sparkline) 캔버스 명령형 그리기(drawTimeline). null/ctx-null/width<=0 가드.
 * 점 좌표는 computeTimelinePoints(순수) 가 결정.
 * @returns 그린 점의 x 좌표 + 버킷 인덱스 배열(컴포넌트가 mousemove hit-test 에 재사용). 미그림 시 null.
 */
export function drawTimelineToCanvas(
  canvas: HTMLCanvasElement | null,
  buckets: number[],
  opts: TimelineDrawOpts,
): TimelineHitPoint[] | null {
  if (!canvas) return null;
  const parent = canvas.parentElement;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const w = (parent ? parent.clientWidth : 0) - 32;
  const h = 100;
  if (w <= 0 || !buckets.length) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

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

  return pts.map((p, i) => ({ x: p.x, index: i }));
}

/**
 * Chart 컴포넌트 본체 — 타임라인 + 도넛 캔버스를 useRef 로 캡슐화.
 * 그리기는 useLayoutEffect(레이아웃 측정 후 paint 전). resize 는 rAF 디바운스 ResizeObserver.
 *
 * P5-04 성능: 본체는 ChartImpl 로 두고 export 는 React.memo(ChartImpl)(아래). BrowseLayout 이
 *   고주기 SSE(new_request 5-20/s)로 `sessions` 만 갱신해 re-render 될 때, Chart 의 입력
 *   (dataByKind useMemo·donutMode 원시값·tokens 모듈 상수·timelineBuckets 안정 ref)이 불변이면
 *   shallow 비교로 본체 실행 자체를 건너뛴다 → 캔버스 effect 재실행/ResizeObserver 재등록 churn 제거.
 *   memo 가 효과를 내려면 호출처가 `timelineBuckets` 등 모든 prop 의 ref 안정성을 보장해야 한다
 *   (BrowseLayout 이 인라인 `[]` → 모듈 상수로 교체). 출력은 불변(메모는 re-render 회피일 뿐).
 */
function ChartImpl({
  dataByKind,
  donutMode,
  timelineBuckets,
  tokens,
  totalLabel = 'total',
  locale = 'en-US',
  donutStyle,
  timelineMeta,
  contextSlot,
}: ChartProps) {
  const { t } = useTranslation();
  const timelineRef = useRef<HTMLCanvasElement>(null);
  const donutRef = useRef<HTMLCanvasElement>(null);
  // 타임라인 호버 hit-test 좌표(draw 가 반환) — mousemove 가 동일 좌표계로 nearest 버킷을 찾는다.
  const timelineHitsRef = useRef<TimelineHitPoint[]>([]);
  // 타임라인 포인트 호버 발행 — tooltip-store(A-2: timeline-point-hover CustomEvent 폐기). action 은 ref 안정.
  const setPointHover = useTooltipStore((s) => s.setPointHover);
  const clearPointHover = useTooltipStore((s) => s.clearPointHover);

  // 범례 + 하단 total 뷰모델(레거시 renderTypeLegend) — 활성 도넛셋(dataByKind[donutMode]) 기준.
  //   i18n 은 react-i18next useTranslation 으로 직접 해석(ui.chart.label.<id> / count-unit / no-data).
  const activeDonut = dataByKind[donutMode] || [];
  const legend = buildDonutLegend(activeDonut, donutMode, {
    modelTokens: tokens.modelTokens,
    cacheTokens: tokens.cacheTokens,
    typeColors: tokens.typeColors,
    items: activeDonut,
  }, (id) => t(`ui:chart.label.${id}`));

  // 도넛 reveal(슬라이스 sweep + 가운데 카운트업, ease-out 600ms)은 "모드 전환/마운트" 에서만.
  //   prefers-reduced-motion 이면 즉시 완성(useChartReveal 내부 처리).
  //   데이터/토큰 갱신(SSE 로 같은 세션 turns 증가 등)은 redrawDeps 로 reveal 없이 최종 프레임만 그린다 —
  //   매 갱신마다 0→값 reveal 이 재생돼 도넛이 0 부터 다시 차오르던 회귀 차단(애니메이션 자체는 보존).
  useChartReveal(
    (p) => drawDonutToCanvas(donutRef.current, dataByKind, donutMode, tokens, totalLabel, p),
    [donutMode],
    600,
    [dataByKind, tokens, totalLabel],
  );

  // 타임라인: 버킷/locale 변경 시 재그림(부모 clientWidth 측정 필요 → layout effect 로 깜빡임 방지).
  useIsomorphicLayoutEffect(() => {
    timelineHitsRef.current =
      drawTimelineToCanvas(timelineRef.current, timelineBuckets, { now: Date.now(), locale }) ?? [];
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
      rafId = requestAnimationFrame(() => {
        timelineHitsRef.current =
          drawTimelineToCanvas(timelineRef.current, timelineBuckets, { now: Date.now(), locale }) ?? [];
      });
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

  // 타임라인 호버 — 마우스 x 위치의 버킷(=그 시점 요청 수)을 잡아 "시각 · N건" 툴팁 상태 발행.
  //   표시는 TooltipLayer 가 tooltip-store 구독으로 처리(차트=발행 / 툴팁=표시 단일책임 분리).
  const handleTimelineMove = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      const canvas = timelineRef.current;
      const hits = timelineHitsRef.current;
      if (!canvas || !hits.length) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      let idx = -1;
      let min = Infinity;
      for (const hp of hits) {
        const d = Math.abs(hp.x - mx);
        if (d < min) {
          min = d;
          idx = hp.index;
        }
      }
      if (idx < 0) return;
      const n = timelineBuckets.length;
      const count = timelineBuckets[idx] ?? 0;
      const curMin = nowMinute(Date.now());
      const ts = new Date((curMin - (n - 1 - idx)) * 60000);
      const label = ts.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      setPointHover({ kind: 'timeline', detail: { label, count, clientX: e.clientX, clientY: e.clientY } });
    },
    [timelineBuckets, locale, setPointHover],
  );

  const handleTimelineLeave = useCallback(() => clearPointHover(), [clearPointHover]);

  // 레거시 default-view.css 의 .charts-inner(grid 2fr 1fr) 2-셀 구조를 그대로 출력한다(WP14).
  //   - 좌(2fr): .chart-wrap > #timelineChart — timeline canvas. data-ctx-tooltip 은 호출처가
  //     타임라인 영역에 붙이던 context-growth 툴팁 앵커(원본 index.html .chart-wrap 과 1:1).
  //   - 우(1fr): .donut-section > .donut-wrap > #typeChart.donut-canvas — donut canvas + border-left.
  //   두 캔버스의 레이아웃 관계는 Chart 가 단독 소유하므로 wrapper 도 컴포넌트 내부에 캡슐화한다
  //   (호출처가 .chart-wrap 으로 한 번 더 감싸면 .charts-inner 직계 자식이 1개가 되어 grid 가 붕괴).
  return (
    <>
      <div className="chart-wrap" data-ctx-tooltip="context-growth">
        {/* 레거시 복원 — timeline-meta 요약 통계 블록이 canvas '위'에 위치(index.html :443). */}
        {timelineMeta}
        <canvas
          id="timelineChart"
          ref={timelineRef}
          height={64}
          onMouseMove={handleTimelineMove}
          onMouseLeave={handleTimelineLeave}
        />
        {/* detail 모드 #contextGrowthChart — timeline canvas 형제. CSS(.chart-mode-detail)가 display 토글:
            default 모드는 contextSlot 숨김·timeline 노출, detail 모드는 그 반대(default-view.css :254~258). */}
        {contextSlot}
      </div>
      {/* donut-section(레거시 index.html :488~517) — .donut-wrap(canvas + #typeLegend) + .donut-meta(#typeTotal).
          범례·하단 total 은 react-i18next 구독으로 직접 해석(레거시 renderTypeLegend 선언적 복원). */}
      <div className="donut-section">
        <div className="donut-wrap">
          <canvas
            id="typeChart"
            className="donut-canvas"
            ref={donutRef}
            width={DONUT_SIZE}
            height={DONUT_SIZE}
            style={donutStyle}
          />
          <div className="type-legend" id="typeLegend">
            {legend.hasData ? (
              legend.rows.map((row, i) => (
                <div className="legend-item" key={`${row.name}-${i}`}>
                  <div
                    className="legend-dot ds-dot"
                    data-size="md"
                    style={{ background: row.color }}
                  />
                  <span className="legend-name" data-tip={row.title}>{row.name}</span>
                  <span className="legend-val">{row.count.toLocaleString()}</span>
                  <span className="legend-pct">{row.pct}%</span>
                </div>
              ))
            ) : (
              <div
                className="state-empty"
                style={{ padding: 0, fontSize: 'var(--font-meta)' }}
              >
                {t('ui:chart.no-data')}
              </div>
            )}
          </div>
        </div>
        <div className="donut-meta">
          <div className="donut-total" id="typeTotal">
            {t('ui:chart.count-unit', { count: legend.total.toLocaleString() })}
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Chart — 공개 진입점(메모화). 본체 ChartImpl 을 React.memo 로 감싸 prop shallow-equal 시 re-render 회피.
 * 타입·이름·출력은 비메모 버전과 동일(소비처 무영향). 메모는 순수 성능 최적화이며 동작을 바꾸지 않는다.
 */
export const Chart = memo(ChartImpl);
