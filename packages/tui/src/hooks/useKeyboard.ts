/**
 * useKeyboard — top-level key router.
 */

import { useInput } from 'ink';
import { feedStore } from '../stores/feed-store';
import type { ScreenId } from '../types';

export type UseKeyboardArgs = {
  onView: (screen: ScreenId) => void;
  onQuit: () => void;
  onZoom?: () => void;
  onAmbient?: () => void;
  onMove?: (delta: number) => void;
  onEnter?: () => void;
  onBack?: () => void;
  /** 'o' — jump to session for selected row. */
  onSession?: () => void;
  /** 'f' — follow toggle in LiveFeed. */
  onFollow?: () => void;
  /** 'g' — go to top (and follow ON). */
  onGoTop?: () => void;
  /** 'G' — go to bottom. */
  onGoBottom?: () => void;
  /** 'r' — reconnect SSE. */
  onReconnect?: () => void;
  /** 't' — cycle through time range presets (Tools / Anomalies). */
  onTimeRangeCycle?: () => void;
};

export function useKeyboard({
  onView,
  onQuit,
  onZoom,
  onAmbient,
  onMove,
  onEnter,
  onBack,
  onSession,
  onFollow,
  onGoTop,
  onGoBottom,
  onReconnect,
  onTimeRangeCycle,
}: UseKeyboardArgs): void {
  useInput((input, key) => {
    if (input === 'q' || input === 'Q' || (key.ctrl && input === 'c')) {
      onQuit();
      return;
    }
    if (input === '1') return onView('live');
    if (input === '2') return onView('sessions');
    if (input === '3') return onView('tools');
    if (input === '4') return onView('anomalies');
    if (input === 'm') return onAmbient?.();
    if (input === 'z') return onZoom?.();
    if (input === ' ') {
      const dropped = feedStore.setFreeze(!feedStore.isFrozen());
      void dropped;
      return;
    }

    // Time range cycle (Tools / Anomalies)
    if (input === 't') { onTimeRangeCycle?.(); return; }

    // Follow / navigation shortcuts
    if (input === 'f') return onFollow?.();
    if (input === 'g') return onGoTop?.();
    if (input === 'G') return onGoBottom?.();
    if (input === 'o') return onSession?.();
    if (input === 'r') return onReconnect?.();

    // List navigation
    if (key.upArrow || input === 'k') return onMove?.(-1);
    if (key.downArrow || input === 'j') return onMove?.(1);
    if (key.return) return onEnter?.();
    if (key.escape || input === 'h') return onBack?.();
  });
}
