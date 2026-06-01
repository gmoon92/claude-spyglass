/**
 * components/chart-data.ts — 차트 순수 데이터 변환 (P3-01)
 *
 * 원본: assets/js/chart.js. 본 모듈은 chart.js 의 "순수 데이터 변환"만 추출한다.
 *   (색 결정·카운트·HSL·도넛 슬라이스 spec·캐시 hit-rate·타임라인 버킷 산술)
 *
 * 원본 대비 변경(신규 계약):
 *  - 색 토큰을 getComputedStyle(document)에서 읽던 lazy 캐시(_modelTokens/_cacheTokens) 제거 →
 *    토큰을 인자(ColorContext)로 주입받는 순수 함수로 전환. 컴포넌트 무전역(arch §1.3 components leaf).
 *  - donutMode/typeData 모듈 변수 제거 → mode 와 data 를 인자로 받는다(setSourceData 외부주입 폐기).
 *  - Date.now 전역 의존(advanceBuckets/recordRequest)을 now 인자 주입 순수 함수로 분리 →
 *    결정론 테스트 가능(렌더 컴포넌트가 Date.now 로 now 를 계산해 주입).
 *
 * 분류 SSoT(render/model.js modelClassOf)는 churn 내성을 위해 본 모듈에 1:1 재현하지 않고
 *   동일 규칙을 로컬 modelClassOf 로 둔다(원본 chart.js 가 render/model.js 를 import 했으나,
 *   src 트리에는 아직 model 분류 유틸이 미이식이라 동일 규칙을 복제 — P3 후속에서 SSoT 통합).
 *
 * @module components/chart-data
 */

// 모드 타입/매핑 SSoT 는 lib/chart-mode(universal leaf) — store/component 공유.
// 본 모듈은 데이터 변환 소비처 호환을 위해 re-export.
import { chartModeToDonutMode as _chartModeToDonutMode, type DonutMode, type ChartMode } from '../lib/chart-mode';
export type { DonutMode, ChartMode } from '../lib/chart-mode';

/** 도넛 슬라이스 1건 — 모드별 서로 다른 필드를 느슨하게 흡수(원본 data 형태). */
export interface DonutDatum {
  type?: string;
  model?: string | null;
  label?: string;
  id?: string;
  count?: number;
  request_count?: number;
  tokens?: number;
  _cacheCreation?: number;
}

/** 종류별 캐시 데이터(setSourceData(kind, data) → props 주입). */
export interface DataByKind {
  type: DonutDatum[];
  model: DonutDatum[];
  cache: DonutDatum[];
}

/** 모델 분류별 색 토큰(design-tokens.css --model-*-color SSoT). */
export interface ModelTokens {
  haiku: string;
  sonnet: string;
  opus: string;
  external: string;
  synthetic: string;
  unknown: string;
}

/** 캐시 색 토큰(design-tokens.css --cache-*-color / --text-4 SSoT). */
export interface CacheTokens {
  read: string;
  creation: string;
  others: string;
}

/** 타입 색 토큰(design-tokens.css --type-*-color SSoT). */
export interface TypeColors {
  prompt: string;
  tool_call: string;
  system: string;
}

/** 색 결정에 필요한 토큰 + 동일 도넛의 전체 items(model variant rank 산정용). */
export interface ColorContext {
  modelTokens: ModelTokens;
  cacheTokens: CacheTokens;
  typeColors: TypeColors;
  /** 같은 도넛에 함께 그려지는 전체 데이터(model 모드 동일 카테고리 다중 모델 variant). */
  items: DonutDatum[];
}

/** 도넛 슬라이스 spec(drawDonut 호출 계약 — ctx.arc 인자 산출 전 단계). */
export interface DonutSlice {
  datum: DonutDatum;
  startAngle: number;
  endAngle: number;
  color: string;
}

/** 타임라인 점(computeTimelinePoints — ctx.lineTo 인자). */
export interface TimelinePoint {
  x: number;
  y: number;
}

/** 타임라인 그리기 영역 치수. */
export interface TimelineDims {
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  width: number;
  height: number;
}

const DIM = '#888888'; // COLORS.textDim 폴백

// ── 모델 분류(render/model.js modelClassOf 규칙 1:1) ────────────────────────────
type ModelClass = keyof ModelTokens;
function modelClassOf(model?: string | null): ModelClass {
  if (!model) return 'unknown';
  const m = String(model).toLowerCase();
  if (m === 'synthetic' || m === '<synthetic>') return 'synthetic';
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('opus')) return 'opus';
  if (m.startsWith('kimi-') || m.startsWith('kimi')) return 'external';
  return 'unknown';
}

// ── chart-policy.js setChartMode 의 모드 매핑 — lib/chart-mode SSoT re-export ────
/** default 진입 → model 분포, detail 진입 → cache 퍼포먼스(chart-policy.js:43,49). */
export const chartModeToDonutMode = _chartModeToDonutMode;

// ── 카운트/키 (chart.js donutItemCount/donutItemKey) ────────────────────────────
export function donutItemCount(d: DonutDatum, mode: DonutMode): number {
  if (mode === 'cache') return d.tokens || 0;
  return mode === 'model' ? d.request_count || 0 : d.count || 0;
}

export function donutItemKey(d: DonutDatum, mode: DonutMode): string {
  if (mode === 'cache') return d.label || '?';
  return mode === 'model' ? d.model || '?' : d.type || '?';
}

export function donutTotal(data: DonutDatum[], mode: DonutMode): number {
  return data.reduce((s, d) => s + donutItemCount(d, mode), 0);
}

// ── HSL 유틸 (chart.js hexToHsl/hslToHex/shiftLightness) ────────────────────────
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return { h: 0, s: 0, l: 50 };
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0;
  let hh = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hh = (g - b) / d + (g < b ? 6 : 0); break;
      case g: hh = (b - r) / d + 2; break;
      case b: hh = (r - g) / d + 4; break;
    }
    hh /= 6;
  }
  return { h: hh * 360, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: { h: number; s: number; l: number }): string {
  const sN = Math.max(0, Math.min(100, s)) / 100;
  const lN = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function shiftLightness(hex: string, deltaL: number): string {
  const hsl = hexToHsl(hex);
  hsl.l = Math.max(20, Math.min(95, hsl.l + deltaL));
  return hslToHex(hsl);
}

// ── 색 결정 (chart.js modelColor/cacheItemColor/donutItemColor) ─────────────────
/**
 * 모델 → 도넛 슬라이스 색. 같은 카테고리 i번째(i>0)는 shiftLightness(-8*rank) darker variant.
 * synthetic/unknown 은 본질 dim — variant 미적용(원본 1:1).
 */
export function modelColor(model: string | null | undefined, idx: number, items: DonutDatum[], tokens: ModelTokens): string {
  const cls = modelClassOf(model);
  const base = tokens[cls] || tokens.unknown;
  if (cls === 'synthetic' || cls === 'unknown') return base;
  if (!Array.isArray(items)) return base;
  let sameClsRank = 0;
  for (let i = 0; i < items.length && i < idx; i++) {
    if (modelClassOf(items[i].model) === cls) sameClsRank++;
  }
  if (sameClsRank === 0) return base;
  return shiftLightness(base, -8 * sameClsRank);
}

/** 캐시 슬라이스 색 — 안정 id 우선, 라벨 폴백(chart.js cacheItemColor). */
export function cacheItemColor(d: DonutDatum, tokens: CacheTokens): string {
  const idMap: Record<string, string> = {
    cache: tokens.read,
    hit: tokens.read,
    'hit-rate': tokens.read,
    creation: tokens.creation,
    others: tokens.others,
    total: tokens.others,
    input: tokens.others,
  };
  if (d.id && idMap[d.id]) return idMap[d.id];
  const labelMap: Record<string, string> = {
    Cached: tokens.read,
    Uncached: tokens.others,
    'Cache Write': tokens.creation,
  };
  return (d.label && labelMap[d.label]) || DIM;
}

/** 타입 슬라이스 색 — TYPE_COLORS lookup, 미지정 dim 폴백. */
export function typeColor(d: DonutDatum, typeColors: TypeColors): string {
  const map = typeColors as unknown as Record<string, string>;
  return (d.type && map[d.type]) || DIM;
}

/** 모드 디스패치 색 결정(chart.js donutItemColor). */
export function donutItemColor(d: DonutDatum, idx: number, mode: DonutMode, color: ColorContext): string {
  if (mode === 'cache') return cacheItemColor(d, color.cacheTokens);
  if (mode === 'model') return modelColor(d.model, idx, color.items, color.modelTokens);
  return typeColor(d, color.typeColors);
}

// ── 도넛 슬라이스 spec (drawDonut 호출 계약) ────────────────────────────────────
/**
 * 도넛 슬라이스 spec 산출. 시작각 -π/2(12시), 각 슬라이스 = (count/total)*2π.
 * 빈 데이터는 빈 배열(호출자가 empty ring 을 별도 처리 — chart.js drawDonut early branch).
 */
export function computeDonutSlices(data: DonutDatum[], mode: DonutMode, color: ColorContext): DonutSlice[] {
  if (!data.length) return [];
  const total = donutTotal(data, mode) || 1;
  const slices: DonutSlice[] = [];
  let startAngle = -Math.PI / 2;
  data.forEach((d, idx) => {
    const slice = (donutItemCount(d, mode) / total) * Math.PI * 2;
    slices.push({ datum: d, startAngle, endAngle: startAngle + slice, color: donutItemColor(d, idx, mode, color) });
    startAngle += slice;
  });
  return slices;
}

// ── 범례 (chart.js renderTypeLegend) ────────────────────────────────────────────
/** cache 모드에서 안정 id → ui.chart.label.<id> 로 매핑하는 슬라이스 id 집합(chart.js CACHE_SLICE_IDS 1:1). */
export const CACHE_SLICE_IDS: ReadonlySet<string> = new Set([
  'cache', 'others', 'total', 'input', 'hit', 'creation', 'hit-rate',
]);

/** 범례 1행 뷰모델(chart.js renderTypeLegend 의 legend-item 1:1). */
export interface DonutLegendRow {
  /** legend-dot 배경색. */
  color: string;
  /** legend-name 표시 텍스트(이미 i18n 해석됨 — 호출처 labeler 적용). */
  name: string;
  /** legend-name title 속성(전체 텍스트, ellipsis 보완). */
  title: string;
  /** legend-val — 카운트(count.toLocaleString). */
  count: number;
  /** legend-pct — round(count/total*100). */
  pct: number;
}

/** 범례 전체 뷰모델 — rows + 하단 total(donut-total #typeTotal). */
export interface DonutLegendModel {
  rows: DonutLegendRow[];
  /** 하단 #typeTotal 카운트(donutTotal). 0 이면 비어있음(no-data). */
  total: number;
  /** 데이터 유무(빈 배열이면 false → 호출처 no-data 표시). */
  hasData: boolean;
}

/**
 * 도넛 데이터 → 범례 뷰모델(chart.js renderTypeLegend 순수화).
 *  - count = donutItemCount, pct = round(count/total*100)(보색 관계 — 슬라이스와 동일 값).
 *  - 라벨: cache + 안정 id ∈ CACHE_SLICE_IDS 면 labelForCacheId(id)(ui.chart.label.<id>),
 *    그 외엔 raw(cache=label / model=model / type=type). raw 누락 시 donutItemKey 폴백.
 *  - 색은 donutItemColor(슬라이스와 동일 토큰).
 *
 * i18n 해석은 호출처(컴포넌트)가 labelForCacheId 로 주입 — 본 모듈은 무전역(leaf) 유지.
 */
export function buildDonutLegend(
  data: DonutDatum[],
  mode: DonutMode,
  color: ColorContext,
  labelForCacheId: (id: string) => string,
): DonutLegendModel {
  const total = donutTotal(data, mode);
  if (!data.length) return { rows: [], total: 0, hasData: false };
  const denom = total || 1;
  const rows = data.map((d, idx) => {
    const count = donutItemCount(d, mode);
    const pct = Math.round((count / denom) * 100);
    const raw = mode === 'cache' ? d.label : mode === 'model' ? d.model : d.type;
    const resolved =
      mode === 'cache' && d.id && CACHE_SLICE_IDS.has(d.id) ? labelForCacheId(d.id) : raw;
    const name = resolved || donutItemKey(d, mode);
    return { color: donutItemColor(d, idx, mode, color), name, title: name, count, pct };
  });
  return { rows, total, hasData: true };
}

// ── 캐시 hit-rate (drawDonut cache 중앙 지표) ───────────────────────────────────
/** creation 추출 우선순위: _cacheCreation 메타 → id=creation tokens → label='Cache Write' tokens → 0. */
export function cacheCreationOf(data: DonutDatum[]): number {
  const meta = data.find((d) => d._cacheCreation != null)?._cacheCreation;
  if (meta != null) return meta;
  const byId = data.find((d) => d.id === 'creation' || d.label === 'Cache Write')?.tokens;
  return byId ?? 0;
}

/** 캐시 적용 비율 라벨 — 99<x<100 → ">99%", 0<x<1 → "<1%", 그 외 반올림 정수%. */
export function cacheHitRateLabel(creation: number, denom: number): string {
  const d = denom || 1;
  const exact = (creation / d) * 100;
  const int = Math.round(exact);
  if (exact > 99 && exact < 100) return '>99%';
  if (exact > 0 && exact < 1) return '<1%';
  return `${int}%`;
}

/** total 중앙 표기 — 1000 이상은 k 단위 소수1, 그 미만은 정수 문자열(drawDonut). */
export function formatDonutCenter(total: number): string {
  return total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total);
}

// ── 타임라인 버킷 (chart.js advanceBuckets/recordRequest 순수화) ────────────────
export const TIMELINE_BUCKETS = 30;

/** now 분 — Date.now 인자 주입(컴포넌트가 계산해 넘김). chart.js nowMinute(). */
export function nowMinute(nowMs: number): number {
  return Math.floor(nowMs / 60000);
}

/**
 * 버킷 시프트 순수 계산(chart.js advanceBuckets). last=-1 은 시프트 없이 초기화.
 * diff<=0 무변경, diff>BUCKETS 는 전체 클리어.
 */
export function advanceBucketsState(buckets: number[], lastBucketMinute: number, curMinute: number): { buckets: number[]; lastBucketMinute: number } {
  if (lastBucketMinute === -1) return { buckets: [...buckets], lastBucketMinute: curMinute };
  const diff = curMinute - lastBucketMinute;
  if (diff <= 0) return { buckets: [...buckets], lastBucketMinute };
  const shift = Math.min(diff, TIMELINE_BUCKETS);
  return {
    buckets: [...buckets.slice(shift), ...Array(shift).fill(0)],
    lastBucketMinute: curMinute,
  };
}

/** 요청 1건 기록(chart.js recordRequest) — advance 후 마지막 버킷 +1. */
export function recordRequestState(buckets: number[], lastBucketMinute: number, curMinute: number): { buckets: number[]; lastBucketMinute: number } {
  const advanced = advanceBucketsState(buckets, lastBucketMinute, curMinute);
  const next = [...advanced.buckets];
  const last = advanced.lastBucketMinute === -1 ? curMinute : advanced.lastBucketMinute;
  next[next.length - 1] += 1;
  return { buckets: next, lastBucketMinute: last };
}

/**
 * 요청 timestamp(ms) 목록 → 30분 sliding 버킷(분단위 카운트) 일괄 산출.
 *
 * 원본 chart.js 는 recordRequest 로 한 건씩 증분 기록했지만(SSE prepend 시), React 는
 * feed 배열(라이브+시드)을 SSoT 로 들고 매 렌더 파생하는 게 단순/결정론적이다. 따라서
 * 증분 누적(recordRequestState) 대신 현재 feed 의 timestamp 들을 현재 분 기준 버킷에
 * 분배하는 순수 함수로 둔다. 인덱스 i 는 (curMinute - (BUCKETS-1-i)) 분에 대응 —
 * 마지막 버킷(i=BUCKETS-1)이 현재 분. 창(window) 밖 timestamp 는 무시.
 *
 * @param timestampsMs 요청 발생 시각(ms epoch) 목록. 비유한수는 스킵.
 * @param nowMs Date.now() 주입(결정론 — 컴포넌트가 계산해 전달).
 * @param buckets 버킷 수(기본 TIMELINE_BUCKETS=30).
 */
export function bucketizeByMinute(timestampsMs: number[], nowMs: number, buckets = TIMELINE_BUCKETS): number[] {
  const curMin = nowMinute(nowMs);
  const out = new Array<number>(buckets).fill(0);
  for (const ts of timestampsMs) {
    if (!Number.isFinite(ts)) continue;
    const idx = buckets - 1 - (curMin - nowMinute(ts));
    if (idx >= 0 && idx < buckets) out[idx] += 1;
  }
  return out;
}

/** 타임라인 점 산출(chart.js drawTimeline pts) — x 등간격, y 는 maxVal 정규화. */
export function computeTimelinePoints(buckets: number[], dims: TimelineDims): TimelinePoint[] {
  const { padL, padR, padT, padB, width, height } = dims;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const maxVal = Math.max(...buckets, 1);
  const n = buckets.length;
  return buckets.map((v, i) => ({
    x: padL + (n === 1 ? 0 : (i / (n - 1)) * chartW),
    y: padT + chartH * (1 - v / maxVal),
  }));
}
