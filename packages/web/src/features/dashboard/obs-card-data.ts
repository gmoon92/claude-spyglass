/**
 * features/dashboard/obs-card-data.ts — Observability 카드 순수 뷰모델 (P3-09)
 *
 * 원본: assets/js/obs-panel.js (ADR-005/008). 1 함수 = 1 위젯, payload→innerHTML.
 *  원본은 빈/정상 분기 + delta 부호 + 카테고리 막대 % 를 함수 내부 SSoT 로 결정한 뒤
 *  innerHTML 문자열을 만들었다(테스트 0 사각지대 — P3-09 가 해소).
 *
 * 본 모듈은 그 "분기/산술"만 순수 함수로 추출한다(데이터/뷰 분리):
 *  - 빈 상태 판정(각 카드의 early-return 조건 SSoT) → isEmpty 플래그.
 *  - delta 부호/방향/클래스/표기(deltaIconHtml 의 분류부).
 *  - cache hit_rate 임계 톤(≥0.7 up / ≥0.3 down / <0.3 warn).
 *  - tool-categories 막대 행(전역/meta-docs 두 모드) % 계산 + 클래스 매핑.
 *  - anomaly badge 노출 여부 + total.
 *
 * 뷰(ObsPanel.tsx)는 이 뷰모델만 받아 JSX 로 렌더 — 무전역·무스토어(arch §1.3 leaf).
 * 원본 모듈 변수 _toolCategoriesMode 는 폐기 → mode 를 인자로 받는다(데이터 역전, P3-01 동형).
 *
 * @module features/dashboard/obs-card-data
 */

// ── W1. Burn Rate ────────────────────────────────────────────────────────────
export interface BurnRatePayload {
  buckets?: Array<{ hour_ts?: number; tokens?: number; requests?: number }> | null;
  current_total?: number;
  yesterday_same_window?: number;
  delta_pct?: number | null;
}

/** burn-rate 빈 상태 판정 SSoT(원본 obs-panel.js:55). */
export function isBurnRateEmpty(p: BurnRatePayload | null | undefined): boolean {
  return (
    !p ||
    !Array.isArray(p.buckets) ||
    p.buckets.length === 0 ||
    p.current_total === 0
  );
}

/** burn-rate 막대 series(buckets→tokens, null→0). */
export function burnRateSeries(p: BurnRatePayload): number[] {
  return (p.buckets ?? []).map((b) => b.tokens || 0);
}

// ── delta 분류(deltaIconHtml 의 순수부) ───────────────────────────────────────
export type DeltaTone = 'up' | 'down' | 'flat';
export interface DeltaView {
  tone: DeltaTone;
  /** 'up'|'down' (flat 이면 null — 아이콘 없이 '—'). */
  dir: 'up' | 'down' | null;
  /** 표기 텍스트(flat 이면 '—'). 원본: `${sign}${pct.toFixed(1)}%`. */
  text: string;
  /** 트렌드 wrapper modifier 클래스('is-up'|'is-down'|''). */
  cls: string;
}

/** delta_pct → 부호/방향/표기. null/NaN/0 → flat('—'). (원본 deltaIconHtml 분류부) */
export function classifyDelta(deltaPct: number | null | undefined): DeltaView {
  if (deltaPct == null || !Number.isFinite(deltaPct) || deltaPct === 0) {
    return { tone: 'flat', dir: null, text: '—', cls: '' };
  }
  const isUp = deltaPct > 0;
  return {
    tone: isUp ? 'up' : 'down',
    dir: isUp ? 'up' : 'down',
    text: `${isUp ? '+' : ''}${deltaPct.toFixed(1)}%`,
    cls: isUp ? 'is-up' : 'is-down',
  };
}

// ── W2. Cache Health ──────────────────────────────────────────────────────────
export interface CacheHealthPayload {
  buckets?: Array<{ hour_ts?: number; hit_rate?: number; savings_tokens?: number }> | null;
  hit_rate_now?: number | null;
  savings_tokens_total?: number;
}

/** cache-health 빈 상태 판정 SSoT(원본 obs-panel.js:85). */
export function isCacheHealthEmpty(p: CacheHealthPayload | null | undefined): boolean {
  return !p || !Array.isArray(p.buckets) || p.hit_rate_now == null;
}

/** hit_rate_now → 트렌드 톤 클래스(원본: ≥0.7 is-up / ≥0.3 is-down / else is-warn). */
export function cacheHealthTrendCls(hitRateNow: number): string {
  if (hitRateNow >= 0.7) return 'is-up';
  if (hitRateNow >= 0.3) return 'is-down';
  return 'is-warn';
}

// ── W3. Live Pulse ────────────────────────────────────────────────────────────
export interface LivePulsePayload {
  active_count?: number;
  last_event_ts?: number | null;
  recent_calls?: number[];
}

/** live-pulse 빈 상태 판정 SSoT(원본 obs-panel.js:119). */
export function isLivePulseEmpty(p: LivePulsePayload | null | undefined): boolean {
  return !p || (p.active_count === 0 && !p.last_event_ts);
}

// ── W4. Tool Categories ───────────────────────────────────────────────────────
export type ToolCategoriesMode = 'default' | 'meta-docs';

export interface ToolCategoryDatum {
  category?: string;
  request_count?: number;
  percentage?: number;
}
export interface MetaDocItem {
  name: string;
  invocations?: number;
}
export interface MetaDocsPayload {
  mode: 'meta-docs';
  items?: MetaDocItem[];
}
export type ToolCategoriesPayload = ToolCategoryDatum[] | MetaDocsPayload | null | undefined;

/** 원본 CATEGORY_CLASS 매핑(Agent/Skill/MCP/Native → cls). */
export const CATEGORY_CLASS: Record<string, string> = {
  Agent: 'agent',
  Skill: 'skill',
  MCP: 'mcp',
  Native: 'native',
};
/** 원본 DS_TONE 매핑(cls → data-tone). */
export const DS_TONE: Record<string, string> = {
  agent: 'warn',
  skill: 'warn',
  mcp: 'info',
  native: 'neutral',
};

/** 전역 카테고리 막대 행. */
export interface CategoryBarRow {
  category: string;
  cls: string;
  dsTone: string;
  pct: number;
  /** percentage 있으면 'NN.N%', 없으면 request_count 문자열. */
  label: string;
  tooltipKey: string;
}
/** meta-docs Top N 막대 행. */
export interface MetaDocRow {
  name: string;
  pct: number;
  invocations: number;
}

export type ToolCategoriesView =
  | { kind: 'empty'; messageKey: string }
  | { kind: 'default'; rows: CategoryBarRow[] }
  | { kind: 'meta-docs'; rows: MetaDocRow[] }
  | { kind: 'suppressed' }; // meta-docs 모드에서 배열 payload 도착 → 덮어쓰기 방지(원본 early return)

/**
 * tool-categories 뷰모델 — 두 모드 단일 분기(원본 renderToolCategoriesCard SSoT).
 * @param mode 현재 카드 모드(원본 _toolCategoriesMode 모듈 변수 대체 — 호출처 소유).
 *   배열 payload + mode==='meta-docs' → 'suppressed'(reset 전까지 유지).
 */
export function computeToolCategories(
  payload: ToolCategoriesPayload,
  mode: ToolCategoriesMode,
): ToolCategoriesView {
  // ── 모드 B: Behavior Definitions Top N ──
  if (payload && !Array.isArray(payload) && payload.mode === 'meta-docs') {
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length === 0) return { kind: 'empty', messageKey: 'ui.obs-panel.no-behavior-defs' };
    const max = Math.max(1, ...items.map((i) => i.invocations || 0));
    const rows: MetaDocRow[] = items.map((i) => ({
      name: i.name,
      pct: Math.round(((i.invocations || 0) / max) * 100),
      invocations: i.invocations ?? 0,
    }));
    return { kind: 'meta-docs', rows };
  }

  // ── 모드 A: 전역 카테고리 막대 ──
  // meta-docs 모드 활성 중 배열 payload → 덮어쓰기 방지(원본 obs-panel.js:208).
  if (mode === 'meta-docs') return { kind: 'suppressed' };

  const categories = Array.isArray(payload) ? payload : [];
  if (categories.length === 0 || categories.every((c) => !c.request_count)) {
    return { kind: 'empty', messageKey: 'ui.obs-panel.no-tool-calls' };
  }
  const max = Math.max(1, ...categories.map((c) => c.request_count || 0));
  const rows: CategoryBarRow[] = categories.map((c) => {
    const cls = CATEGORY_CLASS[c.category ?? ''] || 'native';
    return {
      category: c.category || '—',
      cls,
      dsTone: DS_TONE[cls] ?? 'neutral',
      pct: Math.round(((c.request_count || 0) / max) * 100),
      label: c.percentage != null ? `${c.percentage.toFixed(1)}%` : `${c.request_count}`,
      tooltipKey: `cat-${c.category || ''}`,
    };
  });
  return { kind: 'default', rows };
}

// ── Anomaly Badge ─────────────────────────────────────────────────────────────
export interface AnomalyPayload {
  counts?: Record<string, number>;
  total?: number;
}
export interface AnomalyView {
  visible: boolean;
  total: number;
}
/** anomaly badge 노출 여부 + total(원본 obs-panel.js:244). total=0/null → hidden. */
export function computeAnomalyBadge(p: AnomalyPayload | null | undefined): AnomalyView {
  const total = p?.total ?? 0;
  if (!p || total === 0) return { visible: false, total: 0 };
  return { visible: true, total };
}
