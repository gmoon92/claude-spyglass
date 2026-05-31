/**
 * features/meta-docs/flow-camera.ts — viewBox 카메라 fit/이징/트윈 (P4-03)
 *
 * 원본: assets/js/meta-docs-flow-camera.js 전량(camera.js)을 TS 로 1:1 이식. 외부 의존 0(camera.js:9).
 *   computeFitView/easeInOutCubic 는 순수 계산(단위테스트), animateToView/focusOnNode 는 rAF 트윈
 *   (MetaDocsFlow effect 가 호출). viewState 는 *in-place* 갱신(arch §4.2).
 *
 * @module features/meta-docs/flow-camera
 */

export interface ViewState {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ContentBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 애니메이션 정책 SSoT (camera.js:31-34).
const DEFAULT_DURATION_MS = 600;
const DEFAULT_ZOOM = 1.0;
const MIN_DURATION_MS = 120;
const MAX_DURATION_MS = 1500;

// 화면맞춤 정책 SSoT (camera.js:41-45).
const FIT_PADDING_RATIO = 0.8;
const FIT_MIN_SCALE = 0.25;
const FIT_MAX_SCALE = 1.2;

/** cubic ease-in-out. 0..1 → 0..1. (camera.js:55) */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** viewState → SVG viewBox 문자열 "x y w h". (camera.js:236) */
export function viewBoxStr(v: ViewState): string {
  return `${v.x} ${v.y} ${v.w} ${v.h}`;
}

function applyViewBox(svgEl: SVGSVGElement, v: ViewState): void {
  svgEl.setAttribute('viewBox', viewBoxStr(v));
}

export interface FocusOpts {
  cx: number;
  cy: number;
  zoom?: number;
  durationMs?: number;
  onDone?: (() => void) | null;
}

/** SVG viewBox 를 (cx, cy) 중심으로 rAF 부드럽게 이동. (camera.js:75) */
export function focusOnNode(svgEl: SVGSVGElement | null, viewState: ViewState | null, opts: FocusOpts): void {
  if (!svgEl || !viewState) return;
  const { cx, cy, zoom = DEFAULT_ZOOM, durationMs = DEFAULT_DURATION_MS, onDone = null } = opts || {};
  const dur = clamp(durationMs, MIN_DURATION_MS, MAX_DURATION_MS);

  const fromX = viewState.x;
  const fromY = viewState.y;
  const fromW = viewState.w;
  const fromH = viewState.h;
  const targetW = fromW / zoom;
  const targetH = fromH / zoom;
  const toX = cx - targetW / 2;
  const toY = cy - targetH / 2;

  const t0 = performance.now();
  function step(now: number): void {
    const t = Math.min(1, (now - t0) / dur);
    const e = easeInOutCubic(t);
    viewState!.x = fromX + (toX - fromX) * e;
    viewState!.y = fromY + (toY - fromY) * e;
    viewState!.w = fromW + (targetW - fromW) * e;
    viewState!.h = fromH + (targetH - fromH) * e;
    applyViewBox(svgEl!, viewState!);
    if (t < 1) requestAnimationFrame(step);
    else if (typeof onDone === 'function') onDone();
  }
  requestAnimationFrame(step);
}

export interface FitOpts {
  padRatio?: number;
  minScale?: number;
  maxScale?: number;
}

/**
 * 콘텐츠 bbox + 컨테이너 픽셀 크기로 화면맞춤 viewBox 계산. (camera.js:155)
 * 측정 불가(숨김 패널 등) 시 null — 호출자가 폴백.
 */
export function computeFitView(svgEl: SVGSVGElement | null, bbox: ContentBox | null, opts?: FitOpts): ViewState | null {
  if (!svgEl || !bbox) return null;
  if (!(bbox.width > 0) || !(bbox.height > 0)) return null;
  const rect = svgEl.getBoundingClientRect();
  const cW = rect.width;
  const cH = rect.height;
  if (!(cW > 0) || !(cH > 0)) return null;

  const padRatio = opts?.padRatio ?? FIT_PADDING_RATIO;
  const minScale = opts?.minScale ?? FIT_MIN_SCALE;
  const maxScale = opts?.maxScale ?? FIT_MAX_SCALE;

  const scaleX = (cW * padRatio) / bbox.width;
  const scaleY = (cH * padRatio) / bbox.height;
  let scale = Math.min(scaleX, scaleY);
  scale = Math.max(minScale, Math.min(maxScale, scale));

  const vbW = cW / scale;
  const vbH = cH / scale;
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  return { x: cx - vbW / 2, y: cy - vbH / 2, w: vbW, h: vbH };
}

/** viewState 를 target 으로 *즉시* 적용(트윈 없음). (camera.js:197-205) — 초기 로드용. */
export function applyImmediate(svgEl: SVGSVGElement | null, viewState: ViewState, target: ViewState): void {
  viewState.x = target.x;
  viewState.y = target.y;
  viewState.w = target.w;
  viewState.h = target.h;
  if (svgEl) applyViewBox(svgEl, viewState);
}

export interface AnimateOpts {
  immediate?: boolean;
  durationMs?: number;
  onDone?: (() => void) | null;
}

/** viewState 를 target viewBox 로 전환 — 즉시 또는 ease-in-out rAF. (camera.js:193) */
export function animateToView(
  svgEl: SVGSVGElement | null,
  viewState: ViewState | null,
  target: ViewState | null,
  opts?: AnimateOpts,
): void {
  if (!svgEl || !viewState || !target) return;
  const { immediate = false, durationMs = DEFAULT_DURATION_MS, onDone = null } = opts || {};

  if (immediate || durationMs <= 0) {
    applyImmediate(svgEl, viewState, target);
    if (typeof onDone === 'function') onDone();
    return;
  }

  const dur = clamp(durationMs, MIN_DURATION_MS, MAX_DURATION_MS);
  const fromX = viewState.x;
  const fromY = viewState.y;
  const fromW = viewState.w;
  const fromH = viewState.h;

  const t0 = performance.now();
  function step(now: number): void {
    const t = Math.min(1, (now - t0) / dur);
    const e = easeInOutCubic(t);
    viewState!.x = fromX + (target!.x - fromX) * e;
    viewState!.y = fromY + (target!.y - fromY) * e;
    viewState!.w = fromW + (target!.w - fromW) * e;
    viewState!.h = fromH + (target!.h - fromH) * e;
    applyViewBox(svgEl!, viewState!);
    if (t < 1) requestAnimationFrame(step);
    else if (typeof onDone === 'function') onDone();
  }
  requestAnimationFrame(step);
}
