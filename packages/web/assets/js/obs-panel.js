/**
 * Observability Panel — 좌측 사이드바 4 카드 위젯 + Anomaly Badge
 *
 * left-panel-observability-revamp ADR-005 / ADR-008(후속):
 *   1 함수 = 1 위젯, 호출 측은 raw payload만 전달.
 *   빈/정상 분기는 함수 내부 SSoT (호출 측 boolean 재계산 금지).
 *   카드 텍스트 라벨은 제거 — KPI 숫자가 first-impression. 의미는 stat-tooltip 패턴이 노출.
 *
 * @see plan.md  / adr.md (.claude/docs/plans/left-panel-observability-revamp/)
 */

import { fmtToken, fmt, fmtRelative, escHtml } from './formatters.js';
import { sparklineBars, sparklineLine } from './sparkline.js';

// ─────────────────────────────────────────────────────────────────────────────
// 공통 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

const SPARK_W = 76;
const SPARK_H = 24;

function deltaIconHtml(deltaPct) {
  if (deltaPct == null || !Number.isFinite(deltaPct) || deltaPct === 0) {
    return `<span class="obs-card-trend">—</span>`;
  }
  const isUp = deltaPct > 0;
  const cls = isUp ? 'is-up' : 'is-down';
  const arrow = isUp ? '▲' : '▼';
  const txt = `${isUp ? '+' : ''}${deltaPct.toFixed(1)}%`;
  return `<span class="obs-card-trend ${cls}">
    <span class="obs-card-trend-icon">${arrow}</span>${txt}
  </span>`;
}

/** 빈 상태 — 카드 라벨이 없으므로 dim 텍스트 한 줄만 노출 (의미는 hover 툴팁) */
function emptyCard(msg) {
  return `<span class="obs-card-empty">${escHtml(msg)}</span>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// W1. Burn Rate (24h 누적 토큰 + 어제 동시각 ±% + 24-bar sparkline)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Object|null} payload  /api/metrics/burn-rate 의 data 필드
 *   - buckets: [{hour_ts, tokens, requests}, ...]
 *   - current_total: number
 *   - yesterday_same_window: number
 *   - delta_pct: number|null
 */
export function renderBurnRate(payload) {
  const el = document.getElementById('cardBurnRate');
  if (!el) return;
  if (!payload || !Array.isArray(payload.buckets) || payload.buckets.length === 0 || payload.current_total === 0) {
    el.innerHTML = emptyCard('데이터 없음');
    return;
  }
  const values = payload.buckets.map(b => b.tokens || 0);
  const total  = payload.current_total || 0;
  const sub    = payload.yesterday_same_window > 0
    ? `어제 ${fmtToken(payload.yesterday_same_window)}`
    : '';
  el.innerHTML = `
    <span class="obs-card-value">${fmtToken(total)}</span>
    ${deltaIconHtml(payload.delta_pct)}
    <span class="obs-card-sub">${escHtml(sub)}</span>
    <span class="obs-card-spark">${sparklineBars(values, { width: SPARK_W, height: SPARK_H })}</span>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// W2. Cache Health (hit ratio % + 절감 토큰 + 24h 추세 line)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Object|null} payload  /api/metrics/cache-trend 의 data 필드
 *   - buckets: [{hour_ts, hit_rate, savings_tokens}, ...]
 *   - hit_rate_now: number|null  (0..1)
 *   - savings_tokens_total: number
 */
export function renderCacheHealth(payload) {
  const el = document.getElementById('cardCacheHealth');
  if (!el) return;
  if (!payload || !Array.isArray(payload.buckets) || payload.hit_rate_now == null) {
    el.innerHTML = emptyCard('캐시 미발생');
    return;
  }
  const hitPct = (payload.hit_rate_now * 100).toFixed(1);
  const series = payload.buckets.map(b => b.hit_rate);
  const sub    = `절감 ${fmtToken(payload.savings_tokens_total || 0)}`;

  // hit_rate 임계 (cache-panel-tooltip와 동일 정책): ≥0.7 success / ≥0.3 mid / <0.3 warn
  let trendCls = 'is-warn';
  if (payload.hit_rate_now >= 0.7) trendCls = 'is-up';
  else if (payload.hit_rate_now >= 0.3) trendCls = 'is-down';

  el.innerHTML = `
    <span class="obs-card-value">${hitPct}%</span>
    <span class="obs-card-trend ${trendCls}"><span class="obs-card-trend-icon">●</span></span>
    <span class="obs-card-sub">${escHtml(sub)}</span>
    <span class="obs-card-spark">${sparklineLine(series, { width: SPARK_W, height: SPARK_H })}</span>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// W3. Live Pulse (활성 세션 수 + 마지막 이벤트 — Phase 1 간소형, ADR-004)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Object|null} payload
 *   - active_count: number
 *   - last_event_ts: number|null  (epoch ms)
 *   - recent_calls?: number[]  (5분창 sparkline 입력, Phase 2)
 */
export function renderLivePulse(payload) {
  const el = document.getElementById('cardLivePulse');
  if (!el) return;
  if (!payload || (payload.active_count === 0 && !payload.last_event_ts)) {
    el.innerHTML = emptyCard('활동 없음');
    return;
  }
  const lastTxt = payload.last_event_ts
    ? fmtRelative(payload.last_event_ts)
    : '—';
  const series  = Array.isArray(payload.recent_calls) ? payload.recent_calls : [];
  const sparkHtml = sparklineBars(series, { width: SPARK_W, height: SPARK_H });

  el.innerHTML = `
    <span class="obs-card-value">${escHtml(lastTxt)}</span>
    <span class="obs-card-trend ${payload.active_count > 0 ? 'is-up' : ''}">
      <span class="obs-card-trend-icon">●</span>${fmt(payload.active_count || 0)}
    </span>
    <span class="obs-card-sub">최근 활동</span>
    <span class="obs-card-spark">${sparkHtml}</span>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// W4. Tool Categories (4-카테고리 가로 막대) — 카테고리명 자체가 정보
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_CLASS = {
  Agent:  'agent',
  Skill:  'skill',
  MCP:    'mcp',
  Native: 'native',
};

/**
 * @param {Array<{category, request_count, percentage}>} categories
 */
export function renderToolCategoriesCard(categories) {
  const el = document.getElementById('cardToolCategories');
  if (!el) return;
  if (!Array.isArray(categories) || categories.length === 0 || categories.every(c => !c.request_count)) {
    el.innerHTML = emptyCard('도구 호출 없음');
    return;
  }
  const max = Math.max(1, ...categories.map(c => c.request_count || 0));
  const rows = categories.map(c => {
    const pct = Math.round((c.request_count || 0) / max * 100);
    const cls = CATEGORY_CLASS[c.category] || 'native';
    const label = c.percentage != null ? `${(c.percentage).toFixed(1)}%` : `${c.request_count}`;
    // 카테고리별 행에도 obs-tooltip 부여 → 카테고리 의미 hover 노출
    return `<div class="obs-cat-row" data-obs-tooltip="cat-${escHtml(c.category || '')}">
      <span class="obs-cat-name">${escHtml(c.category || '—')}</span>
      <div class="obs-cat-bar"><span class="obs-cat-bar-fill obs-cat-bar-fill--${cls}" style="width:${pct}%"></span></div>
      <span class="obs-cat-pct">${escHtml(label)}</span>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="obs-card-tools">${rows}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Anomaly Badge (floating, total=0이면 hidden — ADR-006)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Object|null} payload
 *   - counts: { high_error_rate, repeated_failure, deep_subagent, token_spike }
 *   - total: number
 */
export function renderAnomalyBadge(payload) {
  const el = document.getElementById('anomalyBadge');
  if (!el) return;
  const total = payload?.total ?? 0;
  if (!payload || total === 0) {
    el.hidden = true;
    el.innerHTML = '';
    el.removeAttribute('data-obs-tooltip');
    return;
  }
  el.dataset.obsTooltip = 'anomaly';
  el.hidden = false;
  el.innerHTML = `
    <span class="anomaly-badge-dot" aria-hidden="true"></span>
    <span class="anomaly-badge-count">${fmt(total)}</span>
  `;
}
