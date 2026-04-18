// Canvas 차트 모듈 — 타임라인 + 도넛 (외부 의존 없음)

const COLORS = {
  accent:  '#d97757',
  green:   '#4ade80',
  orange:  '#f59e0b',
  blue:    '#60a5fa',
  red:     '#ef4444',
  border:  '#272727',
  card:    '#161616',
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

let typeData = [];

export function setTypeData(data) { typeData = data; }

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

  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth   = 1.5;
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();

  const last = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.accent;
  ctx.fill();

  if (data[data.length - 1] > 0) {
    ctx.fillStyle  = COLORS.accent;
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
  const total = typeData.reduce((s, d) => s + d.count, 0) || 1;

  if (!typeData.length) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth   = r - inner;
    ctx.stroke();
    return;
  }

  let startAngle = -Math.PI / 2;
  typeData.forEach(d => {
    const slice = (d.count / total) * Math.PI * 2;
    const color = TYPE_COLORS[d.type] || COLORS.textDim;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, startAngle + slice);
    ctx.arc(cx, cy, inner, startAngle + slice, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    startAngle += slice;
  });

  ctx.fillStyle    = '#e8e8e8';
  ctx.font         = `bold ${total >= 1000 ? 12 : 15}px monospace`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(total >= 1000 ? (total / 1000).toFixed(1) + 'k' : total, cx, cy - 3);
  ctx.fillStyle = COLORS.textDim;
  ctx.font      = '8px monospace';
  ctx.fillText('total', cx, cy + 9);
}

export function renderTypeLegend() {
  const total = typeData.reduce((s, d) => s + d.count, 0) || 1;
  const el    = document.getElementById('typeLegend');
  document.getElementById('typeTotal').textContent = `${total.toLocaleString('ko-KR')}건`;
  if (!typeData.length) {
    el.innerHTML = '<div style="color:var(--text-dim);font-size:11px">데이터 없음</div>';
    return;
  }
  el.innerHTML = typeData.map(d => {
    const color = TYPE_COLORS[d.type] || COLORS.textDim;
    const pct   = Math.round(d.count / total * 100);
    return `<div class="legend-item">
      <div class="legend-dot" style="background:${color}"></div>
      <span class="legend-name">${d.type}</span>
      <span class="legend-val">${d.count.toLocaleString('ko-KR')}</span>
      <span class="legend-pct">${pct}%</span>
    </div>`;
  }).join('');
}
