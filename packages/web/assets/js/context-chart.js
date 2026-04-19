// Context Growth Chart — Canvas 기반 턴별 토큰 라인 차트
const CTX_MAX_TOKENS = 200_000; // claude 기준 컨텍스트 한도
const WARN_RATIO     = 0.80;    // 경고 임계값

let _canvas = null;
let _footer = null;
let _indicator = null;

function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getColors() {
  return {
    stroke:    getCssVar('--ctx-chart-stroke') || getCssVar('--accent') || '#d97757',
    fillNorm:  getCssVar('--ctx-chart-fill-normal') || 'rgba(217,119,87,0.12)',
    fillWarn:  getCssVar('--ctx-chart-fill-warn')   || 'rgba(245,158,11,0.12)',
    warnLine:  getCssVar('--ctx-chart-line-warn')   || 'rgba(245,158,11,0.55)',
    gridLine:  getCssVar('--ctx-chart-line-grid')   || 'rgba(255,255,255,0.04)',
    textDim:   getCssVar('--text-dim')              || 'rgba(255,255,255,0.3)',
  };
}

export function initContextChart() {
  _canvas    = document.getElementById('contextGrowthChart');
  _footer    = document.querySelector('.context-chart-footer');
  _indicator = document.getElementById('ctxUsageIndicator');
}

export function renderContextChart(turns) {
  if (!_canvas) return;
  const section = _canvas.closest('.context-chart-section');

  // 유효 데이터가 하나라도 있는지 확인 (섹션 표시 여부 판단)
  const hasValid = (turns || []).some(t => t.prompt && (t.prompt.context_tokens > 0 || t.prompt.tokens_input > 0));
  if (!hasValid) {
    if (section) section.style.display = 'none';
    return;
  }
  if (section) section.style.display = '';

  // ctx=0인 턴도 포함 — 성장 곡선의 시작점으로 표시 (필터 없이 prompt 있는 모든 턴 사용)
  const sorted = (turns || []).filter(t => t.prompt).slice().sort((a, b) => a.turn_index - b.turn_index);
  const values = sorted.map(t => t.prompt.context_tokens || t.prompt.tokens_input || 0);
  const maxVal = Math.max(...values, CTX_MAX_TOKENS * 0.1); // 최소 스케일
  const warnY  = CTX_MAX_TOKENS * WARN_RATIO;
  const latest = values[values.length - 1];
  const usePct = Math.round((latest / CTX_MAX_TOKENS) * 100);

  // 사용률 인디케이터 업데이트
  if (_indicator) {
    _indicator.textContent = `${usePct}% (${fmtK(latest)})`;
    _indicator.className = usePct >= 95 ? 'crit' : usePct >= 80 ? 'warn' : '';
  }

  // 푸터 힌트
  if (_footer) {
    const last = sorted[sorted.length - 1];
    _footer.textContent = `Turn ${last.turn_index} · 최대 ${fmtK(Math.max(...values))} tokens · 한도 ${fmtK(CTX_MAX_TOKENS)}`;
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

  const PAD = { top: 8, right: 16, bottom: 8, left: 16 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top  - PAD.bottom;

  const cols    = getColors();
  const n       = values.length;
  const scaleY  = (v) => PAD.top + cH - (v / Math.max(maxVal, warnY * 1.05)) * cH;
  const scaleX  = (i) => PAD.left + (n === 1 ? cW / 2 : (i / (n - 1)) * cW);

  // 격자선
  ctx.strokeStyle = cols.gridLine;
  ctx.lineWidth   = 1;
  for (let g = 1; g < 4; g++) {
    const y = PAD.top + (cH / 4) * g;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
  }

  // 80% 경고 기준선
  const warnYPx = scaleY(warnY);
  if (warnYPx >= PAD.top && warnYPx <= PAD.top + cH) {
    ctx.save();
    ctx.strokeStyle = cols.warnLine;
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(PAD.left, warnYPx); ctx.lineTo(PAD.left + cW, warnYPx); ctx.stroke();
    ctx.restore();
  }

  // 영역 fill
  const isWarn = latest >= warnY;
  ctx.beginPath();
  ctx.moveTo(scaleX(0), scaleY(values[0]));
  for (let i = 1; i < n; i++) ctx.lineTo(scaleX(i), scaleY(values[i]));
  ctx.lineTo(scaleX(n - 1), PAD.top + cH);
  ctx.lineTo(scaleX(0),     PAD.top + cH);
  ctx.closePath();
  ctx.fillStyle = isWarn ? cols.fillWarn : cols.fillNorm;
  ctx.fill();

  // 라인
  ctx.beginPath();
  ctx.moveTo(scaleX(0), scaleY(values[0]));
  for (let i = 1; i < n; i++) ctx.lineTo(scaleX(i), scaleY(values[i]));
  ctx.strokeStyle = isWarn ? cols.warnLine.replace('0.55', '0.9') : cols.stroke;
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  // 데이터 포인트
  ctx.fillStyle = isWarn ? cols.warnLine.replace('0.55', '0.9') : cols.stroke;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.arc(scaleX(i), scaleY(values[i]), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function fmtK(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function clearContextChart() {
  if (!_canvas) return;
  const section = _canvas.closest('.context-chart-section');
  if (section) section.style.display = 'none';
  if (_indicator) { _indicator.textContent = ''; _indicator.className = ''; }
  if (_footer)    _footer.textContent = '';
}
