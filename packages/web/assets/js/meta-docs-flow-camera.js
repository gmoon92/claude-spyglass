/**
 * meta-docs-flow-camera.js — viewBox 카메라 이동 헬퍼 (두 모드 공용)
 *
 * 책임:
 *   특정 노드 좌표를 받아 SVG viewBox 를 그 노드 중앙으로 부드럽게 이동시킨다.
 *   requestAnimationFrame 기반 ease-in-out cubic 보간 — 외부 라이브러리 의존 0
 *   (06 보고서 §5.1 권고).
 *
 * 의존성:
 *   - 없음 (순수 DOM/SVG + rAF).
 *
 * 호출자:
 *   - meta-docs-flow-view.js (ego 모드의 카탈로그 행 클릭 시)
 *   - meta-docs-flow-sequential.js (순서도 모드의 노드 포커싱)
 *
 * 사용 예:
 *   import { focusOnNode } from './meta-docs-flow-camera.js';
 *   focusOnNode(svgEl, viewState, { cx: 420, cy: 180, zoom: 1.2, durationMs: 600 });
 *
 * viewState 객체 구조 (caller 가 관리하는 모듈 상태):
 *   { x, y, w, h }  — SVG viewBox 의 현재 값. focusOnNode 가 *in-place* 갱신.
 *
 * 시각 어휘 (메모리: feedback_chip_color_semantics):
 *   본 모듈은 색상에 관여하지 않는다 — 좌표만 이동. 강조는 highlight.js 책임.
 */

// =============================================================================
// 상수 — 애니메이션 정책 SSoT
// =============================================================================

const DEFAULT_DURATION_MS = 600;
const DEFAULT_ZOOM = 1.0;
const MIN_DURATION_MS = 120; // 너무 짧으면 사용자가 인지 불가.
const MAX_DURATION_MS = 1500; // 너무 길면 답답함.

// =============================================================================
// 이징 함수 — cubic ease-in-out (06 §5.1 권고)
// =============================================================================

/**
 * cubic ease-in-out. 0..1 입력 → 0..1 출력. 시작/끝은 느리고 중간이 빠르다.
 * d3-zoom 의 기본 transition 과 동등한 느낌.
 */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// =============================================================================
// 메인 API
// =============================================================================

/**
 * SVG viewBox 를 특정 좌표(cx, cy) 중심으로 부드럽게 이동.
 *
 * @param {SVGSVGElement} svgEl SVG 루트 요소.
 * @param {{x:number, y:number, w:number, h:number}} viewState viewBox 모듈 상태 — *in-place* 갱신.
 * @param {object} opts
 * @param {number} opts.cx       타깃 중심 x (SVG 좌표).
 * @param {number} opts.cy       타깃 중심 y (SVG 좌표).
 * @param {number} [opts.zoom]   타깃 줌 (1=기본, 1.5=확대). 미지정 시 현 줌 유지.
 * @param {number} [opts.durationMs] 600ms 기본.
 * @param {() => void} [opts.onDone] 완료 콜백 (예: 강조 해제).
 */
export function focusOnNode(svgEl, viewState, opts) {
  if (!svgEl || !viewState) return;
  const {
    cx,
    cy,
    zoom = DEFAULT_ZOOM,
    durationMs = DEFAULT_DURATION_MS,
    onDone = null,
  } = opts || {};

  const dur = clamp(durationMs, MIN_DURATION_MS, MAX_DURATION_MS);

  // 시작 viewBox.
  const fromX = viewState.x;
  const fromY = viewState.y;
  const fromW = viewState.w;
  const fromH = viewState.h;

  // 타깃 viewBox — 노드 중심이 가운데 오도록.
  //   zoom > 1 이면 viewBox 가 작아져 화면이 크게 보임.
  //   현재 사용 zoom 비율 산출 — 초기 _view 와 무관하게 현 viewBox 크기 기준 비율.
  const targetW = fromW / zoom;
  const targetH = fromH / zoom;
  const toX = cx - targetW / 2;
  const toY = cy - targetH / 2;

  const t0 = performance.now();
  function step(now) {
    const elapsed = now - t0;
    const t = Math.min(1, elapsed / dur);
    const e = easeInOutCubic(t);

    viewState.x = fromX + (toX - fromX) * e;
    viewState.y = fromY + (toY - fromY) * e;
    viewState.w = fromW + (targetW - fromW) * e;
    viewState.h = fromH + (targetH - fromH) * e;
    applyViewBox(svgEl, viewState);

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      if (typeof onDone === 'function') onDone();
    }
  }
  requestAnimationFrame(step);
}

/**
 * 노드의 SVG 좌표를 계산해 focusOnNode 에 그대로 전달하는 편의 래퍼.
 *
 * @param {SVGSVGElement} svgEl
 * @param {{x:number, y:number, w:number, h:number}} viewState
 * @param {{x:number, y:number, w:number, h:number}} nodeBox  노드의 SVG 좌표 박스.
 * @param {object} [opts] focusOnNode 옵션 (zoom, durationMs, onDone).
 */
export function focusOnNodeBox(svgEl, viewState, nodeBox, opts) {
  const cx = nodeBox.x + nodeBox.w / 2;
  const cy = nodeBox.y + nodeBox.h / 2;
  focusOnNode(svgEl, viewState, { ...(opts || {}), cx, cy });
}

// =============================================================================
// 내부 헬퍼
// =============================================================================

function applyViewBox(svgEl, v) {
  svgEl.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
