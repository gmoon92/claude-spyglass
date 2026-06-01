/**
 * features/dashboard/context-chart-data.ts — 누적 토큰 컨텍스트 차트 순수 데이터 (P3-09)
 *
 * 원본: assets/js/context-chart.js (Canvas 턴별 누적 토큰 라인 차트).
 *  - resolveSessionContextWindow / 점·스케일 계산 / hasValid 빈상태 판정 / bloated_sys split /
 *    fmtK·_fmtDelta 포맷을 순수 추출. ctx.* 명령형 그리기는 ContextChart.tsx(canvas, 단위테스트 불가).
 *
 * P3-01 Chart.tsx 재사용 설계 결론(test_strategy "재사용 여부 설계 포함"):
 *  미재용(독립 컴포넌트). 근거 — Chart.tsx 는 타임라인(분 버킷)+도넛 모델이고, context-chart 는
 *  턴 인덱스 누적 라인 + context-window 한도 baseline + 점 hit-test hover + bloated-sys split 으로
 *  데이터 모델/상호작용이 상이하다. 공통 캔버스 헬퍼만 패턴 공유(useRef + null-guard draw + DPR).
 *  → ContextChart.tsx 신설. 순수 데이터는 본 모듈, 그리기 계약은 Chart.tsx 와 동형(useLayoutEffect).
 *
 * @module features/dashboard/context-chart-data
 */
import { formatContextWindowLabel, DEFAULT_CONTEXT_WINDOW } from './context-window';

/** 턴 1건(필요 필드만). prompt.context_tokens/tokens_input/window_max/model. */
export interface ContextTurn {
  turn_index?: number;
  prompt?: {
    model?: string | null;
    context_tokens?: number;
    tokens_input?: number;
    window_max?: number;
    bloated_sys?: BloatedSys | null;
  } | null;
  bloated_sys?: BloatedSys | null;
}

export interface BloatedSys {
  stage?: string | null;
  status?: string | null;
  pct?: number;
  system_tokens?: number;
}

export interface ContextWindowInfo {
  size: number;
  label: string;
  model: string | null;
}

/**
 * 차트 한도값 결정 — 가장 최신 prompt 턴의 window_max(서버 SSoT). 누락 시 200K 폴백.
 * (원본 resolveSessionContextWindow 동치)
 */
export function resolveSessionContextWindow(sortedTurns: ReadonlyArray<ContextTurn>): ContextWindowInfo {
  for (let i = sortedTurns.length - 1; i >= 0; i--) {
    const p = sortedTurns[i]?.prompt;
    if (p && p.model) {
      const size =
        Number.isFinite(p.window_max) && (p.window_max as number) > 0
          ? (p.window_max as number)
          : DEFAULT_CONTEXT_WINDOW;
      return { size, label: formatContextWindowLabel(size), model: p.model };
    }
  }
  return {
    size: DEFAULT_CONTEXT_WINDOW,
    label: formatContextWindowLabel(DEFAULT_CONTEXT_WINDOW),
    model: null,
  };
}

/** 유효 데이터 존재 여부(빈 상태 판정) — prompt 있고 context_tokens|tokens_input>0 인 턴. */
export function hasValidContextData(turns: ReadonlyArray<ContextTurn> | null | undefined): boolean {
  return (turns || []).some(
    (t) => !!t.prompt && ((t.prompt.context_tokens || 0) > 0 || (t.prompt.tokens_input || 0) > 0),
  );
}

/** stage 우선, status 별칭 호환. null/'normal' 외 → anomaly. */
function bloatedStage(bs: BloatedSys | null | undefined): string | null {
  return (bs && (bs.stage ?? bs.status)) ?? null;
}

/** turns 에서 bloated_sys 추출(session/prompt 레벨 호환). 없으면 null. (원본 _extractBloatedSysFromTurns) */
export function extractBloatedSysFromTurns(
  turns: ReadonlyArray<ContextTurn> | null | undefined,
): BloatedSys | null {
  if (!Array.isArray(turns) || turns.length === 0) return null;
  for (const t of turns) {
    const ps = t?.prompt?.bloated_sys;
    if (ps && bloatedStage(ps) && bloatedStage(ps) !== 'normal') return ps;
    if (t?.bloated_sys && bloatedStage(t.bloated_sys) && bloatedStage(t.bloated_sys) !== 'normal') {
      return t.bloated_sys;
    }
  }
  return null;
}

/** 차트 계산 결과(컴포넌트가 캔버스에 그릴 입력). */
export interface ContextChartModel {
  sortedTurns: ContextTurn[];
  values: number[];
  window: ContextWindowInfo;
  maxVal: number;
  latest: number;
  pctOfWindow: number;
}

/**
 * turns → 정렬/값/한도/스케일 상한 계산(순수). 빈상태면 null.
 * (원본 renderContextChart 의 데이터 준비부 — ctx 그리기 전까지)
 */
export function computeContextChartModel(
  turns: ReadonlyArray<ContextTurn> | null | undefined,
): ContextChartModel | null {
  if (!hasValidContextData(turns)) return null;
  const sortedTurns = (turns || [])
    .filter((t) => t.prompt)
    .slice()
    .sort((a, b) => (a.turn_index ?? 0) - (b.turn_index ?? 0));
  const values = sortedTurns.map((t) => t.prompt!.context_tokens || t.prompt!.tokens_input || 0);
  const window = resolveSessionContextWindow(sortedTurns);
  const maxVal = Math.max(window.size, ...values);
  const latest = values[values.length - 1];
  const pctOfWindow = window.size > 0 ? (latest / window.size) * 100 : 0;
  return { sortedTurns, values, window, maxVal, latest, pctOfWindow };
}

/** 점 좌표(CSS px) — hit-test/그리기 동일 좌표계. (원본 scaleX/scaleY) */
export interface ChartPoint {
  cx: number;
  cy: number;
  turnIndex: number;
  value: number;
  delta: number | null;
}

export interface ChartDims {
  width: number;
  height: number;
  pad: { top: number; right: number; bottom: number; left: number };
}

/** values + dims → 점 배열. n===1 은 가운데 정렬(원본 scaleX 분기). */
export function computePoints(
  model: ContextChartModel,
  dims: ChartDims,
): ChartPoint[] {
  const { values, sortedTurns, maxVal } = model;
  const cW = dims.width - dims.pad.left - dims.pad.right;
  const cH = dims.height - dims.pad.top - dims.pad.bottom;
  const n = values.length;
  const scaleY = (v: number) => dims.pad.top + cH - (v / maxVal) * cH;
  const scaleX = (i: number) => dims.pad.left + (n === 1 ? cW / 2 : (i / (n - 1)) * cW);
  return values.map((v, i) => ({
    cx: scaleX(i),
    cy: scaleY(v),
    turnIndex: sortedTurns[i].turn_index ?? i,
    value: v,
    delta: i > 0 ? values[i] - values[i - 1] : null,
  }));
}

/**
 * 마우스 좌표(캔버스 상대 px) → 가장 가까운 점 인덱스. 임계(기본 15px) 초과면 -1.
 * (원본 context-chart.js _onCanvasMouseMove 의 nearest hit-test 동치)
 *
 * @deprecated 점 근처(유클리드 15px)에서만 잡혀 노출 범위가 좁다. 라인 차트 호버는
 *   nearestPointByX(마우스 x 위치의 y 데이터) 가 더 자연스럽다 — 신규 코드는 그쪽을 쓴다.
 */
export function hitTestPoint(
  pts: ReadonlyArray<ChartPoint>,
  mx: number,
  my: number,
  threshold = 15,
): number {
  let nearestIdx = -1;
  let minDist = Infinity;
  pts.forEach((pt, i) => {
    const d = Math.hypot(pt.cx - mx, pt.cy - my);
    if (d < minDist) {
      minDist = d;
      nearestIdx = i;
    }
  });
  return minDist < threshold ? nearestIdx : -1;
}

/**
 * 마우스 x 좌표(캔버스 상대 px) → x축으로 가장 가까운 점 인덱스. y 는 무시(라인 차트 표준 호버).
 * 그래프 영역 어디에 올려도 해당 x 위치의 점(=그 시점의 y 데이터)을 잡아 노출 범위가 넓다.
 * 빈 배열이면 -1.
 */
export function nearestPointByX(pts: ReadonlyArray<ChartPoint>, mx: number): number {
  let nearestIdx = -1;
  let minDist = Infinity;
  pts.forEach((pt, i) => {
    const d = Math.abs(pt.cx - mx);
    if (d < minDist) {
      minDist = d;
      nearestIdx = i;
    }
  });
  return nearestIdx;
}

/**
 * ctx-point-hover 이벤트 detail — 수치 툴팁(use-tooltip)이 읽는 필드 SSoT.
 * (원본 context-chart.js _onCanvasMouseMove 의 dispatch payload 동치)
 */
export interface CtxPointHoverDetail {
  turnIndex: number;
  formattedValue: string;
  formattedDelta: string | null;
  windowLabel: string | null;
  windowModel: string | null;
  usagePercent: string | null;
  clientX: number;
  clientY: number;
}

/**
 * 호버된 점 + context-window + 커서 좌표 → 툴팁 detail.
 * usagePercent = value/window*100(1자리), window<=0 이면 null(NaN 회피). (원본 pctOfWindow 산술)
 */
export function buildCtxPointHoverDetail(
  pt: ChartPoint,
  windowInfo: ContextWindowInfo,
  clientX: number,
  clientY: number,
): CtxPointHoverDetail {
  return {
    turnIndex: pt.turnIndex,
    formattedValue: fmtK(pt.value),
    formattedDelta: pt.delta !== null ? fmtDelta(pt.delta) : null,
    windowLabel: windowInfo.label || null,
    windowModel: windowInfo.model || null,
    usagePercent: windowInfo.size > 0 ? ((pt.value / windowInfo.size) * 100).toFixed(1) : null,
    clientX,
    clientY,
  };
}

/** 'NK'(>=1000) / 정수 문자열(원본 fmtK). */
export function fmtK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/** '+N'/'-N'(>=1000 은 K)(원본 _fmtDelta). */
export function fmtDelta(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  const abs = Math.abs(n);
  return sign + (abs >= 1000 ? `${(abs / 1000).toFixed(1)}K` : String(abs));
}

/**
 * bloated_sys baseline 표시 여부 + system token 위치값.
 * stage warn|critical + pct 유효 + window>0 일 때만. (원본 baseline 분기)
 */
export function bloatedSysBaseline(
  bs: BloatedSys | null | undefined,
  windowSize: number,
): { show: boolean; systemTokens: number } {
  const stage = bloatedStage(bs);
  if (!bs || !(stage === 'warn' || stage === 'critical') || !Number.isFinite(bs.pct) || windowSize <= 0) {
    return { show: false, systemTokens: 0 };
  }
  const pct = bs.pct as number;
  const pctFrac = pct > 1 ? pct / 100 : pct;
  const systemTokens = Number.isFinite(bs.system_tokens) ? (bs.system_tokens as number) : pctFrac * windowSize;
  return { show: true, systemTokens };
}

/**
 * 풋터 bloated-sys split 비율(sys%/user%). stage warn|critical + pct 유효일 때만.
 * (원본 splitText 산술 — i18n 키 치환은 호출처)
 */
export function bloatedSysSplit(bs: BloatedSys | null | undefined): { show: boolean; sys: number; user: number } {
  const stage = bloatedStage(bs);
  if (!bs || !(stage === 'warn' || stage === 'critical') || !Number.isFinite(bs.pct)) {
    return { show: false, sys: 0, user: 0 };
  }
  const pct = bs.pct as number;
  const sys = Math.round(pct > 1 ? pct : pct * 100);
  const user = Math.max(0, 100 - sys);
  return { show: true, sys, user };
}
