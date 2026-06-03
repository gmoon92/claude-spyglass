/**
 * features/session-detail/PrologueCard.tsx — 세션 프롤로그 카드 (P3-06)
 *
 * 원본: assets/js/session-detail/turn-views.js#renderPrologueCardHtml (turn-views.js:758).
 *  - prompt 등록 이전 도착한 tool_call/response 행(turn_id NULL)을 spine 상단에 별도 섹션으로.
 *  - prologue 가 빈 배열/null 이면 null(원본 빈 문자열).
 *
 * SSoT 재사용(재구현 금지):
 *  - target 셀: render/cells.ts#targetInner (TSX, P2-04 동치 검증) 재사용.
 *  - preview:  render/ContextPreview(React, B-2) — contextPreviewData SSoT(+_promptCache 부수효과).
 *  - 시각: 원본은 targetInnerHtml(r).html / contextPreview(r,60) 문자열을 그대로 박았다.
 *          targetInner(TSX)·ContextPreview 가 동일 마크업을 렌더(.prologue-row-preview > .prompt-preview).
 *
 * @module features/session-detail/PrologueCard
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtTime } from '../../lib/formatters';
import { ContextPreview } from '../../components/render/ContextPreview';
import { targetInner } from '../../components/render';

interface PrologueRow {
  id?: string;
  type: string;
  source?: string;
  timestamp?: string | number;
  [k: string]: unknown;
}

/**
 * prologue 행 미리보기 — 원본은 `<span class="prologue-row-preview">{contextPreview HTML}</span>`.
 * ContextPreview 가 빈 텍스트면 null 을 반환하지만, 원본은 항상 .prologue-row-preview 래퍼를 출력했으므로
 * 래퍼는 유지하고 내부만 ContextPreview(없으면 빈 래퍼)로 둔다(원본 동치).
 */
function PreviewCell({ r }: { r: PrologueRow }): ReactElement {
  return (
    <span className="prologue-row-preview">
      <ContextPreview r={r} maxLen={60} />
    </span>
  );
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
              <PreviewCell r={r} />
              {sourceTag}
              <span className="prologue-row-time">{fmtTime(r.timestamp)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
