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
import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  computeContextChartModel,
  computePoints,
  type ContextTurn,
  type ChartDims,
} from './context-chart-data';

const PAD = { top: 4, right: 6, bottom: 4, left: 6 };

// Chart.tsx hasRealDom 가드와 동일 — 스텁/서버 환경은 useEffect 로 폴백(SSR 경고 회피).
const hasRealDom =
  typeof window !== 'undefined' &&
  typeof (window as Window & typeof globalThis).document?.createElement === 'function';
const useIsomorphicLayoutEffect = hasRealDom ? useLayoutEffect : useEffect;

function getCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined' || !window.getComputedStyle) return fallback;
  return (
    window.getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  );
}

/**
 * 누적 토큰 차트 명령형 그리기. null/ctx-null/빈데이터 가드(SSR·canvas 미구현 안전).
 * "무엇을 그릴지"는 context-chart-data(순수)가 결정, 본 함수는 ctx 호출만.
 */
export function drawContextChartToCanvas(
  canvas: HTMLCanvasElement | null,
  turns: ReadonlyArray<ContextTurn> | null | undefined,
): void {
  if (!canvas) return;
  const model = computeContextChartModel(turns);
  if (!model) return; // 빈 상태 — 그리지 않음(컴포넌트가 empty 표시 토글)
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

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

  // 데이터 포인트
  ctx.fillStyle = stroke;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.arc(pts[i].cx, pts[i].cy, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

export interface ContextChartProps {
  /** 세션 턴 배열(누적 토큰). 컨트롤드 — 호출처(상세뷰 계층) 주입. */
  turns: ReadonlyArray<ContextTurn> | null;
}

/**
 * 누적 토큰 차트 컴포넌트. canvas 그리기는 useLayoutEffect(측정 후 paint 전, Chart.tsx 동형).
 * turns 변경 시 재그림. SSR/단위테스트(renderToStaticMarkup)에서 효과 미발화(throw 없음).
 */
export function ContextChart({ turns }: ContextChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useIsomorphicLayoutEffect(() => {
    drawContextChartToCanvas(canvasRef.current, turns);
  }, [turns]);

  return <canvas id="contextGrowthChart" ref={canvasRef} />;
}
