/**
 * features/session-detail/SystemReminderChip.tsx — 시스템 리마인더 칩 + 팝오버 (P3-06 / P5 React화)
 *
 * 원본: assets/js/session-detail/turn-views.js#buildSystemReminderChip (turn-views.js:794)
 *       + session-detail/system-reminder-popover.js (open/close/toggle + portal + 전역 닫기).
 *
 *  - 신규 reminder 가 있는 턴(N>0)에 한해 flow-head 옆에 노출. N=0 이면 null(원본 빈 문자열).
 *  - anchor(.turn-system-reminder-anchor) > button(칩) + portal(팝오버 dialog).
 *
 * P5 정공법 — 명령형 DOM → 선언형 React 전환:
 *  1) open/close 를 `useState` 로 끌어올림. 원본 controller 의 `popover.hidden=false` / chip
 *     `setAttribute('aria-expanded')` 직접 DOM 변형 → JSX 속성 바인딩(`hidden={!open}`,
 *     `aria-expanded={open}`)으로 대체.
 *  2) body 이동(appendChild/originalParent 추적) → `createPortal(popoverJSX, document.body)`.
 *     transform 조상 containing-block 회피 목적은 portal 로 자연 충족(원본 §portal 사유 동일).
 *  3) 좌표 → 순수 함수 `computePopoverPosition` 재사용 결과를 inline `style={{ top, left }}` 로 바인딩.
 *     scroll/resize 시 reposition 은 컴포넌트 useEffect 안에서 좌표 state 재계산(본질적 측정 escape-hatch).
 *  4) document click/keydown(Escape)/mousedown 외부 닫기 위임을 **이 컴포넌트 자체 useEffect** 로 좁힘.
 *     capture 단계 부착 사유(카드 토글 bubble 위임보다 먼저 가로채기)는 원본과 동일하게 유지.
 *     focus 복귀(닫힐 때 칩으로)는 chipRef 로 수행.
 *
 * 단일-open 불변식: 원본은 module 싱글톤(_openPopoverId)으로 전역 1개만 열었다. 본 컴포넌트는
 *  칩별 독립 상태이나, "다른 칩을 열면 직전 칩이 닫힌다"는 동치를 위해 mousedown/click 외부 닫기가
 *  같은 칩 영역 밖 클릭(=다른 칩 클릭 포함)에서 닫히므로 실사용상 동일하게 한 시점 1개만 열린다.
 *  (한 활성 턴에 칩은 1개뿐이라 다중 동시 노출 자체가 발생하지 않음.)
 *
 * SSoT 재사용: note 글리프 → 이미 동치 검증된 Note 아이콘(design-system/icons).
 *             좌표 → computePopoverPosition(system-reminder-popover.ts, 순수 함수).
 *
 * @module features/session-detail/SystemReminderChip
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Note } from '../../components/design-system/icons';
import { computePopoverPosition, type PopoverPosition } from './system-reminder-popover';

/**
 * 신규 reminder 칩 + 팝오버. 원본 buildSystemReminderChip(turn-views.js:794) + popover controller 동치.
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
  const [open, setOpen] = useState(false);
  // 팝오버 좌표(viewport 기준 fixed). open 직후·scroll/resize 시 측정 기반 재계산.
  const [pos, setPos] = useState<PopoverPosition | null>(null);
  // SSR 안전 portal 가드 — createPortal 은 server renderer 에서 throw 한다(renderToStaticMarkup).
  //   useEffect 는 client mount 후에만 실행되므로, mounted=true 가 되기 전(=SSR/초기 렌더)엔 portal 미렌더.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  // 닫힘 시 포커스 복귀 대상 — 직전에 칩이 포커스를 가졌는지와 무관하게 키보드 흐름 유지(원본 close focus 복귀).
  const wasOpenRef = useRef(false);

  // 좌표 측정 SSoT — 순수 computePopoverPosition 재사용. 측정(getBoundingClientRect)은 본질적 명령형이라
  //   ref escape-hatch 로 유지하되, 산식은 순수 함수에 위임(직접 left/right clamp 재구현 금지).
  const reposition = useCallback((): void => {
    const chip = chipRef.current;
    const popover = popoverRef.current;
    if (!chip || !popover) return;
    const chipRect = chip.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    setPos(
      computePopoverPosition(
        { left: chipRect.left, bottom: chipRect.bottom },
        popoverRect.width,
        window.innerWidth,
      ),
    );
  }, []);

  // open 직후 좌표 1회 측정 + 팝오버 focus. useLayoutEffect 로 paint 전 위치를 확정해 깜빡임 회피.
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    popoverRef.current?.focus({ preventScroll: true });
  }, [open, reposition]);

  // 닫힌 직후 칩으로 focus 복귀(원본 close: chipEl.focus). open=true→false 전이에서만.
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      chipRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  // 전역 닫기 위임 — 팝오버가 열린 동안에만 부착(원본 useSystemReminderPopover 전역 리스너를 컴포넌트로 좁힘).
  //   capture 단계 사유(카드 토글 bubble 위임보다 먼저 가로채 칩 클릭이 카드 펼침을 일으키는 회귀 차단)는 원본과 동일.
  useEffect(() => {
    if (!open) return;
    const isInside = (target: EventTarget | null): boolean => {
      const node = target as Node | null;
      if (!node) return false;
      if (popoverRef.current?.contains(node)) return true;
      if (chipRef.current?.contains(node)) return true;
      return false;
    };
    const onMousedown = (e: MouseEvent): void => {
      if (isInside(e.target)) return;
      setOpen(false);
    };
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onViewportShift = (): void => reposition();

    document.addEventListener('mousedown', onMousedown, true);
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('scroll', onViewportShift, true);
    window.addEventListener('resize', onViewportShift);
    return () => {
      document.removeEventListener('mousedown', onMousedown, true);
      document.removeEventListener('keydown', onKeydown, true);
      window.removeEventListener('scroll', onViewportShift, true);
      window.removeEventListener('resize', onViewportShift);
    };
  }, [open, reposition]);

  if (!reminders || reminders.length === 0) return null;
  const count = reminders.length;
  const chipId = `turn-sysrem-chip-${turnIndex}`;
  const popoverId = `turn-sysrem-popover-${turnIndex}`;

  const onChipClick = (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    setOpen((v) => !v);
  };

  const popover = (
    <div
      ref={popoverRef}
      className="turn-system-reminder-popover"
      id={popoverId}
      role="dialog"
      aria-labelledby={chipId}
      tabIndex={-1}
      hidden={!open}
      style={pos ? { top: `${pos.top}px`, left: `${pos.left}px` } : undefined}
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
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }}
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
  );

  return (
    <span className="turn-system-reminder-anchor" data-turn-id={String(turnIndex)}>
      <button
        ref={chipRef}
        type="button"
        className="turn-system-reminder-chip"
        id={chipId}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        data-sysrem-toggle={popoverId}
        title={t('session.session-detail.turn-views.sysrem-chip-title', { count })}
        onClick={onChipClick}
      >
        <Note size={12} />
        <span className="turn-system-reminder-count">{count}</span>
      </button>
      {/* createPortal → document.body. transform 조상 containing-block 회피(원본 portal 사유 동일).
          SSR(renderToStaticMarkup)에서는 mounted=false 라 portal 미렌더 — 칩 버튼은 트리에 그대로 남는다. */}
      {mounted ? createPortal(popover, document.body) : null}
    </span>
  );
}
