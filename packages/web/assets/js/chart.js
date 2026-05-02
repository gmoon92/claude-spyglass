// Canvas 차트 모듈 — 타임라인 + 도넛 (외부 의존 없음)

const COLORS = {
  accent:  '#d97757',
  green:   '#4ade80',
  orange:  '#f59e0b',
  blue:    '#60a5fa',
  red:     '#ef4444',
  border:  '#272727',
  card:    '#161616',
  text:    '#e8e8e8',
  textDim: '#888888',
};

// CSS 변수와 동기화 (ADR-003). setTypeColors()로 덮어씀
export const TYPE_COLORS = {
  prompt:    COLORS.accent,
  tool_call: COLORS.green,
  system:    COLORS.orange,
};

const TIMELINE_BUCKETS = 30;
let timelineBuckets  = Array(TIMELINE_BUCKETS).fill(0);
let lastBucketMinute = -1;

// ADR-008: 도넛 모드 ('type' | 'model' | 'cache') — donut-mode-toggle은 폐기되었지만 모드 SSoT는 유지.
// default 모드 진입 시 setChartMode가 setDonutMode('model')을 호출 (model 분포 노출).
// detail 모드 진입 시 setChartMode가 setDonutMode('cache')을 호출 (캐시 퍼포먼스 — ADR-WDO-010).
// 초기값 'model' — default 모드가 첫 화면이므로.
let donutMode = 'model';
const dataByKind = { type: [], model: [], cache: [] };
let typeData = dataByKind.type;   // drawDonut/renderTypeLegend가 참조하는 활성 데이터셋

/**
 * 데이터 종류별로 캐시한다. 현재 donutMode와 일치하는 종류만 화면에 즉시 반영.
 * @param {'type'|'model'|'cache'} kind
 * @param {Array} data
 */
export function setSourceData(kind, data) {
  if (kind !== 'type' && kind !== 'model' && kind !== 'cache') return;
  dataByKind[kind] = Array.isArray(data) ? data : [];
  if (kind === donutMode) typeData = dataByKind[kind];
}
/** 후방 호환: 기존 setTypeData(data) 호출은 type 종류로 위임 */
export function setTypeData(data) { setSourceData('type', data); }
export function setDonutMode(mode) {
  donutMode = ['model', 'cache', 'type'].includes(mode) ? mode : 'type';
  typeData = dataByKind[donutMode] || [];
}
export function getDonutMode() { return donutMode; }
export function hasSourceData(kind) { return Array.isArray(dataByKind[kind]) && dataByKind[kind].length > 0; }
// 모델 라벨 → 색상 매핑 (간단한 hash 기반 분배 — TYPE_COLORS와 비슷한 톤)
const MODEL_PALETTE = ['#FF7A45', '#34D399', '#fbbf24', '#60a5fa', '#fb923c', '#f472b6', '#22d3ee', '#94a3b8'];
function modelColor(_model, idx) {
  return MODEL_PALETTE[idx % MODEL_PALETTE.length];
}
function donutItemKey(d, _idx) {
  if (donutMode === 'cache') return d.label || '?';
  return donutMode === 'model' ? (d.model || '?') : (d.type || '?');
}
function cacheItemColor(d) {
  const map = { 'Cached': '#34D399', 'Cache Write': '#58A6FF', 'Uncached': '#6E7681' };
  return map[d.label] || COLORS.textDim;
}
function donutItemColor(d, idx) {
  if (donutMode === 'cache') return cacheItemColor(d);
  return donutMode === 'model' ? modelColor(d.model, idx) : (TYPE_COLORS[d.type] || COLORS.textDim);
}
function donutItemCount(d) {
  if (donutMode === 'cache') return d.tokens || 0;
  return donutMode === 'model' ? (d.request_count || 0) : (d.count || 0);
}

export function initTypeColors() {
  const s = getComputedStyle(document.documentElement);
  TYPE_COLORS.prompt    = s.getPropertyValue('--type-prompt-color').trim()    || COLORS.accent;
  TYPE_COLORS.tool_call = s.getPropertyValue('--type-tool_call-color').trim() || COLORS.green;
  TYPE_COLORS.system    = s.getPropertyValue('--type-system-color').trim()    || COLORS.orange;
}

export function nowMinute() { return Math.floor(Date.now() / 60000); }

export function advanceBuckets() {
  const cur = nowMinute();
  if (lastBucketMinute === -1) { lastBucketMinute = cur; return; }
  const diff  = cur - lastBucketMinute;
  if (diff <= 0) return;
  const shift = Math.min(diff, TIMELINE_BUCKETS);
  timelineBuckets  = [...timelineBuckets.slice(shift), ...Array(shift).fill(0)];
  lastBucketMinute = cur;
}

export function recordRequest() {
  advanceBuckets();
  if (lastBucketMinute === -1) lastBucketMinute = nowMinute();
  timelineBuckets[timelineBuckets.length - 1]++;
}

export function initBuckets() {
  lastBucketMinute = nowMinute();
}

export function drawTimeline() {
  const canvas = document.getElementById('timelineChart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w   = canvas.parentElement.clientWidth - 32;
  const h   = 100;
  if (w <= 0) return;
  canvas.width  = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width  = w + 'px';
  canvas.style.height = h + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  advanceBuckets();
  const data   = timelineBuckets;
  const maxVal = Math.max(...data, 1);
  const n      = data.length;
  const padL = 26, padR = 8, padT = 6, padB = 18;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth   = 0.5;
  [0, 0.5, 1].forEach(t => {
    const y = padT + chartH * (1 - t);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    if (t > 0) {
      ctx.fillStyle  = COLORS.textDim;
      ctx.font       = '9px monospace';
      ctx.textAlign  = 'right';
      ctx.fillText(Math.round(maxVal * t), padL - 3, y + 3);
    }
  });

  ctx.fillStyle  = COLORS.textDim;
  ctx.font       = '9px monospace';
  ctx.textAlign  = 'center';
  const curMin   = nowMinute();
  [0, Math.floor(n / 2), n - 1].forEach(i => {
    const minsAgo = n - 1 - i;
    const ts      = new Date((curMin - minsAgo) * 60000);
    const label   = ts.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const x       = padL + (i / (n - 1)) * chartW;
    ctx.fillText(label, x, h - 3);
  });

  const pts = data.map((v, i) => ({
    x: padL + (i / (n - 1)) * chartW,
    y: padT + chartH * (1 - v / maxVal),
  }));

  const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH);
  grad.addColorStop(0, 'rgba(217,119,87,0.3)');
  grad.addColorStop(1, 'rgba(217,119,87,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, padT + chartH);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, padT + chartH);
  ctx.closePath();
  ctx.fill();

  // sparkline stroke — orange → amber horizontal gradient (brand 톤 일관)
  const lineGrad = ctx.createLinearGradient(padL, 0, w - padR, 0);
  lineGrad.addColorStop(0, '#FF7A45');   /* --brand-primary */
  lineGrad.addColorStop(1, '#FFD43B');   /* --data-amber */
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth   = 1.5;
  ctx.lineJoin    = 'round';
  // drop-shadow glow — brand orange 색조
  ctx.shadowColor = 'rgba(255, 122, 69, 0.4)';
  ctx.shadowBlur  = 8;
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();
  ctx.shadowBlur  = 0;
  ctx.shadowColor = 'transparent';

  const last = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#FFD43B';   /* --data-amber: gradient 끝점 색 */
  ctx.fill();

  if (data[data.length - 1] > 0) {
    ctx.fillStyle  = '#FFD43B';   /* --data-amber */
    ctx.font       = 'bold 10px monospace';
    ctx.textAlign  = 'left';
    ctx.fillText(data[data.length - 1], last.x + 5, last.y + 3);
  }
}

export function drawDonut() {
  const canvas = document.getElementById('typeChart');
  if (!canvas) return;
  const dpr  = window.devicePixelRatio || 1;
  const size = 90;
  canvas.width  = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width  = size + 'px';
  canvas.style.height = size + 'px';

  const ctx   = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2, cy = size / 2, r = 36, inner = 22;
  const total = typeData.reduce((s, d) => s + donutItemCount(d), 0) || 1;

  if (!typeData.length) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth   = r - inner;
    ctx.stroke();
    return;
  }

  let startAngle = -Math.PI / 2;
  typeData.forEach((d, idx) => {
    const slice = (donutItemCount(d) / total) * Math.PI * 2;
    const color = donutItemColor(d, idx);
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, startAngle + slice);
    ctx.arc(cx, cy, inner, startAngle + slice, startAngle, true);
    ctx.closePath();
    ctx.shadowColor = color;
    ctx.shadowBlur  = 10;
    ctx.fillStyle   = color;
    ctx.fill();
    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';
    startAngle += slice;
  });

  if (donutMode === 'cache') {
    const cached   = typeData.find(d => d.label === 'Cached')?.tokens || 0;
    const cTotal   = typeData.reduce((s, d) => s + (d.tokens || 0), 0) || 1;
    const hitRate  = Math.round((cached / cTotal) * 100);
    ctx.fillStyle    = '#34D399';
    ctx.font         = 'bold 18px ' + (getComputedStyle(document.documentElement).getPropertyValue('--font-data').trim() || 'monospace');
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(hitRate + '%', cx, cy - 4);
    ctx.fillStyle = COLORS.textDim;
    ctx.font      = '9px ' + (getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif');
    ctx.fillText('hit rate', cx, cy + 10);
  } else {
    ctx.fillStyle    = COLORS.text;
    ctx.font         = `bold ${total >= 1000 ? 12 : 15}px monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(total >= 1000 ? (total / 1000).toFixed(1) + 'k' : total, cx, cy - 3);
    ctx.fillStyle = COLORS.textDim;
    ctx.font      = '8px monospace';
    ctx.fillText('total', cx, cy + 9);
  }
}

export function renderTypeLegend() {
  const total = typeData.reduce((s, d) => s + donutItemCount(d), 0) || 1;
  const el    = document.getElementById('typeLegend');
  const totalEl = document.getElementById('typeTotal');
  if (totalEl) totalEl.textContent = `${total.toLocaleString('ko-KR')}건`;
  if (!el) return;
  if (!typeData.length) {
    el.innerHTML = '<div class="state-empty" style="padding:0;font-size:var(--font-meta)">데이터가 없습니다</div>';
    return;
  }
  el.innerHTML = typeData.map((d, idx) => {
    const color = donutItemColor(d, idx);
    const count = donutItemCount(d);
    const label = donutMode === 'cache' ? d.label : (donutMode === 'model' ? d.model : d.type);
    const key   = label || donutItemKey(d, idx);
    const pct   = Math.round(count / total * 100);
    const safeKey = key.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // 모델 이름은 길 수 있어 ellipsis로 자름
    return `<div class="legend-item">
      <div class="legend-dot" style="background:${color}"></div>
      <span class="legend-name" title="${safeKey.replace(/"/g, '&quot;')}">${safeKey}</span>
      <span class="legend-val">${count.toLocaleString('ko-KR')}</span>
      <span class="legend-pct">${pct}%</span>
    </div>`;
  }).join('');
}
