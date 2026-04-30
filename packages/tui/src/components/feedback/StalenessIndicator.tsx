/**
 * StalenessIndicator — shows ⚠ reconnecting when SSE is stale >2s,
 * then ✓ live for 1.5s after recovery.
 *
 * @see spec.md §2.5
 */

import { useEffect, useRef, useState } from 'react';
import { Text } from 'ink';
import { tokens } from '../../design-tokens';

export type StalenessIndicatorProps = {
  sseStatus: string;
  lastEventAt: number | null;
  /** Milliseconds of silence before showing ⚠. Default 2000. */
  staleMs?: number;
};

type DisplayState = 'live-flash' | 'stale' | 'hidden';

const LIVE_FLASH_MS = 1500;
const CHECK_INTERVAL_MS = 500;

export function StalenessIndicator({
  sseStatus,
  lastEventAt,
  staleMs = 2000,
}: StalenessIndicatorProps): JSX.Element {
  const [display, setDisplay] = useState<DisplayState>('hidden');
  const prevStatusRef = useRef(sseStatus);
  const liveFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect reconnection: status changed from reconnecting → open.
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = sseStatus;
    if (prev !== 'open' && sseStatus === 'open') {
      setDisplay('live-flash');
      if (liveFlashTimerRef.current) clearTimeout(liveFlashTimerRef.current);
      liveFlashTimerRef.current = setTimeout(() => setDisplay('hidden'), LIVE_FLASH_MS);
    }
  }, [sseStatus]);

  // Poll for staleness.
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      const elapsed = lastEventAt == null ? Number.POSITIVE_INFINITY : now - lastEventAt;
      if (elapsed > staleMs && sseStatus !== 'open') {
        setDisplay((d) => (d === 'live-flash' ? d : 'stale'));
      } else if (sseStatus === 'open' && elapsed <= staleMs) {
        // Fresh data, no stale warning (live-flash may still be showing).
        setDisplay((d) => (d === 'stale' ? 'hidden' : d));
      }
    };
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [lastEventAt, staleMs, sseStatus]);

  if (display === 'hidden') return <Text>{''}</Text>;

  if (display === 'live-flash') {
    return <Text color={tokens.color.live}>✓ live</Text>;
  }

  // stale
  return <Text color={tokens.color.stale}>⚠ reconnecting</Text>;
}
