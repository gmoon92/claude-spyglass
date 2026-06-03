/**
 * lib/anomaly-field.ts — anomaly 필드 판정/포맷 순수 SSoT (B-2)
 *
 * 책임:
 *   서버 wire 객체(bloated_sys / agent_spike / context_saturation)에서 stage·pct·multiplier 를
 *   안전 추출하고, 각 배지의 "노출 여부 + 표시 데이터(stage/pct/tone/n)" 를 단일 판정한다.
 *   라벨(i18n) 은 여기서 결정하지 않는다 — i18nBase 키 base 만 돌려주고, 라벨 자체는
 *   React 컴포넌트가 useTranslation 의 t 로 해석한다(SSoT 이중화 회피).
 *
 * 연혁:
 *   원본 assets/js/render/badges.js 의 private 헬퍼 anomalyStage/anomalyNum 와
 *   _bloatedBadge / contextSaturationBadgeFullHtml / agentSpikeBadgeHtml / turnSpikeSummaryHtml
 *   의 "판정·포맷" 로직을 1:1 추출. badges.js 는 본 모듈 도입 후 제거된다(정방향 src→assets 만).
 *
 * @module lib/anomaly-field
 */

/**
 * anomaly 필드에서 단계 문자열을 안전 추출.
 * 서버 컨트랙트는 `stage`(ADR-003), 과거 `status` 별칭도 호환 — 원본 `x && (x.stage ?? x.status)` 와 동치.
 */
export function anomalyStage(x: unknown): string | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as { stage?: unknown; status?: unknown };
  const s = o.stage ?? o.status;
  return typeof s === 'string' ? s : null;
}

/** anomaly 객체에서 number 필드를 안전 추출(없으면 NaN — 원본 Number(undefined) 동치). */
export function anomalyNum(x: unknown, ...keys: string[]): number {
  if (!x || typeof x !== 'object') return NaN;
  const o = x as Record<string, unknown>;
  for (const k of keys) {
    if (o[k] != null) return Number(o[k]);
  }
  return NaN;
}

/** pct fraction(0~1) 또는 정수 % 를 표시용 정수 % 로 환산. 누락 시 '?' (원본 _bloatedBadge 동치). */
function toPct(raw: number): number | '?' {
  const v = Number.isFinite(raw) ? raw : null;
  if (v == null) return '?';
  return Math.round(v > 1 ? v : v * 100);
}

/** bloated-sys 배지 표시 정보. 노출 안 함이면 null. */
export interface BloatedSysInfo {
  /** 'warn' | 'critical'. */
  stage: 'warn' | 'critical';
  /** 표시용 정수 % 또는 '?' (누락 시). */
  pct: number | '?';
  /** data-tone 값. */
  tone: 'warn' | 'error';
  /** is-warn | is-critical stage 클래스 (앞 공백 포함, 원본 stageCls 동치). */
  stageCls: ' is-warn' | ' is-critical';
  /** i18n 키 base — `ui.anomaly.bloated-sys.{stage}`. */
  i18nBase: string;
}

/**
 * bloated_sys → 표시 정보. stage 가 warn/critical 아니면 null(미노출).
 * 원본 badges.js#_bloatedBadge 의 판정·포맷 1:1.
 */
export function bloatedSysInfo(bs: unknown): BloatedSysInfo | null {
  const stage = anomalyStage(bs);
  if (stage !== 'warn' && stage !== 'critical') return null;
  return {
    stage,
    pct: toPct(anomalyNum(bs, 'pct')),
    tone: stage === 'critical' ? 'error' : 'warn',
    stageCls: stage === 'critical' ? ' is-critical' : ' is-warn',
    i18nBase: `ui.anomaly.bloated-sys.${stage}`,
  };
}

/** context-saturation 배지 표시 정보. 노출 안 함이면 null. */
export interface ContextSaturationInfo {
  stage: 'warn' | 'critical';
  pct: number | '?';
  tone: 'warn' | 'error';
  stageCls: ' is-warn' | ' is-critical';
  i18nBase: string;
}

/**
 * context_saturation → 표시 정보. stage 가 warn/critical 아니면 null(미노출).
 * 원본 badges.js#contextSaturationBadgeFullHtml 의 판정·포맷 1:1.
 */
export function contextSaturationInfo(ctxSat: unknown): ContextSaturationInfo | null {
  const stage = anomalyStage(ctxSat);
  if (stage !== 'warn' && stage !== 'critical') return null;
  return {
    stage,
    pct: toPct(anomalyNum(ctxSat, 'pct')),
    tone: stage === 'critical' ? 'error' : 'warn',
    stageCls: stage === 'critical' ? ' is-critical' : ' is-warn',
    i18nBase: `ui.anomaly.context-saturation.${stage}`,
  };
}

/** agent-spike 배지 표시 정보. 미노출이면 null. */
export interface AgentSpikeInfo {
  /** multiplier 반올림 정수(≥3). */
  n: number;
}

/**
 * agent_spike → 표시 정보. stage 가 spike/critical 이고 multiplier ≥ 3 일 때만 노출.
 * 원본 badges.js#agentSpikeBadgeHtml / turnSpikeSummaryHtml 의 공통 판정 1:1.
 */
export function agentSpikeInfo(agentSpike: unknown): AgentSpikeInfo | null {
  const stage = anomalyStage(agentSpike);
  if (stage !== 'spike' && stage !== 'critical') return null;
  const ratio = anomalyNum(agentSpike, 'multiplier', 'ratio');
  if (!Number.isFinite(ratio) || ratio < 3) return null;
  return { n: Math.round(ratio) };
}
