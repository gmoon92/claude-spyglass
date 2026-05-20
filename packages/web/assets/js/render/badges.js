// Badge·아이콘 렌더링 — type / tool / status / hint / anomaly / sub-type 표지.
//
// 변경 이유: 배지 라벨·아이콘·아이콘 색·오류 판정 기준 변경 시 묶여서 손이 가는 묶음.
// Wave 2: 이중 클래스 패턴 — 기존 CSS 클래스 유지 + ds-badge/ds-chip + data-tone 추가.
//
// 외부 호출: tool-stats.js (toolIconHtml), turn-views.js (toolIconHtml),
//            turn-rows.js / cells.js (subTypeBadgeHtml).

import { escHtml } from '../formatters.js';
import { subTypeOf } from '../request-types.js';
import { svgToolDot, svgAgentDot } from '../design-system/icons/_index.js';

export function typeBadge(type) {
  const known = ['prompt', 'tool_call', 'system', 'response'];
  const cls   = known.includes(type) ? type : 'unknown';
  const label = known.includes(type) ? type : (type || '?');
  const toneMap = { prompt: 'brand', tool_call: 'success', system: 'warn', response: 'info' };
  const tone = toneMap[type] ?? 'neutral';
  return `<span class="type-badge type-${cls} ds-badge" data-tone="${tone}" title="${escHtml(type)}" aria-label="${escHtml(type)}">${escHtml(label)}</span>`;
}

// eventType: r.event_type 그대로 전달 — 'pre_tool'이면 pulse 애니메이션 자동 적용
export function toolIconHtml(toolName, eventType = null) {
  const isAgent  = toolName && /^(Agent|Skill|Task)/.test(toolName);
  const runCls   = eventType === 'pre_tool' ? ' tool-icon-running' : '';
  return isAgent
    ? `<span class="tool-icon tool-icon-agent${runCls} ds-icon">${svgAgentDot({ size: 12 })}</span>`
    : `<span class="tool-icon tool-icon-tool${runCls} ds-icon">${svgToolDot({ size: 12 })}</span>`;
}

// payload에서 tool_response 추출
function getToolResponse(r) {
  if (!r.payload) return null;
  try {
    const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
    return p?.tool_response ?? null;
  } catch { return null; }
}

// 상태 배지: 오류만 표시 (Signal over Noise 원칙)
export function toolStatusBadge(r) {
  const tr = getToolResponse(r);
  if (!tr) return ''; // tool_response 없으면 미표시 (실행 전/중)
  const tn = r.tool_name || '';
  let hasError = false;
  if (tn === 'Bash') {
    hasError = !!(tr.stderr && tr.stderr.trim());
  } else if (tn === 'Agent' || tn === 'Skill') {
    try {
      const content = Array.isArray(tr.content) ? tr.content : (tr.content ? [tr.content] : []);
      hasError = content.some(c => c?.type === 'tool_result' && c?.is_error);
      if (!hasError && tr.is_error) hasError = true;
    } catch { hasError = !!tr.is_error; }
  } else {
    hasError = !!tr.is_error;
  }
  return hasError ? `<span class="mini-badge badge-error ds-badge" data-tone="error">${window.I18n.t('badges.renderers.tool-status.error')}</span>` : '';
}

// 도구별 결과 힌트: "[202줄]" 등
export function toolResponseHint(r) {
  const tr = getToolResponse(r);
  if (!tr) return ''; // tool_response 없으면 미표시
  const tn = r.tool_name || '';
  try {
    if (tn === 'Read') {
      const lines = tr.totalLines ?? tr.total_lines;
      if (lines != null) return window.I18n.t('badges.renderers.tool-hint.lines', { n: lines });
    }
    if (tn === 'Bash') {
      return (tr.stderr && tr.stderr.trim()) ? window.I18n.t('badges.renderers.tool-hint.error') : '';
    }
    if (tn === 'Edit' || tn === 'Write' || tn === 'MultiEdit') {
      return window.I18n.t('badges.renderers.tool-hint.saved');
    }
    if (tn === 'Grep') {
      const num = tr.numFiles ?? tr.num_files;
      if (num != null) return window.I18n.t('badges.renderers.tool-hint.files', { n: num });
    }
    if (tn === 'Glob') {
      const arr = Array.isArray(tr.filenames ?? tr.results ?? tr.paths ?? tr) ? (tr.filenames ?? tr.results ?? tr.paths) : null;
      if (arr != null) return window.I18n.t('badges.renderers.tool-hint.matches', { n: arr.length });
    }
    if (tn === 'Agent' || tn === 'Skill') {
      return tr.is_error ? window.I18n.t('badges.renderers.tool-hint.failed') : '';
    }
  } catch { /* 파싱 실패는 무시 */ }
  return '';
}

export function anomalyBadgesHtml(flags) {
  if (!flags || flags.size === 0) return '';
  const toneMap = { spike: 'warn', loop: 'info', slow: 'warn' };
  return [...flags].map(f => {
    const tone = toneMap[f] ?? 'neutral';
    return `<span class="mini-badge badge-${f} ds-badge" data-tone="${tone}" data-mini-badge-tooltip="${f}">${f}</span>`;
  }).join('');
}

/* ── BLOATED-SYS / AGENT-SPIKE 표지 헬퍼 SSoT (anomaly-bloated-sys ADR-005) ──
 *
 * 책임:
 *   서버 응답 필드 `bloated_sys` / `agent_spike` 객체를 받아 HTML 문자열을 생성한다.
 *   호출 측은 raw 객체만 전달하고 단계 판정·라벨 포맷·tooltip은 모두 함수 내부 SSoT.
 *
 * 단계 판정 정책 (호출 측에서 boolean 재계산 금지):
 *   - bloated_sys.status === 'warn'      → mini/full/dot 모두 노출 (단 dot은 warn 제외, ADR-005)
 *   - bloated_sys.status === 'critical'  → mini/full/dot 모두 노출, 점멸 자동 적용
 *   - bloated_sys.status === 'normal'    → 빈 문자열
 *
 * 데이터 안전 (트랙 A 진행 중 방어 코드):
 *   - null/undefined / 빈 객체 → 빈 문자열
 *   - status가 'warn'/'critical' 아니면 빈 문자열
 *   - pct 누락 시 '?'로 대체 (시각 깨짐 방지)
 *
 * 호출자:
 *   - mini: render/rows.js (첫 prompt 행 Target 셀)
 *   - full: views/detail-view.js (세션 헤더 detailBadges)
 *   - dot:  left-panel.js (사이드바 세션 리스트)
 */
export function bloatedSysBadgeMiniHtml(bloatedSys) {
  return _bloatedBadge(bloatedSys, 'mini');
}
export function bloatedSysBadgeFullHtml(bloatedSys) {
  return _bloatedBadge(bloatedSys, 'full');
}
export function bloatedSysBadgeDotHtml(bloatedSys) {
  // 사이드바 dot은 critical만 노출 (ADR-005)
  // 서버 컨트랙트는 `stage` (anomaly-bloated-sys ADR-003). 과거 `status` 별칭도 호환.
  const stage = bloatedSys && (bloatedSys.stage ?? bloatedSys.status);
  if (stage !== 'critical') return '';
  return _bloatedBadge(bloatedSys, 'dot');
}

function _bloatedBadge(bs, variant) {
  // 서버 컨트랙트 `stage` 우선 (anomaly-bloated-sys ADR-003), 과거 `status` 별칭도 호환.
  const status = bs && (bs.stage ?? bs.status);
  if (!status || (status !== 'warn' && status !== 'critical')) return '';
  // pct 는 서버에서 0~1 fraction. label은 정수 % 기대 → 100배 환산.
  const pctRaw = (bs.pct != null && Number.isFinite(bs.pct)) ? bs.pct : null;
  const pct    = pctRaw == null ? '?' : Math.round(pctRaw > 1 ? pctRaw : pctRaw * 100);
  const tone   = status === 'critical' ? 'error' : 'warn';
  const stageCls = status === 'critical' ? ' is-critical' : ' is-warn';
  const i18nBase = `ui.anomaly.bloated-sys.${status}`;
  const label   = window.I18n.t(`${i18nBase}.label`,   { pct });
  const tooltip = window.I18n.t(`${i18nBase}.tooltip`, { pct });
  const action  = window.I18n.t(`${i18nBase}.modal`,   { pct });
  // 모달 카피는 fullTooltip의 두 번째 줄로 결합해 사용자가 hover만으로 액션을 알 수 있게.
  const fullTip = `${tooltip} · ${action}`;
  if (variant === 'dot') {
    return `<span class="badge-bloated-sys badge-bloated-sys--dot${stageCls} ds-dot"
      data-tone="${tone}" data-bloated-sys-stage="${status}"
      title="${escHtml(fullTip)}" aria-label="${escHtml(fullTip)}"></span>`;
  }
  const cls = variant === 'full' ? 'badge-bloated-sys--full' : 'badge-bloated-sys--mini';
  return `<span class="badge-bloated-sys ${cls}${stageCls} ds-badge"
    data-tone="${tone}" data-bloated-sys-stage="${status}"
    data-mini-badge-tooltip="bloated-sys"
    title="${escHtml(fullTip)}" aria-label="${escHtml(fullTip)}">${escHtml(label)}</span>`;
}

/* ── CONTEXT-SATURATION 표지 헬퍼 SSoT ────────────────────────────────────
 *
 * 책임:
 *   서버 응답 필드 `anomalies.context_saturation` 객체를 받아 HTML 문자열을 생성.
 *   사용률 % 와 stage(warn/critical)를 노출하는 세션 헤더 뱃지.
 *
 * 단계 판정 정책 (호출 측은 raw 객체만 전달, 재계산 금지):
 *   - stage === 'warn'     → 노란 톤 뱃지 (사용률 % 표시)
 *   - stage === 'critical' → 빨간 톤 뱃지 + critical 클래스
 *   - stage === null/'normal' → 빈 문자열
 *
 * 정책 SSoT는 서버(detectContextSaturation). 클라이언트는 stage·pct만 보고 색·라벨 결정.
 *
 * 호출자:
 *   - full: views/detail-view.js (세션 헤더 detailBadges 영역)
 */
export function contextSaturationBadgeFullHtml(ctxSat) {
  const stage = ctxSat && (ctxSat.stage ?? null);
  if (stage !== 'warn' && stage !== 'critical') return '';
  const pctRaw = (ctxSat.pct != null && Number.isFinite(ctxSat.pct)) ? ctxSat.pct : null;
  const pct    = pctRaw == null ? '?' : Math.round(pctRaw > 1 ? pctRaw : pctRaw * 100);
  const tone   = stage === 'critical' ? 'error' : 'warn';
  const stageCls = stage === 'critical' ? ' is-critical' : ' is-warn';
  const i18nBase = `ui.anomaly.context-saturation.${stage}`;
  // i18n 키가 아직 없을 수 있으므로 fallback 라벨 제공 — translate 누락 시 키 그대로 노출되는 회귀 회피.
  const tFallback = (key, fallback, vars) => {
    try {
      const t = window.I18n?.t?.(key, vars);
      return t && t !== key ? t : fallback;
    } catch { return fallback; }
  };
  const label   = tFallback(`${i18nBase}.label`,   `▦ ctx ${pct}%`, { pct });
  const tooltip = tFallback(`${i18nBase}.tooltip`, `세션 컨텍스트 ${pct}% 사용 — 한도 가까움`, { pct });
  const action  = tFallback(`${i18nBase}.modal`,   `/clear 또는 /compact 권장`, { pct });
  const fullTip = `${tooltip} · ${action}`;
  return `<span class="badge-context-saturation badge-context-saturation--full${stageCls} ds-badge"
    data-tone="${tone}" data-context-saturation-stage="${stage}"
    title="${escHtml(fullTip)}" aria-label="${escHtml(fullTip)}">${escHtml(label)}</span>`;
}

/**
 * Agent/Skill 부모 Target 셀 `↑×N` 표지.
 *  - agent_spike.status === 'critical' AND multiplier(ratio) ≥ 3 → '↑×N'
 *  - multiplier < 3 → 기존 '↑' (회귀 차단 — 기존 badge-spike 유지)
 *  - agent_spike === null/normal → '' (호출 측에서 기존 badge-spike 로직 그대로)
 *
 * 반환: HTML 또는 ''.  '' 반환 시 호출 측이 기본 spike 표지를 그대로 유지하면 됨.
 */
export function agentSpikeBadgeHtml(agentSpike) {
  // 서버 컨트랙트: stage='spike'(트리거) | null. ratio 대신 multiplier 사용.
  // 과거 status='critical'/ratio 별칭도 호환.
  const stage = agentSpike && (agentSpike.stage ?? agentSpike.status);
  if (stage !== 'spike' && stage !== 'critical') return '';
  const ratio = Number(agentSpike.multiplier ?? agentSpike.ratio);
  if (!Number.isFinite(ratio) || ratio < 3) return '';
  const n = Math.round(ratio);
  // 라벨 SSoT는 i18n 키이나, 시각 출력은 `↑` glyph + 수식 자식(.agent-spike-count)으로 분리해
  // CSS에서 count만 강조(tabular-nums + 굵게)할 수 있게 했다 (badges.css 참조).
  // i18n label 자체는 sr-only / 후속 노출 경로에서 사용 가능 — 현재는 tooltip 결합으로 충분.
  const tooltip = window.I18n.t('ui.anomaly.agent-spike.tooltip', { n });
  const action  = window.I18n.t('ui.anomaly.agent-spike.modal',   { n });
  const fullTip = `${tooltip} · ${action}`;
  return `<span class="mini-badge badge-spike ds-badge"
    data-tone="warn" data-spike-variant="agent"
    data-mini-badge-tooltip="agent-spike"
    title="${escHtml(fullTip)}" aria-label="${escHtml(fullTip)}">↑<span class="agent-spike-count">×${n}</span></span>`;
}

/**
 * 턴뷰 헤더 `.turn-spike-summary` + sparkline (SVG 60×16, 최대 20 샘플).
 *  - agent_spike가 null/normal이면 빈 문자열.
 *  - samples (자식 토큰 시계열) 없거나 빈 배열이면 라벨만 노출.
 *  - peak 표시는 sparkline 내부에서 처리 — 본 함수는 .turn-spike-summary 컨테이너만 빌드.
 *
 * @param {object} agentSpike
 * @param {number[]} samples — 최대 20개 자식 토큰 시계열 (옵션)
 */
export function turnSpikeSummaryHtml(agentSpike, samples) {
  // 서버 컨트랙트: stage='spike' / multiplier. 과거 status/ratio 별칭 호환.
  const stage = agentSpike && (agentSpike.stage ?? agentSpike.status);
  if (stage !== 'spike' && stage !== 'critical') return '';
  const ratio = Number(agentSpike.multiplier ?? agentSpike.ratio);
  if (!Number.isFinite(ratio) || ratio < 3) return '';
  const n = Math.round(ratio);
  const label = window.I18n.t('ui.anomaly.agent-spike.summary', { n });
  const sparkSvg = _spikeSparklineSvg(samples);
  return `<span class="turn-spike-summary" title="${escHtml(label)}" aria-label="${escHtml(label)}">
    <span class="turn-spike-summary-label">${escHtml(label)}</span>
    <span class="turn-spike-summary-spark">${sparkSvg}</span>
  </span>`;
}

function _spikeSparklineSvg(samples) {
  const W = 60, H = 16;
  if (!Array.isArray(samples) || samples.length === 0) {
    // 빈 baseline만 — sparkline 모듈 emptySvg 패턴 재사용
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
      `<line x1="0" y1="${H-1}" x2="${W}" y2="${H-1}" stroke="currentColor" stroke-opacity="0.18" stroke-width="1"/></svg>`;
  }
  const vals = samples.slice(-20).map(v => Number.isFinite(v) && v > 0 ? v : 0);
  const n = vals.length;
  const max = Math.max(...vals, 1);
  const stepX = n > 1 ? W / (n - 1) : 0;
  const padY = 1;
  const innerH = H - padY * 2;
  const points = vals.map((v, i) => {
    const x = i * stepX;
    const y = padY + innerH - (v / max) * innerH;
    return [x, y];
  });
  const linePath = 'M ' + points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ');
  const areaPath = `${linePath} L ${W} ${H} L 0 ${H} Z`;
  // peak marker
  let peakIdx = 0;
  for (let i = 1; i < vals.length; i++) if (vals[i] > vals[peakIdx]) peakIdx = i;
  const [px, py] = points[peakIdx];
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
    `<path d="${areaPath}" fill="var(--color-accent-soft)" />` +
    `<path d="${linePath}" stroke="var(--color-accent)" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="2" fill="var(--color-accent)"/>` +
    `</svg>`;
}

/**
 * Sub-type chip HTML SSoT (turn-view-badges ADR-001 + R2).
 *
 * 책임:
 *   tool_call 행 옆에 분류 라벨(MCP / Agent / Skill / Task)을 일관된 시각 어휘로 부착한다.
 *   subTypeOf(r) 결과에 따라 chip HTML 또는 빈 문자열을 반환.
 *
 * 호출자:
 *   - session-detail/turn-rows.js : renderToolRow / renderToolSegmentHtml (단독·그룹 머리)
 *   - render/cells.js             : targetInnerHtml (평면 뷰 cell-target, ADR-006)
 *   - 향후 분류 chip 등장 위치는 모두 이 함수 경유 (HTML 직접 작성 금지)
 *
 * 호버 정책:
 *   네이티브 title 속성으로 도구 전체 식별자 노출 (ADR-004).
 *     MCP   → r.tool_name 전체 (예: 'mcp__redmine__getIssue')
 *     Agent → 'Agent · {tool_detail | tool_input.subagent_type}'
 *     Skill → 'Skill · {tool_detail | tool_input.skill}'
 *     Task  → '{tool_name} · {tool_detail}' (예: 'TaskCreate · subject') — ADR-007 R2
 *   model 칩(model.js)이 채택한 title 패턴과 동일 — 코드베이스 일관성.
 *
 * 빈 sub_type(일반 Bash/Read/Edit 등)이면 ''을 반환해 기존 행 모양을 보존.
 * 이는 "Signal over Noise" 원칙 — 분류가 있는 행만 표지 노출.
 *
 * @param {object} r 행 raw 데이터 (tool_name / tool_detail / tool_input 사용)
 * @returns {string} chip HTML 또는 '' (빈 sub_type)
 */
export function subTypeBadgeHtml(r) {
  const sub = subTypeOf(r);
  if (!sub) return '';
  let label;
  let fullId;
  // ADR-003 left-rail-meta-docs: agent/skill chip은 Behavior Definitions 딥링크 트리거.
  // data-meta-doc-{type,id} 속성을 부여하면 main.js 글로벌 위임에서 enterMetaDocsMode 호출.
  let deepLinkAttrs = '';
  if (sub === 'mcp') {
    label  = 'MCP';
    fullId = r.tool_name || 'mcp__?';
  } else if (sub === 'agent') {
    label  = 'Agent';
    const detail = r.tool_detail || r.tool_input?.subagent_type || '?';
    fullId = `Agent · ${detail}`;
    deepLinkAttrs = ` data-meta-doc-type="agent" data-meta-doc-id="${escHtml(detail)}" role="button" tabindex="0"`;
  } else if (sub === 'skill') {
    label  = 'Skill';
    const detail = r.tool_detail || r.tool_input?.skill || '?';
    fullId = `Skill · ${detail}`;
    deepLinkAttrs = ` data-meta-doc-type="skill" data-meta-doc-id="${escHtml(detail)}" role="button" tabindex="0"`;
  } else if (sub === 'task') {
    // Task family — 라벨은 'Task'로 통일, title에 실제 도구명(TaskCreate/Update/Get/List)과 detail 노출
    label  = 'Task';
    const detail = r.tool_detail || '';
    fullId = detail ? `${r.tool_name} · ${detail}` : (r.tool_name || 'Task');
  } else {
    return '';
  }
  const toneMap = { mcp: 'mcp', agent: 'agent', skill: 'skill', task: 'task' };
  const tone = toneMap[sub] ?? 'neutral';
  return `<span class="sub-type-chip sub-type-chip-${sub} ds-chip" data-tone="${tone}" title="${escHtml(fullId)}" aria-label="${escHtml(fullId)}"${deepLinkAttrs}>${label}</span>`;
}
