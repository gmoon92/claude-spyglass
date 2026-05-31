/**
 * features/dashboard/tool-stats-view.ts — 도구 통계 매트릭스 행 뷰모델 (P3-09)
 *
 * 원본: assets/js/tool-stats.js renderMatrix 의 행 산술(callPct/durPct/durUnavailable/
 *  confidence mark/error badge/token %)을 순수 추출. JSX(ToolStatsMatrix.tsx)가 소비.
 *  data-honesty-ui(ADR-002/003): duration 0 제외 max, confidence 비-high → '*' mark.
 *
 * @module features/dashboard/tool-stats-view
 */
import type { ToolStatRow } from './tool-stats-sort';

/** 매트릭스 행 1건 뷰모델. */
export interface MatrixRowView {
  toolName: string;
  callCount: number;
  callPct: number;
  /** avg_duration_ms(0/누락이면 durUnavailable). */
  durMs: number;
  durBarPct: number;
  durUnavailable: boolean;
  tokPct: number;
  /** Math.min(tokPct,100) — token 기여 막대 width. */
  tokBarPct: number;
  /** confidence 비-high → '*' mark 노출 여부 + 툴팁 키. */
  hasLowConf: boolean;
  confTipKey: string;
  /** error_count(>0 이면 badge). */
  errorCount: number;
}

/** 매트릭스 전체 뷰모델(빈/정상). max 산정은 duration 0 제외. */
export interface MatrixView {
  maxCalls: number;
  maxDur: number;
  rows: MatrixRowView[];
}

/**
 * 행 배열 → 매트릭스 뷰모델. (원본 renderMatrix 산술 SSoT)
 *  - maxCalls = max(call_count, 1).
 *  - maxDur = max(avg_duration_ms>0 인 값, 1) — 0 행은 왜곡 방지로 제외(ADR-003).
 *  - confidence: error>0 → token-confidence-error, 그 외 low>0 → token-confidence-low.
 */
export function computeMatrixView(stats: ReadonlyArray<ToolStatRow>): MatrixView {
  const maxCalls = Math.max(...stats.map((s) => s.call_count || 0), 1);
  const maxDur = Math.max(...stats.map((s) => s.avg_duration_ms || 0).filter((v) => v > 0), 1);

  const rows: MatrixRowView[] = stats.map((s) => {
    const callPct = Math.round(((s.call_count || 0) / maxCalls) * 100);
    const durMs = s.avg_duration_ms || 0;
    const durPct = Math.round((durMs / maxDur) * 100);
    const tokPct = s.pct_of_total_tokens || 0;
    const durUnavailable = !durMs;

    const errCount = s.confidence_error_count || 0;
    const lowCount = s.confidence_low_count || 0;
    const hasLowConf = !!s.has_low_confidence || errCount + lowCount > 0;
    const confTipKey = errCount > 0 ? 'common.token-confidence-error' : 'common.token-confidence-low';

    return {
      toolName: s.tool_name ?? '',
      callCount: s.call_count || 0,
      callPct,
      durMs,
      durBarPct: durUnavailable ? 0 : durPct,
      durUnavailable,
      tokPct,
      tokBarPct: Math.min(tokPct, 100),
      hasLowConf,
      confTipKey,
      errorCount: s.error_count || 0,
    };
  });

  return { maxCalls, maxDur, rows };
}
