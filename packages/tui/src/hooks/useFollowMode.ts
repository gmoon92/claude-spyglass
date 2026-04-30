/**
 * useFollowMode — FOLLOWING / PAUSED finite state machine for LiveFeed.
 *
 * State machine:
 *   FOLLOWING  NEW_SSE → prepend, selectedIdx stays 0
 *              ↑/k     → PAUSED@0
 *              ↓/j     → (no-op; already at top)
 *              g       → (no-op, already following)
 *              f       → PAUSED@0 (freeze)
 *              Enter   → expand inline (state unchanged)
 *
 *   PAUSED@N   NEW_SSE → prepend, selectedIdx → N+1 (compensate)
 *              ↑/k     → N→N-1
 *              ↓/j     → N→N+1
 *              g       → FOLLOWING@top
 *              G       → PAUSED@bottom
 *              f       → FOLLOWING@top
 *              Enter   → expand inline
 *
 * @see spec.md §2.3
 */

import { useCallback, useState } from 'react';

export type FollowState = 'following' | 'paused';

export type UseFollowModeResult = {
  followState: FollowState;
  selectedIdx: number;
  /** Call when a new SSE row prepends. Compensates paused index. */
  onNewRow: () => void;
  /** Move selection: -1 = up, +1 = down. */
  onMove: (delta: -1 | 1, listLength: number) => void;
  /** Toggle follow/pause. */
  onFollowToggle: () => void;
  /** Jump to top and enter FOLLOWING. */
  onGoTop: () => void;
  /** Jump to bottom and enter PAUSED. */
  onGoBottom: (listLength: number) => void;
};

export function useFollowMode(): UseFollowModeResult {
  const [followState, setFollowState] = useState<FollowState>('following');
  const [selectedIdx, setSelectedIdx] = useState(0);

  const onNewRow = useCallback(() => {
    setFollowState((s) => {
      if (s === 'paused') {
        // Shift selection down to compensate for new row prepended at top.
        setSelectedIdx((i) => i + 1);
      }
      return s;
    });
  }, []);

  const onMove = useCallback((delta: -1 | 1, listLength: number) => {
    if (listLength === 0) return;
    setFollowState('paused');
    setSelectedIdx((i) => Math.max(0, Math.min(listLength - 1, i + delta)));
  }, []);

  const onFollowToggle = useCallback(() => {
    setFollowState((s) => {
      if (s === 'following') {
        return 'paused';
      }
      setSelectedIdx(0);
      return 'following';
    });
  }, []);

  const onGoTop = useCallback(() => {
    setSelectedIdx(0);
    setFollowState('following');
  }, []);

  const onGoBottom = useCallback((listLength: number) => {
    if (listLength === 0) return;
    setSelectedIdx(listLength - 1);
    setFollowState('paused');
  }, []);

  return { followState, selectedIdx, onNewRow, onMove, onFollowToggle, onGoTop, onGoBottom };
}
