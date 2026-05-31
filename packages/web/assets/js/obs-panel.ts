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
import { svgChevron } from './render/icons.js';

// ─────────────────────────────────────────────────────────────────────────────
// 페이로드 타입 — /api/metrics/* 응답의 data 필드(서버 SSoT). web 표시 전용 형태라
//   @spyglass/types 에 도메인 SSoT 가 없다 → 여기서 소비 필드만 명시(나머지는 무시).
//   모든 필드 optional — early-return 가드가 누락을 처리한다.
// ─────────────────────────────────────────────────────────────────────────────

interface BurnRatePayload {
  buckets?: Array<{ tokens?: number }>;
  current_total?: number;
  yesterday_same_window?: number;
  delta_pct?: number | null;
}
interface CacheHealthPayload {
  buckets?: Array<{ hit_rate?: number }>;
  hit_rate_now?: number | null;
  savings_tokens_total?: number;
}
interface LivePulsePayload {
  active_count?: number;
  last_event_ts?: number | null;
  recent_calls?: number[];
}
interface ToolCategory { category?: string; request_count?: number; percentage?: number }
interface MetaDocsToolPayload { mode: 'meta-docs'; items?: Array<{ name?: string; invocations?: number }> }
type ToolCategoriesPayload = ToolCategory[] | MetaDocsToolPayload | null;
interface AnomalyBadgePayload { total?: number }

const SPARK_W = 76;
const SPARK_H = 24;

function deltaIconHtml(deltaPct: number | null | undefined) {
  if (deltaPct == null || !Number.isFinite(deltaPct) || deltaPct === 0) {
    return `<span class="obs-card-trend">—</span>`;
  }
  const isUp = deltaPct > 0;
  const cls = isUp ? 'is-up' : 'is-down';
  const dir = isUp ? 'up' : 'down';
  const txt = `${isUp ? '+' : ''}${deltaPct.toFixed(1)}%`;
  return `<span class="obs-card-trend ${cls}">
    <span class="obs-card-trend-icon" aria-hidden="true">${svgChevron({ dir, size: 10 })}</span>${txt}
  </span>`;
}

/** 빈 상태 — 카드 라벨이 없으므로 dim 텍스트 한 줄만 노출 (의미는 hover 툴팁) */
function emptyCard(msg: string) {
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
export function renderBurnRate(payload: BurnRatePayload | null) {
  const el = document.getElementById('cardBurnRate');
  if (!el) return;
  if (!payload || !Array.isArray(payload.buckets) || payload.buckets.length === 0 || payload.current_total === 0) {
    el.innerHTML = emptyCard(window.I18n.t('ui.obs-panel.no-data'));
    return;
  }
  const values = payload.buckets.map((b) => b.tokens || 0);
  const total  = payload.current_total || 0;
  const sub    = (payload.yesterday_same_window ?? 0) > 0
    ? window.I18n.t('ui.obs-panel.yesterday', { val: fmtToken(payload.yesterday_same_window) })
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
export function renderCacheHealth(payload: CacheHealthPayload | null) {
  const el = document.getElementById('cardCacheHealth');
  if (!el) return;
  if (!payload || !Array.isArray(payload.buckets) || payload.hit_rate_now == null) {
    el.innerHTML = emptyCard(window.I18n.t('ui.obs-panel.no-cache'));
    return;
  }
  const hitPct = (payload.hit_rate_now * 100).toFixed(1);
  const series = payload.buckets.map((b) => b.hit_rate ?? null);
  const sub    = window.I18n.t('ui.obs-panel.savings', { val: fmtToken(payload.savings_tokens_total || 0) });

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
export function renderLivePulse(payload: LivePulsePayload | null) {
  const el = document.getElementById('cardLivePulse');
  if (!el) return;
  if (!payload || (payload.active_count === 0 && !payload.last_event_ts)) {
    el.innerHTML = emptyCard(window.I18n.t('ui.obs-panel.no-activity'));
    return;
  }
  const lastTxt = payload.last_event_ts
    ? fmtRelative(payload.last_event_ts)
    : '—';
  const series  = Array.isArray(payload.recent_calls) ? payload.recent_calls : [];
  const sparkHtml = sparklineBars(series, { width: SPARK_W, height: SPARK_H });

  el.innerHTML = `
    <span class="obs-card-value">${escHtml(lastTxt)}</span>
    <span class="obs-card-trend ${(payload.active_count ?? 0) > 0 ? 'is-up' : ''}">
      <span class="obs-card-trend-icon">●</span>${fmt(payload.active_count || 0)}
    </span>
    <span class="obs-card-sub">${window.I18n.t('ui.obs-panel.recent-activity')}</span>
    <span class="obs-card-spark">${sparkHtml}</span>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// W4. Tool Categories (4-카테고리 가로 막대) — 카테고리명 자체가 정보
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_CLASS: Record<string, string> = {
  Agent:  'agent',
  Skill:  'skill',
  MCP:    'mcp',
  Native: 'native',
};

/**
 * W4 내부 모드 상태 (SSoT — 호출 측에서 별도 boolean 관리 금지).
 * 'default'  — 전역 카테고리 막대 (배열 payload)
 * 'meta-docs' — 프로젝트 Behavior Definitions Top N
 */
let _toolCategoriesMode = 'default';

/**
 * 프로젝트 해제(전역 복귀) 시 호출 — 모드를 'default'로 리셋.
 * 다음 배열 payload 호출이 early return 없이 정상 렌더링되도록 보장.
 */
export function resetToolCategoriesMode() {
  _toolCategoriesMode = 'default';
}

/**
 * renderToolCategoriesCard — 두 모드를 단일 함수로 처리 (ADR-004 SSoT).
 *
 * 모드 A — 전역 (기본, 프로젝트 미선택):
 *   배열 payload  카테고리 배열
 *
 * 모드 B — Behavior Definitions Top N (프로젝트 선택 시):
 *   { mode: 'meta-docs', items: Array<{name, invocations}> } payload
 *
 * 호출 측(main.js)은 payload만 전달 — 판단은 이 함수 내부 단일 분기.
 *
 * @param {Array<{category?: string, request_count?: number, percentage?: number}>|{mode: string, items: Array<{name: string, invocations: number}>}} payload
 */
export function renderToolCategoriesCard(payload: ToolCategoriesPayload) {
  const el = document.getElementById('cardToolCategories');
  if (!el) return;

  // ── 모드 B: Behavior Definitions Top N ──────────────────────────────────────────────
  if (payload && !Array.isArray(payload) && payload.mode === 'meta-docs') {
    _toolCategoriesMode = 'meta-docs';
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length === 0) {
      el.innerHTML = emptyCard(window.I18n.t('ui.obs-panel.no-behavior-defs'));
      return;
    }
    const max = Math.max(1, ...items.map((i) => i.invocations || 0));
    const rows = items.map((i) => {
      const pct = Math.round((i.invocations || 0) / max * 100);
      // 이중 클래스: 기존 obs-cat-bar-fill obs-cat-bar-fill--agent 보존
      // + ds-bar-fill + data-tone="warn" (agent/skill → warn)
      return `<div class="obs-meta-row">
        <span class="obs-meta-name" title="${escHtml(i.name)}">${escHtml(i.name)}</span>
        <div class="obs-cat-bar"><span class="obs-cat-bar-fill obs-cat-bar-fill--agent ds-bar-fill" data-tone="warn" style="width:${pct}%"></span></div>
        <span class="obs-cat-pct">${escHtml(String(i.invocations ?? 0))}</span>
      </div>`;
    }).join('');
    el.innerHTML = `<div class="obs-card-tools obs-card-meta-docs">${rows}</div>`;
    return;
  }

  // ── 모드 A: 전역 카테고리 막대 (기존 동작) ──────────────────────────────
  // 프로젝트 선택으로 'meta-docs' 모드가 활성화된 상태에서 SSE/fetchObservability의
  // 배열 payload가 들어올 경우 덮어쓰기를 방지한다 (resetToolCategoriesMode 호출 전까지 유지).
  if (_toolCategoriesMode === 'meta-docs') return;

  const categories = Array.isArray(payload) ? payload : [];
  if (categories.length === 0 || categories.every(c => !c.request_count)) {
    el.innerHTML = emptyCard(window.I18n.t('ui.obs-panel.no-tool-calls'));
    return;
  }
  const max = Math.max(1, ...categories.map(c => c.request_count || 0));
  const rows = categories.map(c => {
    const pct = Math.round((c.request_count || 0) / max * 100);
    const cls = (c.category && CATEGORY_CLASS[c.category]) || 'native';
    const label = c.percentage != null ? `${(c.percentage).toFixed(1)}%` : `${c.request_count}`;
    // 카테고리별 행에도 obs-tooltip 부여 → 카테고리 의미 hover 노출
    // 이중 클래스: 기존 obs-cat-bar-fill obs-cat-bar-fill--${cls} 보존
    // + ds-bar-fill + data-tone (agent/skill→warn, mcp→info, native→neutral)
    const DS_TONE: Record<string, string> = { agent: 'warn', skill: 'warn', mcp: 'info', native: 'neutral' };
    const dsTone = DS_TONE[cls] ?? 'neutral';
    return `<div class="obs-cat-row" data-obs-tooltip="cat-${escHtml(c.category || '')}">
      <span class="obs-cat-name">${escHtml(c.category || '—')}</span>
      <div class="obs-cat-bar"><span class="obs-cat-bar-fill obs-cat-bar-fill--${cls} ds-bar-fill" data-tone="${dsTone}" style="width:${pct}%"></span></div>
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
export function renderAnomalyBadge(payload: AnomalyBadgePayload | null) {
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
  // 이중 클래스: 기존 anomaly-badge-dot 보존 + ds-dot + data-tone="pulse" + data-size="sm"
  el.innerHTML = `
    <span class="anomaly-badge-dot ds-dot" data-tone="pulse" data-size="sm" aria-hidden="true"></span>
    <span class="anomaly-badge-count">${fmt(total)}</span>
  `;
}
