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
// 화면맞춤(zoom-to-fit) 정책 SSoT
// =============================================================================

/** 콘텐츠가 뷰포트에서 차지할 목표 비율 — 사방 여백 확보용 (0.8 = 80%). */
const FIT_PADDING_RATIO = 0.8;
/** 노드가 많아도 형태 인지 가능한 하한. */
const FIT_MIN_SCALE = 0.25;
/** 노드가 1~2개일 때 카드가 화면을 찢지 않도록 상한. */
const FIT_MAX_SCALE = 1.2;

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
 * @param {number} [opts.durationMs] 600 ms 기본.
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

/**
 * 콘텐츠 bbox + 컨테이너 픽셀 크기로 화면맞춤(zoom-to-fit) viewBox 를 계산.
 *
 * viewBox 모델 적용 메모:
 *   SVG 가 preserveAspectRatio="xMidYMid meet" 이므로 실제 렌더 scale = min(cW/vbW, cH/vbH).
 *   transform/scale 그룹과 달리 scale 을 직접 set 할 수 없어, 역으로
 *     vbW = cW / scale, vbH = cH / scale
 *   로 두면 meet scale 이 정확히 우리가 고른 scale 이 되고, viewBox 종횡비가 컨테이너와
 *   일치해 레터박스 여백이 사라진다(과도 축소·여백 낭비의 근본 원인 제거). 중심은 bbox 중심에 맞춘다.
 *
 * @param {SVGSVGElement} svgEl  SVG 루트 — getBoundingClientRect 로 컨테이너 픽셀 크기 측정.
 * @param {{x:number,y:number,width:number,height:number}} bbox  콘텐츠의 SVG 좌표 경계.
 * @param {object} [opts]
 * @param {number} [opts.padRatio] 콘텐츠 목표 점유율 (기본 0.8).
 * @param {number} [opts.minScale] scale 하한 (기본 0.25).
 * @param {number} [opts.maxScale] scale 상한 (기본 1.2).
 * @returns {{x:number,y:number,w:number,h:number}|null}
 *   적용 가능한 viewBox. 컨테이너/콘텐츠 측정 불가(숨김 패널 등) 시 null — 호출자가 폴백.
 */
export function computeFitView(svgEl, bbox, opts) {
  if (!svgEl || !bbox) return null;
  if (!(bbox.width > 0) || !(bbox.height > 0)) return null;
  const rect = svgEl.getBoundingClientRect();
  const cW = rect.width;
  const cH = rect.height;
  if (!(cW > 0) || !(cH > 0)) return null;

  const padRatio = opts?.padRatio ?? FIT_PADDING_RATIO;
  const minScale = opts?.minScale ?? FIT_MIN_SCALE;
  const maxScale = opts?.maxScale ?? FIT_MAX_SCALE;

  // 가로/세로 중 더 빡빡한 쪽을 기준으로 fit, 그 뒤 scale 한계로 가둔다.
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

/**
 * viewState 를 target viewBox 로 전환 — 즉시 또는 ease-in-out 애니메이션.
 *
 * focusOnNode 와 동일한 rAF/이징을 쓰되, 절대 viewBox 를 직접 받는다(fit 결과 적용용).
 *
 * @param {SVGSVGElement} svgEl
 * @param {{x:number,y:number,w:number,h:number}} viewState  *in-place* 갱신.
 * @param {{x:number,y:number,w:number,h:number}} target
 * @param {object} [opts]
 * @param {boolean} [opts.immediate] true 면 트윈 없이 즉시 적용 (초기 로드용).
 * @param {number} [opts.durationMs] 600 ms 기본.
 * @param {() => void} [opts.onDone]
 */
export function animateToView(svgEl, viewState, target, opts) {
  if (!svgEl || !viewState || !target) return;
  const { immediate = false, durationMs = DEFAULT_DURATION_MS, onDone = null } = opts || {};

  if (immediate || durationMs <= 0) {
    viewState.x = target.x;
    viewState.y = target.y;
    viewState.w = target.w;
    viewState.h = target.h;
    applyViewBox(svgEl, viewState);
    if (typeof onDone === 'function') onDone();
    return;
  }

  const dur = clamp(durationMs, MIN_DURATION_MS, MAX_DURATION_MS);
  const fromX = viewState.x;
  const fromY = viewState.y;
  const fromW = viewState.w;
  const fromH = viewState.h;

  const t0 = performance.now();
  function step(now) {
    const t = Math.min(1, (now - t0) / dur);
    const e = easeInOutCubic(t);
    viewState.x = fromX + (target.x - fromX) * e;
    viewState.y = fromY + (target.y - fromY) * e;
    viewState.w = fromW + (target.w - fromW) * e;
    viewState.h = fromH + (target.h - fromH) * e;
    applyViewBox(svgEl, viewState);
    if (t < 1) {
      requestAnimationFrame(step);
    } else if (typeof onDone === 'function') {
      onDone();
    }
  }
  requestAnimationFrame(step);
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
