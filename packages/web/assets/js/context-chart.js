// Accumulated Tokens Chart — Canvas 기반 턴별 누적 토큰 라인 차트
import { DETAIL_FILTER_CHANGED } from './events.js';
import {
  deriveContextWindowSize, formatContextWindowLabel, DEFAULT_CONTEXT_WINDOW,
} from './context-window.js';

/**
 * 차트 스케일·풋터·툴팁에 쓰일 한도값을 턴 배열에서 추론한다.
 *  - 가장 최신 prompt 턴의 model + anthropic_beta 기준 (세션 중 모델이 거의 바뀌지 않음).
 *  - prompt가 하나도 없으면 표준 200K로 안전 폴백.
 *
 * 반환값: { size, label, model } — UI 라벨링 일관성을 위해 함께 묶어 반환.
 */
function resolveSessionContextWindow(sortedTurns) {
  for (let i = sortedTurns.length - 1; i >= 0; i--) {
    const p = sortedTurns[i]?.prompt;
    if (p && p.model) {
      const size = deriveContextWindowSize(p.model, p.anthropic_beta);
      return { size, label: formatContextWindowLabel(size), model: p.model };
    }
  }
  return { size: DEFAULT_CONTEXT_WINDOW, label: formatContextWindowLabel(DEFAULT_CONTEXT_WINDOW), model: null };
}

let _canvas    = null;
let _footer    = null;
let _indicator = null;
let _empty     = null;
let _pointData = []; // [{cx, cy, turnIndex, value, delta}] — 마우스 hit-test 용
let _hoveredIdx = -1;
let _lastTurns  = null;
/**
 * 현재 렌더된 세션의 context window 정보. _onCanvasMouseMove가 hover 툴팁에
 * "사용률 %"·"한도 label"을 함께 전달하기 위해 renderContextChart에서 갱신한다.
 */
let _contextWindow = { size: 0, label: '', model: null };

function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getColors() {
  return {
    stroke:        getCssVar('--ctx-chart-stroke')         || getCssVar('--accent') || '#d97757',
    fillNorm:      getCssVar('--ctx-chart-fill-normal')    || 'rgba(217,119,87,0.22)',
    fillRemaining: getCssVar('--ctx-chart-fill-remaining') || 'rgba(255,255,255,0.025)',
    gridLine:      getCssVar('--ctx-chart-line-grid')      || 'rgba(255,255,255,0.04)',
    textDim:       getCssVar('--text-dim')                 || 'rgba(255,255,255,0.3)',
  };
}

function setEmptyState(isEmpty) {
  // ADR-017: hidden 속성과 클래스 둘 다 토글 (chartSection 안 신규 마크업 호환)
  if (_canvas) {
    _canvas.classList.toggle('context-chart-hidden', isEmpty);
  }
  if (_empty) {
    _empty.classList.toggle('context-chart-empty--visible', isEmpty);
    if (isEmpty) _empty.removeAttribute('hidden');
    else _empty.setAttribute('hidden', '');
  }
}

export function initContextChart() {
  _canvas    = document.getElementById('contextGrowthChart');
  _footer    = document.querySelector('.context-chart-footer');
  _indicator = document.getElementById('ctxUsageIndicator');
  _empty     = document.getElementById('contextChartEmpty');

  if (_canvas) {
    _canvas.addEventListener('mousemove', _onCanvasMouseMove);
    _canvas.addEventListener('mouseleave', _onCanvasMouseLeave);
  }

  // DETAIL_FILTER_CHANGED 구독 — 컨텍스트 차트 갱신
  document.addEventListener(DETAIL_FILTER_CHANGED, (e) => {
    const { allTurns } = e.detail;
    renderContextChart(allTurns);
  });
}

function _onCanvasMouseMove(e) {
  if (!_pointData.length) return;
  const rect = _canvas.getBoundingClientRect();
  const mx   = e.clientX - rect.left;
  const my   = e.clientY - rect.top;

  let nearestIdx = -1;
  let minDist    = Infinity;
  _pointData.forEach((pt, i) => {
    const d = Math.hypot(pt.cx - mx, pt.cy - my);
    if (d < minDist) { minDist = d; nearestIdx = i; }
  });

  const hitIdx = minDist < 15 ? nearestIdx : -1;

  if (hitIdx !== _hoveredIdx) {
    _hoveredIdx = hitIdx;
    renderContextChart(_lastTurns);
  }

  _canvas.style.cursor = hitIdx >= 0 ? 'crosshair' : '';

  if (hitIdx >= 0) {
    const pt = _pointData[hitIdx];
    // 모델 한도 대비 사용률(%) — 한도가 0이면 NaN 회피
    const pctOfWindow = _contextWindow.size > 0
      ? ((pt.value / _contextWindow.size) * 100).toFixed(1)
      : null;
    document.dispatchEvent(new CustomEvent('ctx-point-hover', {
      detail: {
        turnIndex:       pt.turnIndex,
        formattedValue:  fmtK(pt.value),
        formattedDelta:  pt.delta !== null ? _fmtDelta(pt.delta) : null,
        windowLabel:     _contextWindow.label || null,
        windowModel:     _contextWindow.model || null,
        usagePercent:    pctOfWindow,
        clientX:         e.clientX,
        clientY:         e.clientY,
      },
    }));
  } else {
    document.dispatchEvent(new CustomEvent('ctx-point-hover', { detail: null }));
  }
}

function _onCanvasMouseLeave() {
  if (_hoveredIdx !== -1) {
    _hoveredIdx = -1;
    renderContextChart(_lastTurns);
  }
  _canvas.style.cursor = '';
  document.dispatchEvent(new CustomEvent('ctx-point-hover', { detail: null }));
}

function _fmtDelta(n) {
  const sign = n >= 0 ? '+' : '-';
  const abs  = Math.abs(n);
  return sign + (abs >= 1000 ? `${(abs / 1000).toFixed(1)}K` : String(abs));
}

export function renderContextChart(turns) {
  if (!_canvas) return;
  _lastTurns = turns;

  // 유효 데이터가 하나라도 있는지 확인 (빈 상태 표시 여부 판단)
  const hasValid = (turns || []).some(t => t.prompt && (t.prompt.context_tokens > 0 || t.prompt.tokens_input > 0));
  if (!hasValid) {
    setEmptyState(true);
    if (_indicator) { _indicator.textContent = ''; _indicator.className = ''; }
    if (_footer)    _footer.textContent = '';
    return;
  }
  setEmptyState(false);

  // ctx=0인 턴도 포함 — 성장 곡선의 시작점으로 표시 (필터 없이 prompt 있는 모든 턴 사용)
  const sorted = (turns || []).filter(t => t.prompt).slice().sort((a, b) => a.turn_index - b.turn_index);
  const values = sorted.map(t => t.prompt.context_tokens || t.prompt.tokens_input || 0);

  // 모델 기반 실제 context window 한도 추론 — 200K 하드코딩 제거 (Opus 4.7은 1M GA 등)
  const cw = resolveSessionContextWindow(sorted);
  _contextWindow = cw; // hover 툴팁이 참조
  // Y축 상한은 "모델 한도"가 기준 — 사용률(%)이 시각적으로 그대로 드러나야 함.
  // 한도 초과 이상 케이스에만 values 최댓값으로 확장해 라인이 잘리지 않게 한다.
  const maxVal = Math.max(cw.size, ...values);
  const latest = values[values.length - 1];
  const pctOfWindow = cw.size > 0 ? (latest / cw.size) * 100 : 0;

  // 누적 토큰 인디케이터 — 실제 사용률(%) 함께 노출
  if (_indicator) {
    _indicator.textContent = window.I18n.t('ui.context-chart.indicator', { value: fmtK(latest), limit: cw.label, percent: pctOfWindow.toFixed(1) });
    _indicator.className = '';
  }

  // 푸터 힌트 — "참고 스케일" 대신 추론된 모델 한도를 명시
  if (_footer) {
    const last = sorted[sorted.length - 1];
    const modelSuffix = cw.model ? ` (${cw.model})` : '';
    _footer.textContent = window.I18n.t('ui.context-chart.footer', { turn: last.turn_index, max: fmtK(Math.max(...values)), limit: cw.label, model: modelSuffix });
  }

  // DPR 처리
  const dpr = window.devicePixelRatio || 1;
  const rect = _canvas.getBoundingClientRect();
  const W = rect.width  || _canvas.offsetWidth  || 400;
  const H = rect.height || _canvas.offsetHeight || 80;
  _canvas.width  = W * dpr;
  _canvas.height = H * dpr;

  const ctx = _canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // 캔버스 내부 여백 — 데이터 영역을 최대한 확보. 좌우는 첫/마지막 점이 잘리지 않을
  // 최소치, 상하는 라인 두께(1.5px)와 호버 글로우(radius 5)를 감안한 여유만.
  const PAD = { top: 4, right: 6, bottom: 4, left: 6 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top  - PAD.bottom;

  const cols   = getColors();
  const n      = values.length;
  const scaleY = (v) => PAD.top + cH - (v / maxVal) * cH;
  const scaleX = (i) => PAD.left + (n === 1 ? cW / 2 : (i / (n - 1)) * cW);

  // CSS pixel 좌표 미리 계산 (hit-test 와 동일 좌표계)
  const pts = values.map((v, i) => ({ cx: scaleX(i), cy: scaleY(v) }));

  // 마우스 hit-test 용 포인트 데이터 갱신
  _pointData = sorted.map((t, i) => ({
    cx:        pts[i].cx,
    cy:        pts[i].cy,
    turnIndex: t.turn_index,
    value:     values[i],
    delta:     i > 0 ? values[i] - values[i - 1] : null,
  }));

  // 격자선
  ctx.strokeStyle = cols.gridLine;
  ctx.lineWidth   = 1;
  for (let g = 1; g < 4; g++) {
    const y = PAD.top + (cH / 4) * g;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
  }

  // 영역 fill — 라인 위쪽(남은 한도)을 먼저, 그 다음 라인 아래(사용량)를 그려
  // 사용량 fill이 위에 얹혀 라인 경계가 또렷이 보이도록 한다.
  // 1) 라인 위쪽 = 남은 한도 (옅은 fill)
  ctx.beginPath();
  if (n === 1) {
    ctx.moveTo(PAD.left,           pts[0].cy);
    ctx.lineTo(PAD.left,           PAD.top);
    ctx.lineTo(PAD.left + cW,      PAD.top);
    ctx.lineTo(PAD.left + cW,      pts[0].cy);
  } else {
    ctx.moveTo(pts[0].cx, pts[0].cy);
    ctx.lineTo(pts[0].cx, PAD.top);
    ctx.lineTo(pts[n - 1].cx, PAD.top);
    ctx.lineTo(pts[n - 1].cx, pts[n - 1].cy);
    for (let i = n - 2; i >= 0; i--) ctx.lineTo(pts[i].cx, pts[i].cy);
  }
  ctx.closePath();
  ctx.fillStyle = cols.fillRemaining;
  ctx.fill();

  // 2) 라인 아래쪽 = 사용량 (진한 fill)
  ctx.beginPath();
  if (n === 1) {
    // 단일 데이터: 전체 너비에 수평 라인 높이로 fill
    ctx.moveTo(PAD.left,           pts[0].cy);
    ctx.lineTo(PAD.left + cW,      pts[0].cy);
    ctx.lineTo(PAD.left + cW,      PAD.top + cH);
    ctx.lineTo(PAD.left,           PAD.top + cH);
  } else {
    ctx.moveTo(pts[0].cx, pts[0].cy);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].cx, pts[i].cy);
    ctx.lineTo(pts[n - 1].cx, PAD.top + cH);
    ctx.lineTo(pts[0].cx,     PAD.top + cH);
  }
  ctx.closePath();
  ctx.fillStyle = cols.fillNorm;
  ctx.fill();

  // 라인
  ctx.beginPath();
  if (n === 1) {
    // 단일 데이터: 전체 너비에 수평선
    ctx.moveTo(PAD.left,      pts[0].cy);
    ctx.lineTo(PAD.left + cW, pts[0].cy);
  } else {
    ctx.moveTo(pts[0].cx, pts[0].cy);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].cx, pts[i].cy);
  }
  ctx.strokeStyle = cols.stroke;
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  // 호버 포인트 — 수직 점선 가이드
  if (_hoveredIdx >= 0 && _pointData[_hoveredIdx]) {
    const hp = _pointData[_hoveredIdx];
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(hp.cx, hp.cy + 6);
    ctx.lineTo(hp.cx, PAD.top + cH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 일반 데이터 포인트
  ctx.fillStyle = cols.stroke;
  for (let i = 0; i < n; i++) {
    if (i === _hoveredIdx) continue;
    ctx.beginPath();
    ctx.arc(pts[i].cx, pts[i].cy, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 호버 포인트 — 확대 + glow
  if (_hoveredIdx >= 0 && _pointData[_hoveredIdx]) {
    const hp = _pointData[_hoveredIdx];
    ctx.save();
    ctx.fillStyle   = cols.stroke;
    ctx.shadowColor = cols.stroke;
    ctx.shadowBlur  = 10;
    ctx.beginPath();
    ctx.arc(hp.cx, hp.cy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur  = 0;
    ctx.restore();
  }
}

function fmtK(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function clearContextChart() {
  if (!_canvas) return;
  _pointData  = [];
  _hoveredIdx = -1;
  _lastTurns  = null;
  setEmptyState(true);
  if (_indicator) { _indicator.textContent = ''; _indicator.className = ''; }
  if (_footer)    _footer.textContent = '';
}
