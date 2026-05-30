// Canvas 차트 모듈 — 타임라인 + 도넛

import { getLocale } from './i18n-utils.js';
import { modelClassOf } from './render/model.js';

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

// 캐시 도넛 안정 id 화이트리스트 (다국어 라벨과 무관한 lookup 키 SSoT).
// 데이터 생산자(flat-view.js 등)는 슬라이스에 `id` 필드를 부여하며, 이 id 기반으로
// 색상·라벨 키를 결정한다. 과거에는 라벨 문자열(한국어)을 키로 사용했으나
// locale 전환 시 매칭이 깨지므로 안정 id로 단일 책임화한다.
const CACHE_SLICE_IDS = new Set(['cache', 'others', 'total', 'input', 'hit', 'creation', 'hit-rate']);

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
// 모델 도넛 색상 토큰 캐시 — ADR-model-donut-token-alignment-001~004 (2026-05-17).
//
// 이전엔 MODEL_PALETTE 라는 인덱스 기반 임의 팔레트(#FF7A45/#34D399/...) 가
// 모델 뱃지(--model-{cls}-color)와 무관한 색을 분배해, 같은 화면에서 동일 모델이
// 뱃지 ↔ 도넛 슬라이스 색이 완전히 달랐다. (예: claude-opus-4-7 뱃지 violet, 도넛 orange)
//
// 토큰 SSoT (design-tokens.css):
//   --model-haiku-color     #7dd3fc  sky
//   --model-sonnet-color    var(--accent)  orange
//   --model-opus-color      #a78bfa  violet
//   --model-external-color  #f472b6  pink (kimi-*)
//   --model-synthetic-color var(--text-4)  dim
//   --model-unknown-color   var(--text-4)  dim
//
// 분류 SSoT (render/model.js): modelClassOf(model) → 'haiku'|'sonnet'|'opus'|'external'|'synthetic'|'unknown'
//   동일 분류 함수를 모델 뱃지/도넛 양쪽이 공유. 모델 추가 시 한 곳만 수정.
let _modelTokens = null;
function loadModelTokens() {
  const s = getComputedStyle(document.documentElement);
  const get = (name, fallback) => (s.getPropertyValue(name).trim() || fallback);
  _modelTokens = {
    haiku:     get('--model-haiku-color',     '#7dd3fc'),
    sonnet:    get('--model-sonnet-color',    '#d97757'),
    opus:      get('--model-opus-color',      '#a78bfa'),
    external:  get('--model-external-color',  '#f472b6'),
    synthetic: get('--model-synthetic-color', '#6e7681'),
    unknown:   get('--model-unknown-color',   '#6e7681'),
  };
}

// hex → HSL → hex 유틸. 동일 카테고리 i번째 모델의 lightness 단계용.
// 다크 배경 기준 — lightness를 낮추는 방향(어두워지는 방향)으로 단계.
// L 최저 20 clamp: 너무 어두워져 배경(#0a0a0a~#161616)과 동화되는 것 방지.
function hexToHsl(hex) {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return { h: 0, s: 0, l: 50 };
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0, hh = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hh = ((g - b) / d) + (g < b ? 6 : 0); break;
      case g: hh = ((b - r) / d) + 2; break;
      case b: hh = ((r - g) / d) + 4; break;
    }
    hh /= 6;
  }
  return { h: hh * 360, s: s * 100, l: l * 100 };
}

function hslToHex({ h, s, l }) {
  const sN = Math.max(0, Math.min(100, s)) / 100;
  const lN = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  const toHex = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function shiftLightness(hex, deltaL) {
  const hsl = hexToHsl(hex);
  hsl.l = Math.max(20, Math.min(95, hsl.l + deltaL));
  return hslToHex(hsl);
}

// 모델 → 도넛 슬라이스 색 — modelClassOf SSoT + 디자인 토큰 SSoT.
// items: 같은 도넛에 함께 그려지는 전체 데이터(=typeData). 동일 카테고리 다중 모델 시
// i번째(0-base) 인덱스를 찾아 i>0이면 shiftLightness(base, -8 * i)로 darker variant.
// 정렬 순서는 서버 model_usage 응답(보통 request_count DESC)을 그대로 따름 — 더 자주 쓰인
// 모델이 base hue, 적게 쓰인 모델이 더 어두운 variant.
function modelColor(model, idx, items) {
  if (!_modelTokens) loadModelTokens();
  const cls = modelClassOf(model);
  const base = _modelTokens[cls] || _modelTokens.unknown;
  // synthetic/unknown은 본질적으로 dim — variant 적용하지 않음(혼동 방지).
  if (cls === 'synthetic' || cls === 'unknown') return base;
  // 같은 카테고리 내 i번째 산정.
  if (!Array.isArray(items)) return base;
  let sameClsRank = 0;
  for (let i = 0; i < items.length && i < idx; i++) {
    if (modelClassOf(items[i].model) === cls) sameClsRank++;
  }
  if (sameClsRank === 0) return base;
  return shiftLightness(base, -8 * sameClsRank);
}
function donutItemKey(d, _idx) {
  if (donutMode === 'cache') return d.label || '?';
  return donutMode === 'model' ? (d.model || '?') : (d.type || '?');
}
// 캐시 도넛 색상 토큰 캐시 — getComputedStyle은 매번 호출하기엔 비싸므로 1회만 읽어 reuse.
// initTypeColors() 처럼 명시적 init 시점이 없어, 첫 cacheItemColor 호출 시 lazy 로 채운다.
// 토큰 정의: design-tokens.css 의 --cache-{creation|read}-color (ADR-cache-panel-color-system-001~004).
let _cacheTokens = null;
function loadCacheTokens() {
  const s = getComputedStyle(document.documentElement);
  const get = (name, fallback) => (s.getPropertyValue(name).trim() || fallback);
  _cacheTokens = {
    // read = cache hit, 재사용/절감 — emerald (--cache-read-color)
    read:     get('--cache-read-color',     '#10B981'),
    // creation = cache write, 신규 등록 — violet (--cache-creation-color)
    creation: get('--cache-creation-color', '#B794F6'),
    // others/total/input = 캐시 외 토큰 — neutral dim (--text-4)
    others:   get('--text-4',               '#6E7681'),
  };
}

function cacheItemColor(d) {
  // 안정 id 기반 색상 매핑 (locale-independent). 토큰은 CSS 변수 SSoT (ADR-003).
  //   - cache / hit / hit-rate:    --cache-read-color (emerald) — 캐시 적용 토큰 (재사용/절감)
  //   - creation:                  --cache-creation-color (violet) — 신규 캐시 등록 (투자)
  //   - others / total / input:    --text-4 (neutral dim) — 캐시 적용 외 토큰
  //
  // ADR-cache-panel-color-system-003 (2026-05-17): 이전엔 cache=#34D399 하드코딩이라 모델 도넛
  // kimi(#34D399)와 정확히 같은 hex로 의미 충돌 위험이 있었음. CSS 변수 참조로 토큰화하여
  // 색 변경 시 design-tokens.css 만 수정하면 도넛/막대 모두 자동 갱신.
  //
  // 과거 id(total/input/hit/creation/hit-rate)와 라벨 폴백(Cached/Cache Write/Uncached)은 호출자 호환.
  if (!_cacheTokens) loadCacheTokens();
  const idMap = {
    cache:        _cacheTokens.read,
    hit:          _cacheTokens.read,
    'hit-rate':   _cacheTokens.read,
    creation:     _cacheTokens.creation,
    others:       _cacheTokens.others,
    total:        _cacheTokens.others,
    input:        _cacheTokens.others,
  };
  if (d.id && idMap[d.id]) return idMap[d.id];
  // 과거 라벨 폴백 — id 없는 레거시 호출자용.
  const labelMap = {
    'Cached':      _cacheTokens.read,
    'Uncached':    _cacheTokens.others,
    'Cache Write': _cacheTokens.creation,
  };
  return labelMap[d.label] || COLORS.textDim;
}
function donutItemColor(d, idx) {
  if (donutMode === 'cache') return cacheItemColor(d);
  // 모델 도넛: typeData(=활성 데이터셋)를 items로 전달해 동일 카테고리 다중 모델
  // variant(lightness step)를 계산. ADR-model-donut-token-alignment-003.
  return donutMode === 'model' ? modelColor(d.model, idx, typeData) : (TYPE_COLORS[d.type] || COLORS.textDim);
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
  const canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('timelineChart'));
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
      ctx.fillText(String(Math.round(maxVal * t)), padL - 3, y + 3);
    }
  });

  ctx.fillStyle  = COLORS.textDim;
  ctx.font       = '9px monospace';
  ctx.textAlign  = 'center';
  const curMin   = nowMinute();
  [0, Math.floor(n / 2), n - 1].forEach(i => {
    const minsAgo = n - 1 - i;
    const ts      = new Date((curMin - minsAgo) * 60000);
    const label   = ts.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
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
  const canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('typeChart'));
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
    // 도넛 가운데 지표 = '캐시 적용 비율' (cache-coverage pass).
    //   = cache_creation / (cache_read + tokens_input + cache_creation)
    //   "전체 토큰 중 새로 캐시에 등록(creation)된 비율" — 신규 컨텍스트 유입 동학.
    //
    // 슬라이스 합(캐시 + 그 외) = 분모 = 전체 토큰. 분자(creation)는 '캐시' 슬라이스에
    // _cacheCreation 메타로 전달받아 가운데 % 산식과 슬라이스 비율이 정확히 일치.
    // 좌측 cache-panel의 Hit Rate(cache_read/분모)와 다른 각도를 보여 중복 없음.
    const creation = typeData.find(d => d._cacheCreation != null)?._cacheCreation
                  ?? typeData.find(d => d.id === 'creation' || d.label === 'Cache Write')?.tokens
                  ?? 0;
    const denom = typeData.reduce((s, d) => s + (d.tokens || 0), 0) || 1;
    // hit-rate-precision pass: 99 초과 100 미만 구간은 ">99%", 0 초과 1 미만은 "<1%" boundary 라벨.
    const hitRateExact = (creation / denom) * 100;
    const hitRateInt   = Math.round(hitRateExact);
    const hitRateLabel = (hitRateExact > 99 && hitRateExact < 100) ? '>99%'
                       : (hitRateExact > 0  && hitRateExact < 1)    ? '<1%'
                       : `${hitRateInt}%`;
    // ADR-cache-panel-color-system-003 (2026-05-17): 가운데 hit-rate 텍스트 색을
    // --cache-read-color (emerald) 토큰으로 일관화. 이전엔 #34D399 하드코딩이라 모델 도넛
    // kimi(#34D399)와 충돌 위험. 도넛 슬라이스와 동일 토큰을 써서 의미 일관 ("캐시 적용 비율").
    if (!_cacheTokens) loadCacheTokens();
    ctx.fillStyle    = _cacheTokens.read;
    ctx.font         = 'bold 18px ' + (getComputedStyle(document.documentElement).getPropertyValue('--font-data').trim() || 'monospace');
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(hitRateLabel, cx, cy - 4);
    ctx.fillStyle = COLORS.textDim;
    ctx.font      = '9px ' + (getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif');
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
  const t = window.I18n?.t ?? ((k) => k);
  if (totalEl) totalEl.textContent = t('ui.chart.count-unit', { count: total.toLocaleString() });
  if (!el) return;
  if (!typeData.length) {
    el.innerHTML = `<div class="state-empty" style="padding:0;font-size:var(--font-meta)">${t('ui.chart.no-data')}</div>`;
    return;
  }
  el.innerHTML = typeData.map((d, idx) => {
    const color = donutItemColor(d, idx);
    // 범례 카운트·%는 슬라이스와 동일 값(보색 관계). cache 모드도 슬라이스 토큰
    // 그대로 사용 — 도넛 가운데 '캐시 적용 비율'은 별도 산식이며 drawDonut가 직접 그림.
    const count = donutItemCount(d);
    const pct   = Math.round(count / total * 100);
    const rawLabel = donutMode === 'cache' ? d.label : (donutMode === 'model' ? d.model : d.type);
    // 안정 id 우선 — locale 전환 시에도 정확한 ui.chart.label.* 키로 매핑.
    const label = donutMode === 'cache' && d.id && CACHE_SLICE_IDS.has(d.id)
      ? t(`ui.chart.label.${d.id}`)
      : rawLabel;
    const key   = label || donutItemKey(d, idx);
    const safeKey = key.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // 모델 이름은 길 수 있어 ellipsis로 자름
    return `<div class="legend-item">
      <div class="legend-dot ds-dot" data-size="md" style="background:${color}"></div>
      <span class="legend-name" title="${safeKey.replace(/"/g, '&quot;')}">${safeKey}</span>
      <span class="legend-val">${count.toLocaleString(getLocale())}</span>
      <span class="legend-pct">${pct}%</span>
    </div>`;
  }).join('');
}
