// components/TimelineMeta.tsx — 차트 헤더 timeline-meta 요약 통계 블록 (레거시 복원)
//
// 원본: spyglass-legacy-ref index.html(:443~477) #timelineMeta + api.js fetchDashboard(:187~214)
//   의 stat DOM 쓰기. 두 그룹:
//     품질(Quality)  — 평균(statAvgDuration) / P95(stat-p95) / 오류율(stat-error-rate)
//     누적(Volume)   — 세션(statSessions) / 요청(statRequests) / 토큰(statTokens)
//   값은 /api/dashboard 의 summary 블록(avgDurationMs/p95DurationMs/errorRate/totalSessions/
//   totalRequests/totalTokens). 호출처(BrowseLayout)가 fetchDashboard 결과의 summary 를 주입.
//
// 원본 대비 변경:
//   - getElementById + textContent 직접 변형 폐기 → summary prop 주입(컨트롤드, 무전역).
//   - p95/error-rate 포맷은 api.js 인라인 로직 1:1(p95 <1000ms→ms, else s / error → pct.toFixed(1)).
//   - error-rate 의 .is-error/.is-critical 토글도 api.js(:209~213) 1:1 — header-stat className 에 반영.
//   - 숫자/토큰/지속시간 포맷은 레거시 formatters.js(fmt/fmtToken/formatDuration) 재사용(SSoT 일치).
//
// 셀렉터 계약 유지(E2E/CSS): #timelineMeta, .timeline-meta-group, .header-stat, .header-stat-value,
//   .header-stat-label, id=statAvgDuration/stat-p95/stat-error-rate/statSessions/statRequests/statTokens.
//
// 레이어: components leaf(순수). i18n 라벨은 호출처가 tt 로 주입(무전역).

import type { ReactElement } from 'react';
import { fmt, fmtToken, formatDuration } from '../../assets/js/formatters.js';
import type { DashboardSummary } from '../schema/api-schema';

/** timeline-meta i18n 라벨러 — window.I18n 키를 계약으로(무전역). 호출처가 tt 로 어댑트. */
export interface TimelineMetaLabeler {
  aria: () => string;
  qualityGroupAria: () => string;
  qualityGroupLabel: () => string;
  avgLabel: () => string;
  errorRateLabel: () => string;
  volumeGroupAria: () => string;
  volumeGroupLabel: () => string;
  sessionsLabel: () => string;
  requestsLabel: () => string;
  tokensLabel: () => string;
}

export interface TimelineMetaProps {
  /** /api/dashboard summary. null 이면 skeleton('--' / '…') 표시(원본 첫 paint 대응). */
  summary: DashboardSummary | null;
  labeler: TimelineMetaLabeler;
}

/** p95(ms) → '519ms' / '1.2s'(api.js:201~202 1:1). null → '--'. */
function formatP95(ms: number | null | undefined): string {
  if (ms == null) return '--';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** error rate(0..1) → '0.2%'(api.js:208 1:1). null → '--'. */
function formatErrorRate(rate: number | null | undefined): string {
  if (rate == null) return '--';
  return `${(Number(rate) * 100).toFixed(1)}%`;
}

/**
 * 차트 헤더 요약 통계 — 품질 3종 + 누적 3종. detail 모드 숨김은 CSS(.chart-mode-detail) 담당.
 */
export function TimelineMeta({ summary, labeler }: TimelineMetaProps): ReactElement {
  const errorRate = summary?.errorRate ?? null;
  // api.js:209~213 — errorRate>0 → is-error, >0.01 → is-critical. summary 없으면 토글 없음.
  const errCardCls = [
    'header-stat',
    errorRate != null && errorRate > 0 ? 'is-error' : '',
    errorRate != null && errorRate > 0.01 ? 'is-critical' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="timeline-meta" id="timelineMeta" role="group" aria-label={labeler.aria()}>
      {/* 그룹 1 — 품질(평균 / P95 / 오류율) */}
      <div className="timeline-meta-group" role="group" aria-label={labeler.qualityGroupAria()}>
        <span className="timeline-meta-group-label">{labeler.qualityGroupLabel()}</span>
        <div className="header-stat" data-stat-tooltip="avg-duration">
          <span className="header-stat-value" id="statAvgDuration">
            {summary ? formatDuration(summary.avgDurationMs ?? null) : '…'}
          </span>
          <span className="header-stat-label">{labeler.avgLabel()}</span>
        </div>
        <div className="header-stat" data-stat-tooltip="p95">
          <span className="header-stat-value" id="stat-p95">
            {summary ? formatP95(summary.p95DurationMs) : '--'}
          </span>
          <span className="header-stat-label">P95</span>
        </div>
        <div className={errCardCls} data-stat-tooltip="err">
          <span className="header-stat-value" id="stat-error-rate">
            {summary ? formatErrorRate(errorRate) : '--'}
          </span>
          <span className="header-stat-label">{labeler.errorRateLabel()}</span>
        </div>
      </div>

      {/* 그룹 2 — 누적(세션 / 요청 / 토큰) */}
      <div className="timeline-meta-group" role="group" aria-label={labeler.volumeGroupAria()}>
        <span className="timeline-meta-group-label">{labeler.volumeGroupLabel()}</span>
        <div className="header-stat" data-stat-tooltip="sessions">
          <span className="header-stat-value" id="statSessions">
            {summary ? fmt(summary.totalSessions ?? 0) : '…'}
          </span>
          <span className="header-stat-label">{labeler.sessionsLabel()}</span>
        </div>
        <div className="header-stat" data-stat-tooltip="requests">
          <span className="header-stat-value" id="statRequests">
            {summary ? fmt(summary.totalRequests ?? 0) : '…'}
          </span>
          <span className="header-stat-label">{labeler.requestsLabel()}</span>
        </div>
        <div className="header-stat" data-stat-tooltip="tokens">
          <span className="header-stat-value" id="statTokens">
            {summary ? fmtToken(summary.totalTokens ?? 0) : '…'}
          </span>
          <span className="header-stat-label">{labeler.tokensLabel()}</span>
        </div>
      </div>
    </div>
  );
}
