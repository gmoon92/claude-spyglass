// Turn Trace Gantt — Canvas 기반 세션 타임라인 차트
const ROW_H     = 22;   // 턴 행 높이
const BAR_H     = 12;   // 바 높이
const LABEL_W   = 36;   // 왼쪽 턴 레이블 영역 너비
const PAD_TOP   = 8;
const PAD_BOT   = 8;
const MIN_BAR_W = 3;    // 0ms 툴도 최소 이 너비로 표시
const DIAMOND_R = 4;    // duration=0 다이아몬드 마커 반경

// CSS 변수와 동기화 (tool-color-tokens ADR-001). initToolColors()로 덮어씀.
export const TOOL_COLORS = {
  Agent:     '#f59e0b',  // --tool-agent (var(--orange))
  Skill:     '#f59e0b',  // --tool-agent
  Task:      '#60a5fa',  // --tool-task  (var(--blue))
  Read:      '#34d399',  // --tool-fs
  Write:     '#34d399',  // --tool-fs
  Edit:      '#34d399',  // --tool-fs
  MultiEdit: '#34d399',  // --tool-fs
  Bash:      '#fb923c',  // --tool-bash
  Grep:      '#fbbf24',  // --tool-search
  Glob:      '#fbbf24',  // --tool-search
  WebSearch: '#f472b6',  // --tool-web
  WebFetch:  '#f472b6',  // --tool-web
  default:   '#94a3b8',  // --tool-default
};

// CSS 변수 → TOOL_COLORS 동기화 (chart.js initTypeColors() 동일 패턴)
export function initToolColors() {
  const s   = getComputedStyle(document.documentElement);
  const get = v => s.getPropertyValue(v).trim();
  const agent  = get('--tool-agent')   || TOOL_COLORS.Agent;
  const task   = get('--tool-task')    || TOOL_COLORS.Task;
  const fs     = get('--tool-fs')      || TOOL_COLORS.Read;
  const bash   = get('--tool-bash')    || TOOL_COLORS.Bash;
  const search = get('--tool-search')  || TOOL_COLORS.Grep;
  const web    = get('--tool-web')     || TOOL_COLORS.WebSearch;
  const def    = get('--tool-default') || TOOL_COLORS.default;
  TOOL_COLORS.Agent     = agent;
  TOOL_COLORS.Skill     = agent;
  TOOL_COLORS.Task      = task;
  TOOL_COLORS.Read      = fs;
  TOOL_COLORS.Write     = fs;
  TOOL_COLORS.Edit      = fs;
  TOOL_COLORS.MultiEdit = fs;
  TOOL_COLORS.Bash      = bash;
  TOOL_COLORS.Grep      = search;
  TOOL_COLORS.Glob      = search;
  TOOL_COLORS.WebSearch = web;
  TOOL_COLORS.WebFetch  = web;
  TOOL_COLORS.default   = def;
}

function toolColor(toolName) {
  if (!toolName) return TOOL_COLORS.default;
  const base = toolName.split('__').pop();
  return TOOL_COLORS[base] || TOOL_COLORS.default;
}

function simplifyName(toolName) {
  if (!toolName) return '?';
  const parts = toolName.split('__');
  const name = parts[parts.length - 1];
  return name.length > 14 ? name.slice(0, 13) + '…' : name;
}

let _canvas   = null;
let _hint     = null;
let _legend   = null;
let _scroll   = null;
let _turns    = [];

// G6: 이상 감지 맵 (turn_id → Set<'spike'|'loop'|'slow'>)
let _turnAnomalyMap = new Map();

// 페이지 네비게이션 상태
let _pageStart = 0;
const _pageSize = 10;

// G1: Hover Tooltip 상태
let _hitMap   = [];   // { x, y, w, h, tc, turn, isDiamond, inferredDur }
let _tooltip  = null; // DOM element

// G2: ResizeObserver 상태
let _ro        = null;
let _resizeRaf = 0;

export function initGantt() {
  _canvas = document.getElementById('turnGanttChart');
  _hint   = document.getElementById('ganttHint');
  _legend = document.getElementById('ganttLegend');
  _scroll = document.getElementById('ganttScroll');

  // CSS 변수 → TOOL_COLORS 동기화 (ADR-001)
  initToolColors();

  // G1: tooltip DOM 1회 생성
  if (!_tooltip) {
    _tooltip = document.createElement('div');
    _tooltip.className = 'stat-tooltip gantt-tooltip';
    _tooltip.style.display = 'none';
    document.body.appendChild(_tooltip);
  }

  // G1: 이벤트 리스너 1회 등록 (ADR-G02)
  if (_canvas) {
    _canvas.addEventListener('mousemove', _onGanttMouseMove);
    _canvas.addEventListener('mouseleave', _onGanttMouseLeave);
    _canvas.addEventListener('click', _onGanttClick);
  }

  // 페이지 네비게이션 버튼 이벤트 등록
  const prevBtn = document.getElementById('ganttPrev');
  const nextBtn = document.getElementById('ganttNext');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      ganttPagePrev();
      renderGantt(_turns);
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      ganttPageNext();
      renderGantt(_turns);
    });
  }

  // G2: ResizeObserver 등록 (ADR-G04)
  if (_scroll && typeof ResizeObserver !== 'undefined') {
    _ro = new ResizeObserver(() => {
      cancelAnimationFrame(_resizeRaf);
      _resizeRaf = requestAnimationFrame(() => {
        if (_canvas && _canvas.style.display !== 'none') {
          renderGantt(_turns);
        }
      });
    });
    _ro.observe(_scroll);
  }
}

// G1: mousemove 핸들러
function _onGanttMouseMove(e) {
  if (!_canvas || !_tooltip) return;

  const rect = _canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  let hit = null;
  for (const item of _hitMap) {
    if (item.isDiamond) {
      // 다이아몬드: 사각 히트 영역 (DIAMOND_R * 2 정도)
      const hr = DIAMOND_R + 2;
      if (mx >= item.x - hr && mx <= item.x + hr && my >= item.y - hr && my <= item.y + hr) {
        hit = item;
        break;
      }
    } else {
      if (mx >= item.x && mx <= item.x + item.w && my >= item.y && my <= item.y + item.h) {
        hit = item;
        break;
      }
    }
  }

  if (!hit) {
    _tooltip.style.display = 'none';
    return;
  }

  _tooltip.innerHTML = _buildTooltipHtml(hit);
  _tooltip.style.display = 'block';
  _positionTooltip(e);
}

// G1: mouseleave 핸들러
function _onGanttMouseLeave() {
  if (_tooltip) _tooltip.style.display = 'none';
}

// G1: tooltip 위치 계산
function _positionTooltip(e) {
  if (!_tooltip) return;
  const tw = _tooltip.offsetWidth  || 220;
  const th = _tooltip.offsetHeight || 80;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x = e.clientX + 12;
  let y = e.clientY + 12;
  if (x + tw > vw) x = e.clientX - tw - 12;
  if (y + th > vh) y = e.clientY - th - 12;
  _tooltip.style.left = `${x}px`;
  _tooltip.style.top  = `${y}px`;
}

// G1: tooltip HTML 빌드
function _buildTooltipHtml(hit) {
  const tc   = hit.tc;
  const turn = hit.turn;
  const name = simplifyName(tc.tool_name) || '?';

  // duration 표시 (G5: duration=0 추정값 포함)
  let durStr;
  if ((tc.duration_ms || 0) === 0 && hit.inferredDur != null) {
    durStr = `0ms <span style="color:var(--text-dim)">(추정: ${fmtDur(hit.inferredDur)})</span>`;
  } else {
    durStr = fmtDur(tc.duration_ms || 0);
  }

  // 시각 (HH:mm:ss)
  const timeStr = tc.timestamp ? _fmtTime(tc.timestamp) : '—';

  // tokens
  const tokIn  = (tc.tokens_input  || 0).toLocaleString();
  const tokOut = (tc.tokens_output || 0).toLocaleString();

  return `
    <div class="stat-tooltip-title">${name}</div>
    <div class="stat-tooltip-desc">
      <div style="display:flex;justify-content:space-between;gap:12px">
        <span style="color:var(--text-muted)">Duration</span>
        <span>${durStr}</span>
      </div>
      <div style="display:flex;justify-content:space-between;gap:12px">
        <span style="color:var(--text-muted)">Tokens</span>
        <span>${tokIn} → ${tokOut}</span>
      </div>
      <div style="display:flex;justify-content:space-between;gap:12px">
        <span style="color:var(--text-muted)">Turn</span>
        <span>T${turn.turn_index}</span>
      </div>
      <div style="display:flex;justify-content:space-between;gap:12px">
        <span style="color:var(--text-muted)">Time</span>
        <span style="font-variant-numeric:tabular-nums">${timeStr}</span>
      </div>
    </div>
  `;
}

// HH:mm:ss 포맷
function _fmtTime(ts) {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function renderGantt(turns, turnAnomalyMap = new Map()) {
  _turnAnomalyMap = turnAnomalyMap;
  if (!_canvas) return;

  // G1: hitMap 매 렌더마다 초기화 (ADR-G02)
  _hitMap = [];

  _turns = (turns || []).slice().sort((a, b) => a.turn_index - b.turn_index);

  // 유효한 tool_call이 있는 턴만 렌더링 대상
  const filteredRows = _turns.filter(t => t.tool_calls.length > 0);
  if (!filteredRows.length) {
    _canvas.style.display = 'none';
    if (_hint) _hint.textContent = '표시할 툴 호출 데이터가 없습니다';
    if (_legend) _legend.innerHTML = '';
    _updateNavUI(0, 0);
    return;
  }
  _canvas.style.display = 'block';

  // 페이지 슬라이싱
  const totalRows = filteredRows.length;
  // _pageStart가 범위를 벗어났을 경우 보정
  if (_pageStart >= totalRows) {
    _pageStart = Math.max(0, Math.floor((totalRows - 1) / _pageSize) * _pageSize);
  }
  const rows = filteredRows.slice(_pageStart, _pageStart + _pageSize);
  const startIdx = _pageStart;
  const endIdx   = Math.min(_pageStart + _pageSize, totalRows);

  // 네비게이션 UI 업데이트
  _updateNavUI(startIdx, totalRows);

  // 턴별 상대 시간 범위 계산 — 가장 긴 턴을 X축 스케일 기준으로 사용
  let maxTurnDur = 1;
  for (const t of rows) {
    const tcs    = t.tool_calls;
    const tStart = Math.min(...tcs.map(tc => tc.timestamp));
    const tEnd   = Math.max(...tcs.map(tc => tc.timestamp + Math.max(tc.duration_ms || 0, 0)));
    const dur    = tEnd - tStart;
    if (dur > maxTurnDur) maxTurnDur = dur;
  }

  // 힌트 업데이트
  const totalTools = rows.reduce((s, t) => s + t.tool_calls.length, 0);
  if (_hint) _hint.textContent = `T${startIdx + 1}–T${endIdx} · ${totalRows}개 턴 중 ${rows.length}개 선택 · ${totalTools}개 툴 호출 · 최대 ${fmtDur(maxTurnDur)} · 턴 기준 상대 시간`;

  // 범례: 등장한 툴 종류 수집
  const usedTools = new Map();
  for (const t of rows) {
    for (const tc of t.tool_calls) {
      const name = simplifyName(tc.tool_name);
      if (!usedTools.has(name)) usedTools.set(name, toolColor(tc.tool_name));
    }
  }
  if (_legend) {
    _legend.innerHTML = [...usedTools.entries()].slice(0, 10).map(([name, color]) =>
      `<span class="gantt-legend-item"><span class="gantt-legend-dot" style="background:${color}"></span>${name}</span>`
    ).join('');
  }

  // Canvas 크기 설정
  const dpr = window.devicePixelRatio || 1;
  const containerW = (_scroll?.clientWidth || _canvas.offsetWidth || 600);
  const W = containerW;
  const H = PAD_TOP + rows.length * ROW_H + PAD_BOT;

  _canvas.width  = W * dpr;
  _canvas.height = H * dpr;
  _canvas.style.height = H + 'px';

  const ctx = _canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const chartW = W - LABEL_W - 8; // 오른쪽 패딩 8px
  const toDW = (dur) => Math.max((dur / maxTurnDur) * chartW, MIN_BAR_W);

  // G8: 동적 시간 눈금 계산
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--ctx-chart-line-grid').trim() || 'rgba(255,255,255,0.04)';
  const textDim = getComputedStyle(document.documentElement).getPropertyValue('--text-dim').trim() || 'rgba(255,255,255,0.35)';
  const ticks = _calcTicks(maxTurnDur);
  ctx.fillStyle = textDim;
  ctx.font = '9px monospace';
  ticks.forEach(t => {
    const x = LABEL_W + (t / maxTurnDur) * chartW;
    // 격자선
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 10); ctx.stroke();
    // 레이블
    ctx.textAlign = x < LABEL_W + 20 ? 'left' : x > LABEL_W + chartW - 20 ? 'right' : 'center';
    ctx.fillText(fmtDur(t), x, H - 2);
  });

  // 각 턴 렌더링
  rows.forEach((turn, rowIdx) => {
    const y = PAD_TOP + rowIdx * ROW_H;
    const barY = y + (ROW_H - BAR_H) / 2;

    // 턴 기준 시작 시각 (상대 X축 계산용)
    const tcs = turn.tool_calls;
    const turnStart = Math.min(...tcs.map(tc => tc.timestamp));
    const toX = (ts) => LABEL_W + ((ts - turnStart) / maxTurnDur) * chartW;

    // G6: 이상 감지 마커 — anomaly 있는 턴은 amber 색상 + ⚠ 표시
    const anomalyFlags = _turnAnomalyMap.get(turn.turn_id) || new Set();
    const hasAnomaly   = anomalyFlags.size > 0;
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    if (hasAnomaly) {
      ctx.fillStyle = TOOL_COLORS.Agent;  // --tool-agent (amber) — anomaly 경고 마커
      ctx.fillText(`T${turn.turn_index}⚠`, LABEL_W - 2, y + ROW_H / 2 + 3);
    } else {
      ctx.fillStyle = textDim;
      ctx.fillText(`T${turn.turn_index}`, LABEL_W - 6, y + ROW_H / 2 + 3);
    }

    // G4: Prompt 구간 오버레이 — 툴 바보다 먼저 그림
    if (turn.prompt && (turn.prompt.duration_ms || 0) > 0) {
      const promptTs  = turn.prompt.timestamp || turnStart;
      const promptX   = toX(promptTs);
      const promptW   = toDW(turn.prompt.duration_ms);
      ctx.fillStyle   = 'rgba(255,255,255,0.07)';
      ctx.fillRect(promptX, y, promptW, ROW_H);
    }

    // G3: 같은 턴 내 tokens_input 최댓값 계산
    const maxTokens = tcs.reduce((max, tc) => Math.max(max, tc.tokens_input || 0), 0);

    // 툴 호출 바
    for (let i = 0; i < tcs.length; i++) {
      const tc = tcs[i];
      const isDiamond = (tc.duration_ms || 0) === 0;

      // G5: duration=0 추정 duration 계산
      let inferredDur = null;
      if (isDiamond) {
        const nextTc = tcs[i + 1];
        if (nextTc) {
          inferredDur = nextTc.timestamp - tc.timestamp;
        }
      }

      const x  = toX(tc.timestamp);
      const color = toolColor(tc.tool_name);

      // G3: 토큰 히트맵 alpha 매핑 (0.35 ~ 1.0)
      let alpha;
      if (maxTokens > 0) {
        alpha = 0.35 + 0.65 * ((tc.tokens_input || 0) / maxTokens);
      } else {
        alpha = 0.35;
      }

      if (isDiamond) {
        // G5: duration=0 → 다이아몬드 마커
        const cx = x;
        const cy = barY + BAR_H / 2;
        ctx.fillStyle = color;
        ctx.globalAlpha = Math.max(alpha, 0.5); // 다이아몬드는 최소 0.5 보장
        _drawDiamond(ctx, cx, cy, DIAMOND_R);
        ctx.fill();
        ctx.globalAlpha = 1;

        // G1: hitMap에 다이아몬드 항목 등록
        _hitMap.push({ x: cx, y: cy, w: 0, h: 0, tc, turn, isDiamond: true, inferredDur });
      } else {
        const dw = toDW(tc.duration_ms || 0);

        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        roundRect(ctx, x, barY, dw, BAR_H, 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        // 바 너비가 20px 이상이면 이름 텍스트 표시
        if (dw >= 20) {
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.font = '8px sans-serif';
          ctx.textAlign = 'left';
          const label = simplifyName(tc.tool_name);
          ctx.fillText(label, x + 3, barY + BAR_H - 3);
        }

        // G1: hitMap에 바 항목 등록
        _hitMap.push({ x, y: barY, w: dw, h: BAR_H, tc, turn, isDiamond: false, inferredDur: null });
      }
    }
  });
}

export function clearGantt() {
  if (!_canvas) return;
  _canvas.style.display = 'none';
  if (_hint)   _hint.textContent = '';
  if (_legend) _legend.innerHTML = '';
  _pageStart = 0;           // ganttPageReset() 대신 직접 리셋 — _updateNavUI 부작용 방지

  // G2: ResizeObserver 정리 (ADR-G04)
  if (_ro) {
    _ro.disconnect();
    _ro = null;
  }
}

// ── 페이지 네비게이션 함수 ─────────────────────────────────────────────────────

export function ganttPageNext() {
  const filteredRows = _turns.filter(t => t.tool_calls.length > 0);
  const totalRows = filteredRows.length;
  if (_pageStart + _pageSize < totalRows) {
    _pageStart += _pageSize;
  }
}

export function ganttPagePrev() {
  _pageStart = Math.max(0, _pageStart - _pageSize);
}

export function ganttPageReset() {
  _pageStart = 0;
  // _updateNavUI(0, 0) 제거 — UI 상태는 renderGantt 가 관리
}

// 내비게이션 버튼 레이블 및 disabled 상태 업데이트
function _updateNavUI(startIdx, totalRows) {
  const navEl    = document.querySelector('.gantt-nav');
  const prevBtn  = document.getElementById('ganttPrev');
  const nextBtn  = document.getElementById('ganttNext');
  const navLabel = document.getElementById('ganttNavLabel');

  // 전체가 한 페이지에 들어오면 nav 숨김
  if (navEl) navEl.style.display = totalRows <= _pageSize ? 'none' : '';

  const endIdx = Math.min(startIdx + _pageSize, totalRows);
  if (navLabel) {
    navLabel.textContent = totalRows > 0 ? `T${startIdx + 1}–T${endIdx}` : '';
  }
  if (prevBtn) prevBtn.disabled = startIdx === 0;
  if (nextBtn) nextBtn.disabled = totalRows === 0 || startIdx + _pageSize >= totalRows;
}

// G5: 다이아몬드(◆) 마커 그리기
function _drawDiamond(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx,     cy - r); // 상
  ctx.lineTo(cx + r, cy);     // 우
  ctx.lineTo(cx,     cy + r); // 하
  ctx.lineTo(cx - r, cy);     // 좌
  ctx.closePath();
}

// G7: Gantt 클릭 핸들러 — 턴뷰 연동
function _onGanttClick(e) {
  if (!_canvas) return;
  const rect = _canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  for (const item of _hitMap) {
    let hit = false;
    if (item.isDiamond) {
      const hr = DIAMOND_R + 2;
      hit = mx >= item.x - hr && mx <= item.x + hr && my >= item.y - hr && my <= item.y + hr;
    } else {
      hit = mx >= item.x && mx <= item.x + item.w && my >= item.y && my <= item.y + item.h;
    }
    if (hit) {
      document.dispatchEvent(new CustomEvent('gantt:turnClick', {
        detail: { turnId: item.turn.turn_id }
      }));
      break;
    }
  }
}

// G8: 동적 눈금 단위 계산 헬퍼
function _calcTicks(totalMs) {
  // 원하는 눈금 개수: 5~8
  const targets = [1, 2, 5, 10, 20, 50, 100, 200, 500,
                   1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000];
  let unit = targets.find(t => totalMs / t <= 8 && totalMs / t >= 3) || totalMs;
  const ticks = [];
  for (let t = 0; t <= totalMs; t += unit) ticks.push(t);
  return ticks;
}

function roundRect(ctx, x, y, w, h, r) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fmtDur(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}
