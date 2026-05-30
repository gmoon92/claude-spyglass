// Accumulated Tokens Chart — Canvas 기반 턴별 누적 토큰 라인 차트
import { DETAIL_FILTER_CHANGED } from './events.js';
import { formatContextWindowLabel, DEFAULT_CONTEXT_WINDOW } from './context-window.js';
import { asEl } from './dom.js';

/**
 * 차트 스케일·풋터·툴팁에 쓰일 한도값을 턴 배열에서 결정.
 *
 * 정책:
 *  - 서버 SSoT 단일화: turns 응답의 `prompt.window_max`(서버가 model_limits 시드 +
 *    proxy_requests 관측 최대를 결합해 채워준 값)를 그대로 사용. 클라이언트는 자체 추론 없음.
 *  - 세션 중 같은 모델이라도 관측 갱신으로 window_max가 미세 변동할 수 있으므로
 *    가장 최신 prompt 턴의 값을 채택 (대다수 케이스에서 동일).
 *  - 서버가 window_max를 누락한 비정상 경우만 DEFAULT_CONTEXT_WINDOW(200K)로 폴백.
 *
 * 반환값: { size, label, model } — UI 라벨링 일관성을 위해 함께 묶어 반환.
 */
function resolveSessionContextWindow(sortedTurns) {
  for (let i = sortedTurns.length - 1; i >= 0; i--) {
    const p = sortedTurns[i]?.prompt;
    if (p && p.model) {
      const size = Number.isFinite(p.window_max) && p.window_max > 0 ? p.window_max : DEFAULT_CONTEXT_WINDOW;
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
 * anomaly-bloated-sys T-17: 세션 헤더 bloated-sys 라벨 hover 시 baseline 강조.
 *  - 기본 baseline opacity .55 → hover 시 1.0
 *  - stroke-width 1px → 1.5px
 *  - 200ms 부드러운 트랜지션은 Canvas에서 단계적 재렌더로 표현 (간단 토글).
 */
let _baselineGlow = false;
/** session 헤더에서 dispatch한 bloated_sys 정보를 차트가 들고 풋터 split을 표현. */
let _bloatedSysCache = null;
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

  // DETAIL_FILTER_CHANGED 구독 — 컨텍스트 차트 갱신.
  // turns 응답에 bloated_sys 정보가 같이 오면 풋터 split 표시에 사용.
  //   단건 fetch(session-anomalies-loaded)가 먼저 도착해 _bloatedSysCache를 채워두면
  //   여기서 null로 덮어쓰지 않는다 — turns 응답엔 anomaly 메타가 빠진 케이스가 SSoT.
  document.addEventListener(DETAIL_FILTER_CHANGED, (e) => {
    const { allTurns, bloatedSys } = e.detail || {};
    const fromTurns = bloatedSys || _extractBloatedSysFromTurns(allTurns);
    if (fromTurns) _bloatedSysCache = fromTurns;
    // 캐시 유지 — 단건 fetch가 이미 채워뒀거나 turns 응답에 있으면 그대로 사용.
    renderContextChart(allTurns);
  });

  // anomaly-bloated-sys T-17: detail-view.js 단건 fetch 응답을 받아 baseline/풋터 split 동기.
  //   사이드바 dot · 헤더 full 뱃지와 동일 SSoT — 클라이언트 보조 fetch 1회로 4종 표지 모두 갱신.
  document.addEventListener('session-anomalies-loaded', (e) => {
    const bs = e.detail?.bloatedSys || null;
    _bloatedSysCache = bs;
    if (_lastTurns) renderContextChart(_lastTurns);
  });

  // anomaly-bloated-sys T-17: 세션 헤더 hover → baseline 강조 동기화.
  //   detail-view.js의 applyBloatedSysHeader에서 dispatch.
  document.addEventListener('ctx-baseline-glow', (e) => {
    const active = !!(e.detail && e.detail.active);
    if (_baselineGlow === active) return;
    _baselineGlow = active;
    renderContextChart(_lastTurns);
  });

  // anomaly-bloated-sys T-17: 풋터 클릭 → 첫 prompt 행으로 scrollIntoView + .row-flash 1.5s.
  if (_footer) {
    _footer.addEventListener('click', () => {
      // 'prompt' 타입의 첫 행을 우선 찾고, 없으면 turn-card-summary 첫 카드.
      const target = document.querySelector('tr[data-type="prompt"]')
        || document.querySelector('.turn-row-prompt')
        || document.querySelector('.turn-card');
      if (!target) return;
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.add('row-flash');
      setTimeout(() => target.classList.remove('row-flash'), 1500);
    });
    // 시각 어포던스 — 풋터에 hover 시 cursor: pointer
    asEl(_footer).style.cursor = 'pointer';
    _footer.setAttribute('role', 'button');
    _footer.setAttribute('tabindex', '0');
  }
}

/**
 * 응답 구조에 따라 turns 배열에서 bloated_sys 정보를 추출.
 *  - 일부 응답은 session 레벨, 일부는 첫 prompt 레벨에 부착될 수 있음.
 *  - 어느 쪽도 없으면 null 반환 — 풋터 split 미노출 자연 폴백.
 */
function _extractBloatedSysFromTurns(turns) {
  if (!Array.isArray(turns) || turns.length === 0) return null;
  // 서버 컨트랙트 `stage` 우선, 과거 `status` 별칭 호환. null/'normal' 외에는 anomaly로 간주.
  const _st = (x) => x && (x.stage ?? x.status);
  for (const t of turns) {
    if (t?.prompt?.bloated_sys && _st(t.prompt.bloated_sys) && _st(t.prompt.bloated_sys) !== 'normal') return t.prompt.bloated_sys;
    if (t?.bloated_sys && _st(t.bloated_sys) && _st(t.bloated_sys) !== 'normal') return t.bloated_sys;
  }
  return null;
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

  // 푸터 힌트 — "참고 스케일" 대신 추론된 모델 한도를 명시.
  // anomaly-bloated-sys T-17: bloated_sys.pct가 있으면 split 카피를 우측에 덧붙인다.
  //   `system {sys}% / user {user}%` — 사용자가 system 점유율을 한눈에 인지.
  //   클릭 → 첫 prompt 행으로 scrollIntoView (init에서 위임).
  if (_footer) {
    const last = sorted[sorted.length - 1];
    const modelSuffix = cw.model ? ` (${cw.model})` : '';
    const baseText = window.I18n.t('ui.context-chart.footer', { turn: last.turn_index, max: fmtK(Math.max(...values)), limit: cw.label, model: modelSuffix });
    const bs = _bloatedSysCache;
    // 서버 컨트랙트 `stage` 우선 (anomaly-bloated-sys ADR-003), 과거 `status` 별칭 호환.
    const bsStage = bs && (bs.stage ?? bs.status);
    let splitText = '';
    if (bs && (bsStage === 'warn' || bsStage === 'critical') && Number.isFinite(bs.pct)) {
      // pct는 0~1 fraction(서버 SSoT) 또는 0~100 정수(과거 별칭). 둘 다 정수 %로 환산.
      const sys  = Math.round(bs.pct > 1 ? bs.pct : bs.pct * 100);
      const user = Math.max(0, 100 - sys);
      splitText = ' · ' + window.I18n.t('ui.chart.footer.split', { sys, user });
    }
    _footer.textContent = baseText + splitText;
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

  // anomaly-bloated-sys T-17: 점선 baseline — bloated_sys.pct 비율 위치에 표시.
  //   stroke: var(--text-muted); stroke-dasharray: 4 3; stroke-width: 1px; opacity: .55
  //   세션 헤더 bloated-sys 라벨 hover → opacity .55→1, stroke-width 1→1.5px (200ms 트랜지션).
  //   Canvas는 시간 기반 트랜지션이 어렵지만 _baselineGlow 토글로 즉시 강조 표시 가능.
  const bs = _bloatedSysCache;
  // 서버 컨트랙트 `stage` 우선 — context-chart-footer-split과 동일 정규화.
  const bsStage = bs && (bs.stage ?? bs.status);
  if (bs && (bsStage === 'warn' || bsStage === 'critical') && Number.isFinite(bs.pct) && cw.size > 0) {
    // bloated_sys.system_tokens (실측 값) 우선. 없으면 pct로 환산하되 pct는 0~1 fraction(SSoT)이므로 그대로 곱한다.
    // 과거 별칭(0~100 정수) 호환: pct > 1이면 /100로 환산.
    const pctFrac = bs.pct > 1 ? bs.pct / 100 : bs.pct;
    const sysTokens = Number.isFinite(bs.system_tokens) ? bs.system_tokens : pctFrac * cw.size;
    const yBase = scaleY(sysTokens);
    ctx.save();
    const muted = getCssVar('--text-muted') || '#8B949E';
    ctx.strokeStyle = muted;
    ctx.globalAlpha = _baselineGlow ? 1.0 : 0.55;
    ctx.lineWidth   = _baselineGlow ? 1.5 : 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, yBase);
    ctx.lineTo(PAD.left + cW, yBase);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
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
