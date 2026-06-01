/**
 * features/dashboard/ContextChart.tsx — 누적 토큰 컨텍스트 차트 (Canvas) (P3-09)
 *
 * 원본: assets/js/context-chart.js renderContextChart (#contextGrowthChart canvas).
 *  - 턴별 누적 토큰 라인 + context-window 한도 baseline + 점 + 그리드. DETAIL_FILTER_CHANGED 구독.
 *  - 본 컴포넌트는 Chart.tsx(P3-01) 동형 패턴: useRef<canvas> + useLayoutEffect 그리기 +
 *    null/ctx-null 가드(SSR·canvas 미구현 안전). 순수 데이터는 context-chart-data.ts.
 *  - P3-01 Chart.tsx 미재용(데이터 모델/상호작용 상이 — context-chart-data.ts 설계노트 참조).
 *  - hover hit-test / ctx-point-hover CustomEvent / DETAIL_FILTER_CHANGED 구독은 레거시 vanilla
 *    병존 유지(이식 범위 외). 본 컴포넌트는 turns prop 주입 → 정적 차트 그리기 계약만 이식.
 *
 * 셀렉터 계약 유지: #contextGrowthChart.
 *
 * @module features/dashboard/ContextChart
 */
import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  computeContextChartModel,
  computePoints,
  nearestPointByX,
  buildCtxPointHoverDetail,
  type ContextTurn,
  type ChartDims,
  type ChartPoint,
  type ContextWindowInfo,
} from './context-chart-data';
import { useChartReveal } from '../../hooks/use-chart-reveal';

const PAD = { top: 4, right: 6, bottom: 4, left: 6 };

function getCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined' || !window.getComputedStyle) return fallback;
  return (
    window.getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  );
}

/** drawContextChartToCanvas 결과 — 그린 점 좌표계 + window. 컴포넌트가 hit-test 에 재사용. */
export interface ContextChartRender {
  pts: ChartPoint[];
  window: ContextWindowInfo;
}

/**
 * 누적 토큰 차트 명령형 그리기. null/ctx-null/빈데이터 가드(SSR·canvas 미구현 안전).
 * "무엇을 그릴지"는 context-chart-data(순수)가 결정, 본 함수는 ctx 호출만.
 *
 * @param hoveredIdx 호버된 점 인덱스(-1=없음). 해당 점은 수직 점선 가이드 + 확대(r=5) + glow 로 강조.
 * @param progress reveal 진행도(0..1, 기본 1=완성). <1 이면 데이터(fill/라인/점)를 좌→우 clip 으로 드러낸다.
 *                 격자선은 clip 밖이라 항상 전체 표시. 반환 pts 는 progress 와 무관하게 항상 full 좌표(hit-test SSoT).
 * @returns 그린 점 좌표(ChartPoint[])와 window 정보. 컴포넌트가 mousemove hit-test 에 동일 좌표계로 재사용.
 *          빈 상태/canvas 부재 시 null(컴포넌트가 hit-test 비활성).
 */
export function drawContextChartToCanvas(
  canvas: HTMLCanvasElement | null,
  turns: ReadonlyArray<ContextTurn> | null | undefined,
  hoveredIdx = -1,
  progress = 1,
): ContextChartRender | null {
  if (!canvas) return null;
  const model = computeContextChartModel(turns);
  if (!model) return null; // 빈 상태 — 그리지 않음(컴포넌트가 empty 표시 토글)
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const rect = canvas.getBoundingClientRect();
  const W = rect.width || canvas.offsetWidth || 400;
  const H = rect.height || canvas.offsetHeight || 80;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const dims: ChartDims = { width: W, height: H, pad: PAD };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;
  const pts = computePoints(model, dims);
  const n = pts.length;

  const stroke = getCssVar('--ctx-chart-stroke', '#d97757');
  const gridLine = getCssVar('--ctx-chart-line-grid', 'rgba(255,255,255,0.04)');
  const fillNorm = getCssVar('--ctx-chart-fill-normal', 'rgba(217,119,87,0.22)');

  // 격자선
  ctx.strokeStyle = gridLine;
  ctx.lineWidth = 1;
  for (let g = 1; g < 4; g++) {
    const y = PAD.top + (cH / 4) * g;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + cW, y);
    ctx.stroke();
  }

  // reveal clip — 데이터(fill/라인/점/호버)를 좌→우로 드러낸다. progress=1 이면 전체 폭이라 무영향.
  //   격자선은 이 위에서 이미 전체로 그렸으므로 clip 밖(항상 표시).
  const revealing = progress < 1;
  if (revealing) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W * progress, H);
    ctx.clip();
  }

  // 사용량 fill
  ctx.beginPath();
  if (n === 1) {
    ctx.moveTo(PAD.left, pts[0].cy);
    ctx.lineTo(PAD.left + cW, pts[0].cy);
    ctx.lineTo(PAD.left + cW, PAD.top + cH);
    ctx.lineTo(PAD.left, PAD.top + cH);
  } else {
    ctx.moveTo(pts[0].cx, pts[0].cy);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].cx, pts[i].cy);
    ctx.lineTo(pts[n - 1].cx, PAD.top + cH);
    ctx.lineTo(pts[0].cx, PAD.top + cH);
  }
  ctx.closePath();
  ctx.fillStyle = fillNorm;
  ctx.fill();

  // 라인
  ctx.beginPath();
  if (n === 1) {
    ctx.moveTo(PAD.left, pts[0].cy);
    ctx.lineTo(PAD.left + cW, pts[0].cy);
  } else {
    ctx.moveTo(pts[0].cx, pts[0].cy);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].cx, pts[i].cy);
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 호버 포인트 — 수직 점선 가이드(점 아래로). (원본 context-chart.js _hoveredIdx 가이드)
  if (hoveredIdx >= 0 && pts[hoveredIdx]) {
    const hp = pts[hoveredIdx];
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hp.cx, hp.cy + 6);
    ctx.lineTo(hp.cx, PAD.top + cH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 일반 데이터 포인트(호버 점 제외)
  ctx.fillStyle = stroke;
  for (let i = 0; i < n; i++) {
    if (i === hoveredIdx) continue;
    ctx.beginPath();
    ctx.arc(pts[i].cx, pts[i].cy, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 호버 포인트 — 확대(r=5) + glow. (원본 context-chart.js 강조 동치)
  if (hoveredIdx >= 0 && pts[hoveredIdx]) {
    const hp = pts[hoveredIdx];
    ctx.save();
    ctx.fillStyle = stroke;
    ctx.shadowColor = stroke;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(hp.cx, hp.cy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  if (revealing) ctx.restore(); // reveal clip 해제

  return { pts, window: model.window };
}

export interface ContextChartProps {
  /** 세션 턴 배열(누적 토큰). 컨트롤드 — 호출처(상세뷰 계층) 주입. */
  turns: ReadonlyArray<ContextTurn> | null;
  /** 데이터 fetch 진행 중 여부 — true 면 canvas 에 shimmer 스켈레톤(빈 상태 오해 방지). */
  loading?: boolean;
  /** 세션 식별자 — reveal 애니메이션 트리거 키. 같은 세션의 turns 갱신(SSE 등)은 reveal 없이 즉시 redraw,
   *  세션 전환(키 변경) 시에만 좌→우 reveal. 미지정 시 마운트 1회 reveal. */
  sessionKey?: string | null;
}

/** ctx-point-hover CustomEvent 발행(SSR/test 가드). detail=null 은 호버 해제. */
function dispatchPointHover(detail: unknown): void {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return;
  doc.dispatchEvent(new CustomEvent('ctx-point-hover', { detail }));
}

/**
 * 누적 토큰 차트 컴포넌트. 그리기는 ref 기반 redraw() 단일 경로로 통합 — 매 프레임 re-render 없이
 * progress(reveal)·hover 상태를 ref 로 들고 canvas 만 갱신한다.
 *
 * reveal 애니메이션:
 *  - turns 변경 시 useChartReveal 이 progress 0→1(ease-out 600ms)을 구동, 라인이 좌→우로 드러난다.
 *    reveal 중에는 hover 를 해제(progress<1)해 stale 강조를 막는다. prefers-reduced-motion 이면 즉시 완성.
 *
 * 호버 상호작용(레거시 context-chart.js 복원):
 *  - mousemove → 그려진 점과 동일 좌표계로 hit-test(15px) → 가장 가까운 점 강조 + ctx-point-hover 발행.
 *  - 수치 툴팁 표시는 use-tooltip 훅이 ctx-point-hover 를 구독해 처리(차트=발행, 툴팁=표시 단일책임 분리).
 */
export function ContextChart({ turns, loading = false, sessionKey = null }: ContextChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 마지막 그리기 결과(점 좌표 + window) — mousemove hit-test 가 draw 와 동일 좌표계를 보도록 ref 보관.
  //   draw 가 반환하는 pts 는 progress 와 무관한 full 좌표라 reveal 중에도 hit-test 좌표는 정확.
  const renderRef = useRef<ContextChartRender | null>(null);
  const hoveredRef = useRef(-1);
  const progressRef = useRef(1);

  // 단일 그리기 경로 — 현재 progress/hover 상태로 canvas 1프레임 그림. reveal·hover 모두 이 함수만 호출.
  const redraw = useCallback(() => {
    renderRef.current = drawContextChartToCanvas(
      canvasRef.current,
      turns,
      hoveredRef.current,
      progressRef.current,
    );
    if (!renderRef.current) hoveredRef.current = -1; // 빈 상태 → stale 호버 해제
  }, [turns]);

  // 세션 전환(sessionKey 변경) → reveal(progress 0→1). 같은 세션의 turns 갱신(SSE 등)은 아래 effect 가
  //   reveal 없이 즉시 redraw 해 "나왔다 사라지는" 깜빡임을 막는다. reveal 시작 시 hover 해제.
  useChartReveal(
    (p) => {
      progressRef.current = p;
      if (p < 1) hoveredRef.current = -1;
      redraw();
    },
    [sessionKey],
    600,
  );

  // turns 변경 → 즉시 redraw(reveal 재생 없이). reveal 진행 중(progress<1)이면 reveal 콜백이 최신 turns 를
  //   그리므로 중복 그리기를 피한다(progress>=1 일 때만 redraw).
  useEffect(() => {
    if (progressRef.current >= 1) redraw();
  }, [turns, redraw]);

  const handleMouseMove = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
    const render = renderRef.current;
    const canvas = canvasRef.current;
    if (!render || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    // x축 nearest — 그래프 영역 어디에 올려도 해당 x 위치의 누적 토큰(y)을 노출(노출 범위 확대).
    const idx = nearestPointByX(render.pts, e.clientX - rect.left);
    if (idx === hoveredRef.current) {
      // 같은 점 위 이동: 강조는 그대로, 툴팁 위치만 갱신(불필요한 redraw 회피).
      if (idx >= 0) {
        dispatchPointHover(buildCtxPointHoverDetail(render.pts[idx], render.window, e.clientX, e.clientY));
      }
      return;
    }
    hoveredRef.current = idx;
    progressRef.current = 1; // 호버는 reveal 완료 후 — 항상 완성 상태로 그림
    canvas.style.cursor = idx >= 0 ? 'crosshair' : '';
    redraw();
    if (idx >= 0) {
      dispatchPointHover(buildCtxPointHoverDetail(render.pts[idx], render.window, e.clientX, e.clientY));
    } else {
      dispatchPointHover(null);
    }
    // deps 에 redraw 필수 — redraw 는 useCallback([turns]) 라 turns 변경 시 새로 생성된다.
    //   deps 가 []이면 첫 렌더(turns=[])의 stale redraw 를 캡처해 호버 시 renderRef 를 빈 데이터로
    //   덮어써 이후 hit-test 가 죽는다(턴뷰 점 호버 무반응 회귀의 원인).
  }, [redraw]);

  const handleMouseLeave = useCallback(() => {
    if (hoveredRef.current === -1) return;
    hoveredRef.current = -1;
    redraw();
    if (canvasRef.current) canvasRef.current.style.cursor = '';
    dispatchPointHover(null);
  }, [redraw]);

  return (
    <canvas
      id="contextGrowthChart"
      ref={canvasRef}
      className={loading ? 'is-loading' : undefined}
      aria-busy={loading ? 'true' : undefined}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    />
  );
}
