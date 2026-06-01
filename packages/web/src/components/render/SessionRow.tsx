/**
 * render/SessionRow.tsx — 세션 행 React 대응물 (P2-04)
 *
 * 원본: assets/js/render/rows.js#makeSessionRow.
 *
 * 전략(D형 골든마스터 — makeSessionRow 6종 snapshot 동치):
 *  - 사이드바 세션 행 구조(헤더 4요소 + preview)를 JSX 로 1:1 이식.
 *  - live_state 분기(ended/stale/live)·라벨·tone 은 원본 SSoT 그대로. 상태 글리프는
 *    동치 검증된 TSX StatusActive/Stale/Ended 재사용.
 *  - preview 추출(extractFirstPrompt)·토큰 포맷(fmtToken)·상대시간(fmtRelative)·escHtml 은
 *    원본 SSoT 재사용. bloated dot 은 SSoT producer(bloatedSysBadgeDotHtml + getBloatedSysFor) 호출.
 *
 * @module render/SessionRow
 */
import type { ReactElement } from 'react';
import { fmtToken, fmtRelative } from '../../../assets/js/formatters.js';
import { extractFirstPrompt } from '../../../assets/js/render/extract.js';
import { bloatedSysBadgeDotHtml } from '../../../assets/js/render/badges.js';
import { getBloatedSysFor } from '../../../assets/js/state/anomaly-cache.js';
import { StatusActive, StatusStale, StatusEnded } from '../design-system/icons';

/** i18n 번역 함수 시그니처 — SessionRow 는 SessionList 가 함수로 호출(JSX 아님)하므로 useTranslation 훅
 *  대신 t 를 prop 으로 주입받는다(rules-of-hooks 회피). */
type TFn = (key: string, vars?: Record<string, unknown>) => string;

interface SessionLike {
  id: string;
  started_at?: string | number | null;
  ended_at?: string | number | null;
  live_state?: string | null;
  first_prompt_payload?: string | null;
  total_tokens?: number;
  bloated_sys?: unknown;
}

/**
 * 세션 행 — 원본 rows.js#makeSessionRow.
 * @param s 세션 데이터
 * @param isSelected 선택 강조 여부('row-selected')
 * @param t i18n 번역 함수(호출처 SessionList 가 useTranslation 으로 주입). 미주입 시 레거시 window.I18n.t
 *   폴백 — SessionRow 는 함수/JSX 양쪽으로 호출되고, 골든 동치 테스트는 t 미주입으로 렌더하므로 안전 폴백.
 */
export function SessionRow({ s, isSelected, t: tProp }: { s: SessionLike; isSelected: boolean; t?: TFn }): ReactElement {
  // t 해석 — prop 우선, 없으면 레거시 전역 window.I18n.t(전환기 폴백).
  const t: TFn = tProp ?? ((k) => (globalThis as { I18n?: { t?: (k: string) => string } }).I18n?.t?.(k) ?? k);
  // live_state 단일 분기 — 클라 자체 stale 판정 금지(서버 권위). 구버전 폴백: ended_at 기준.
  const liveState = s.live_state || (s.ended_at ? 'ended' : 'live');
  let statusGlyph: ReactElement;
  let statusCls: string;
  let statusTitle: string;
  let statusTone: string;
  if (liveState === 'ended') {
    statusGlyph = <StatusEnded size={12} />;
    statusCls = '';
    statusTitle = t('session.rows.status.ended');
    statusTone = 'ended';
  } else if (liveState === 'stale') {
    statusGlyph = <StatusStale size={12} />;
    statusCls = ' stale';
    statusTitle = t('session.rows.status.stale');
    statusTone = 'stale';
  } else {
    statusGlyph = <StatusActive size={12} />;
    statusCls = ' active';
    statusTitle = t('session.rows.status.live');
    statusTone = 'active';
  }
  const shortId = s.id.slice(0, 8);
  const preview = extractFirstPrompt(s.first_prompt_payload);
  const rel = fmtRelative(s.started_at);
  const bloatedDotHtml = bloatedSysBadgeDotHtml(s.bloated_sys || getBloatedSysFor(s.id));

  return (
    <tr className={`clickable${isSelected ? ' row-selected' : ''}`} data-session-id={s.id}>
      <td colSpan={4} className="sess-row-cell" style={{ padding: '5px 10px' }}>
        <div className="sess-row-header">
          <span className="sess-id" title={s.id}>
            {shortId}
          </span>
          <span className="sess-row-time">{rel}</span>
          <span className="sess-row-tokens">{fmtToken(s.total_tokens)}</span>
          <span
            className={`sess-row-status${statusCls} ds-dot`}
            data-tone={statusTone}
            data-size="md"
            title={statusTitle}
          >
            {statusGlyph}
          </span>
          {bloatedDotHtml ? <span dangerouslySetInnerHTML={{ __html: bloatedDotHtml }} /> : null}
        </div>
        {preview ? (
          <div className="sess-row-preview" title={preview}>
            {preview}
          </div>
        ) : null}
      </td>
    </tr>
  );
}
