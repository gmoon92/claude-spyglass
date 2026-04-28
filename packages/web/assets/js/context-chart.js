// Accumulated Tokens Chart — Canvas 기반 턴별 누적 토큰 라인 차트
import { DETAIL_FILTER_CHANGED } from './events.js';

const REFERENCE_SCALE_TOKENS = 200_000; // Claude 모델 참고 스케일 (실제 한도는 모델별 상이)

let _canvas = null;
let _footer = null;
let _indicator = null;
let _empty = null;

function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getColors() {
  return {
    stroke:    getCssVar('--ctx-chart-stroke') || getCssVar('--accent') || '#d97757',
    fillNorm:  getCssVar('--ctx-chart-fill-normal') || 'rgba(217,119,87,0.12)',
    gridLine:  getCssVar('--ctx-chart-line-grid')   || 'rgba(255,255,255,0.04)',
    textDim:   getCssVar('--text-dim')              || 'rgba(255,255,255,0.3)',
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

  // DETAIL_FILTER_CHANGED 구독 — 컨텍스트 차트 갱신
  document.addEventListener(DETAIL_FILTER_CHANGED, (e) => {
    const { allTurns } = e.detail;
    renderContextChart(allTurns);
  });
}

export function renderContextChart(turns) {
  if (!_canvas) return;

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
  const maxVal = Math.max(...values, REFERENCE_SCALE_TOKENS * 0.1); // 최소 스케일
  const latest = values[values.length - 1];

  // 누적 토큰 인디케이터 업데이트
  if (_indicator) {
    _indicator.textContent = `누적 ${fmtK(latest)} tokens`;
    _indicator.className = '';
  }

  // 푸터 힌트
  if (_footer) {
    const last = sorted[sorted.length - 1];
    _footer.textContent = `Turn ${last.turn_index} · 최대 ${fmtK(Math.max(...values))} tokens · 참고 스케일: ${fmtK(REFERENCE_SCALE_TOKENS)} (모델별 상이)`;
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
  const scaleY  = (v) => PAD.top + cH - (v / maxVal) * cH;
  const scaleX  = (i) => PAD.left + (n === 1 ? cW / 2 : (i / (n - 1)) * cW);

  // 격자선
  ctx.strokeStyle = cols.gridLine;
  ctx.lineWidth   = 1;
  for (let g = 1; g < 4; g++) {
    const y = PAD.top + (cH / 4) * g;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
  }

  // 영역 fill
  ctx.beginPath();
  ctx.moveTo(scaleX(0), scaleY(values[0]));
  for (let i = 1; i < n; i++) ctx.lineTo(scaleX(i), scaleY(values[i]));
  ctx.lineTo(scaleX(n - 1), PAD.top + cH);
  ctx.lineTo(scaleX(0),     PAD.top + cH);
  ctx.closePath();
  ctx.fillStyle = cols.fillNorm;
  ctx.fill();

  // 라인
  ctx.beginPath();
  ctx.moveTo(scaleX(0), scaleY(values[0]));
  for (let i = 1; i < n; i++) ctx.lineTo(scaleX(i), scaleY(values[i]));
  ctx.strokeStyle = cols.stroke;
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  // 데이터 포인트
  ctx.fillStyle = cols.stroke;
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
  setEmptyState(true);
  if (_indicator) { _indicator.textContent = ''; _indicator.className = ''; }
  if (_footer)    _footer.textContent = '';
}
