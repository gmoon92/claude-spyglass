/**
 * features/session-detail/PrologueCard.tsx — 세션 프롤로그 카드 (P3-06)
 *
 * 원본: assets/js/session-detail/turn-views.js#renderPrologueCardHtml (turn-views.js:758).
 *  - prompt 등록 이전 도착한 tool_call/response 행(turn_id NULL)을 spine 상단에 별도 섹션으로.
 *  - prologue 가 빈 배열/null 이면 null(원본 빈 문자열).
 *
 * SSoT 재사용(재구현 금지):
 *  - target 셀: render/cells.ts#targetInner (TSX, P2-04 동치 검증) 재사용.
 *  - preview:  render/extract.js#contextPreview (HTML 문자열 SSoT) — RawHtml 로 주입(재구현 금지).
 *  - 시각: 원본은 targetInnerHtml(r).html / contextPreview(r,60) 문자열을 그대로 박았다.
 *          targetInner(TSX) 는 동일 마크업을 이미 동치 검증했고, contextPreview 는 _promptCache
 *          부수효과(extract.js:262)가 SSoT 라 문자열 그대로 재사용한다.
 *
 * @module features/session-detail/PrologueCard
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtTime } from '../../../assets/js/formatters.js';
import { contextPreview } from '../../components/render/extract';
import { targetInner } from '../../components/render';

interface PrologueRow {
  id?: string;
  type: string;
  source?: string;
  timestamp?: string | number;
  [k: string]: unknown;
}

/** contextPreview(HTML 문자열 SSoT) 를 안전하게 주입 — 빈 문자열이면 미렌더. */
function PreviewHtml({ r }: { r: PrologueRow }): ReactElement {
  const html = contextPreview(r, 60) || '';
  return <span className="prologue-row-preview" dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * 세션 프롤로그 카드. 원본 renderPrologueCardHtml(turn-views.js:758) 동치.
 */
export function PrologueCard({ prologue }: { prologue: PrologueRow[] | null | undefined }): ReactElement | null {
  const { t } = useTranslation();
  if (!prologue || prologue.length === 0) return null;

  return (
    <div
      className="turn-prologue-card"
      role="region"
      aria-label={t('session.session-detail.turn-views.prologue-aria')}
    >
      <div className="turn-prologue-header">
        <span className="turn-prologue-title">
          {t('session.session-detail.turn-views.prologue-title')}
        </span>
        <span className="turn-prologue-count">
          {t('ui.chart.count-unit', { count: prologue.length })}
        </span>
        <span
          className="turn-prologue-hint"
          title={t('session.session-detail.turn-views.prologue-hint-title')}
        >
          {t('session.session-detail.turn-views.prologue-hint')}
        </span>
      </div>
      <div className="turn-prologue-body">
        {prologue.map((r, i) => {
          const { node } = targetInner(r);
          const sourceTag =
            r.source === 'transcript-assistant-text' ? (
              <span
                className="prologue-source-tag"
                title={t('session.session-detail.turn-views.prologue-transcript-tag')}
              >
                transcript
              </span>
            ) : r.source ? (
              <span className="prologue-source-tag">{r.source}</span>
            ) : null;
          return (
            <div key={r.id ?? i} className="prologue-row" data-type={r.type}>
              <span className="prologue-row-target">{node}</span>
              <PreviewHtml r={r} />
              {sourceTag}
              <span className="prologue-row-time">{fmtTime(r.timestamp)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
