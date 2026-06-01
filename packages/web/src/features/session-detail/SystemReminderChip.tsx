/**
 * features/session-detail/SystemReminderChip.tsx — 시스템 리마인더 칩 + 팝오버 (P3-06)
 *
 * 원본: assets/js/session-detail/turn-views.js#buildSystemReminderChip (turn-views.js:794).
 *  - 신규 reminder 가 있는 턴(N>0)에 한해 flow-head 옆에 노출. N=0 이면 null(원본 빈 문자열).
 *  - anchor(.turn-system-reminder-anchor) > button(칩) + div(팝오버 dialog).
 *  - 팝오버 토글/닫기 전역 리스너는 P3-07 useSystemReminderPopover 가 흡수(본 컴포넌트는 마크업만).
 *
 * SSoT 재사용: note 글리프 → 이미 동치 검증된 Note 아이콘(design-system/icons).
 *
 * @module features/session-detail/SystemReminderChip
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Note } from '../../components/design-system/icons';

/**
 * 신규 reminder 칩 + 팝오버. 원본 buildSystemReminderChip(turn-views.js:794) 동치.
 *  - id 패턴: `turn-sysrem-chip-<turnIndex>` / `turn-sysrem-popover-<turnIndex>`.
 *  - reminder 본문은 <pre> 로 escape(React 텍스트 노드).
 */
export function SystemReminderChip({
  turnIndex,
  reminders,
}: {
  turnIndex: number;
  reminders: string[] | null | undefined;
}): ReactElement | null {
  const { t } = useTranslation();
  if (!reminders || reminders.length === 0) return null;
  const count = reminders.length;
  const chipId = `turn-sysrem-chip-${turnIndex}`;
  const popoverId = `turn-sysrem-popover-${turnIndex}`;

  return (
    <span className="turn-system-reminder-anchor" data-turn-id={String(turnIndex)}>
      <button
        type="button"
        className="turn-system-reminder-chip"
        id={chipId}
        aria-haspopup="dialog"
        aria-expanded="false"
        aria-controls={popoverId}
        data-sysrem-toggle={popoverId}
        title={t('session.session-detail.turn-views.sysrem-chip-title', { count })}
      >
        <Note size={12} />
        <span className="turn-system-reminder-count">{count}</span>
      </button>
      <div
        className="turn-system-reminder-popover"
        id={popoverId}
        role="dialog"
        aria-labelledby={chipId}
        tabIndex={-1}
        hidden
      >
        <header className="turn-system-reminder-popover-header">
          <span className="turn-system-reminder-popover-title">
            <strong>{t('session.session-detail.turn-views.sysrem-title')}</strong>
            <span className="turn-system-reminder-popover-count">
              {t('session.session-detail.turn-views.sysrem-count', { count })}
            </span>
          </span>
          <button
            type="button"
            className="turn-system-reminder-popover-close"
            aria-label={t('session.session-detail.turn-views.sysrem-close')}
            data-sysrem-close={popoverId}
          >
            ×
          </button>
        </header>
        <div className="turn-system-reminder-popover-body">
          {reminders.map((body, i) => (
            <pre key={i} className="turn-system-reminder-item">
              {body}
            </pre>
          ))}
        </div>
      </div>
    </span>
  );
}
