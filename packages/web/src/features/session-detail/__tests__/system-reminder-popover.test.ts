/**
 * system-reminder-popover.test.ts — 팝오버 좌표 계산 순수 함수 (P3-07 / P5)
 *
 * 원본: assets/js/session-detail/system-reminder-popover.js#positionPopover:210.
 *
 * P5 전환: open/close/toggle 상태기계(createPopoverController)와 전역 닫기 훅은 SystemReminderChip
 *   (useState+createPortal)로 흡수됐다. 상태기계 특성화는 SystemReminderChip.test.tsx 로 이관.
 *   본 파일은 viewport clamp 산식(순수 수학, DOM 무관)만 검증한다.
 */
import { describe, it, expect } from 'vitest';
import { computePopoverPosition } from '../system-reminder-popover';

// ── computePopoverPosition (positionPopover:210) ─────────────────────────────────
describe('computePopoverPosition — viewport clamp(positionPopover:210)', () => {
  const GAP = 4;
  const SAFE = 8;

  it('기본: 칩 좌측 정렬 + 아래(top = chipRect.bottom + GAP)', () => {
    const pos = computePopoverPosition({ left: 100, bottom: 50 }, 200, 1000);
    expect(pos.left).toBe(100);
    expect(pos.top).toBe(50 + GAP);
  });

  it('우측 넘침 → left = innerWidth - width - SAFE', () => {
    // left(900) + width(200) = 1100 > 1000 - 8 → 1000 - 200 - 8 = 792
    const pos = computePopoverPosition({ left: 900, bottom: 30 }, 200, 1000);
    expect(pos.left).toBe(1000 - 200 - SAFE);
  });

  it('좌측 넘침(보정 결과 < SAFE) → left = SAFE 로 clamp', () => {
    // viewport 폭(100)보다 팝오버(200)가 넓음 → 우측보정 100-200-8=-108 < 8 → 8 로 clamp
    const pos = computePopoverPosition({ left: 5, bottom: 10 }, 200, 100);
    expect(pos.left).toBe(SAFE);
  });

  it('top 은 하단 넘침 보정 없음(칩 아래 고정)', () => {
    const pos = computePopoverPosition({ left: 0, bottom: 999 }, 50, 1000);
    expect(pos.top).toBe(999 + GAP);
  });
});
