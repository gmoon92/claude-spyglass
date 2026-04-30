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
};

export function useKeyboard({
  onView,
  onQuit,
  onZoom,
  onAmbient,
  onMove,
  onEnter,
  onBack,
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
    if (input === 'f') return onZoom?.();
    if (input === ' ') {
      const dropped = feedStore.setFreeze(!feedStore.isFrozen());
      void dropped;
      return;
    }

    // List navigation
    if (key.upArrow || input === 'k') return onMove?.(-1);
    if (key.downArrow || input === 'j') return onMove?.(1);
    if (key.return) return onEnter?.();
    if (key.escape || input === 'h') return onBack?.();
  });
}
