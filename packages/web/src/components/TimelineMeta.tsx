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
// 레이어: components leaf. i18n 라벨은 react-i18next useTranslation 으로 직접 구독한다
//   (ui.html.timeline-meta.* 키 — 원본 index.html data-i18n 1:1). 언어 전환 시 자동 재렌더.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { fmt, fmtToken, formatDuration } from '../lib/formatters';
import type { DashboardSummary } from '../schema/api-schema';

export interface TimelineMetaProps {
  /** /api/dashboard summary. null 이면 skeleton('--' / '…') 표시(원본 첫 paint 대응). */
  summary: DashboardSummary | null;
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
export function TimelineMeta({ summary }: TimelineMetaProps): ReactElement {
  const { t } = useTranslation();
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
    <div className="timeline-meta" id="timelineMeta" role="group" aria-label={t('ui:html.timeline-meta.aria')}>
      {/* 그룹 1 — 품질(평균 / P95 / 오류율) */}
      <div className="timeline-meta-group" role="group" aria-label={t('ui:html.timeline-meta.quality-group-aria')}>
        <span className="timeline-meta-group-label">{t('ui:html.timeline-meta.quality-group-label')}</span>
        <div className="header-stat" data-stat-tooltip="avg-duration">
          <span className="header-stat-value" id="statAvgDuration">
            {summary ? formatDuration(summary.avgDurationMs ?? null) : '…'}
          </span>
          <span className="header-stat-label">{t('ui:html.timeline-meta.avg-label')}</span>
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
          <span className="header-stat-label">{t('ui:html.timeline-meta.error-rate-label')}</span>
        </div>
      </div>

      {/* 그룹 2 — 누적(세션 / 요청 / 토큰) */}
      <div className="timeline-meta-group" role="group" aria-label={t('ui:html.timeline-meta.volume-group-aria')}>
        <span className="timeline-meta-group-label">{t('ui:html.timeline-meta.volume-group-label')}</span>
        <div className="header-stat" data-stat-tooltip="sessions">
          <span className="header-stat-value" id="statSessions">
            {summary ? fmt(summary.totalSessions ?? 0) : '…'}
          </span>
          <span className="header-stat-label">{t('ui:html.timeline-meta.sessions-label')}</span>
        </div>
        <div className="header-stat" data-stat-tooltip="requests">
          <span className="header-stat-value" id="statRequests">
            {summary ? fmt(summary.totalRequests ?? 0) : '…'}
          </span>
          <span className="header-stat-label">{t('ui:html.timeline-meta.requests-label')}</span>
        </div>
        <div className="header-stat" data-stat-tooltip="tokens">
          <span className="header-stat-value" id="statTokens">
            {summary ? fmtToken(summary.totalTokens ?? 0) : '…'}
          </span>
          <span className="header-stat-label">{t('ui:html.timeline-meta.tokens-label')}</span>
        </div>
      </div>
    </div>
  );
}
