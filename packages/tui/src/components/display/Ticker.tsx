/**
 * Ticker — 100ms pulsing dot that flashes on SSE event arrival.
 *
 * Normal: ▯ (idle dot, muted)
 * On event: ▮ (active) → fades back to ▯ after 400ms.
 *
 * @see spec.md §2.5
 */

import { useEffect, useRef, useState } from 'react';
import { Text } from 'ink';
import { tokens } from '../../design-tokens';

export type TickerProps = {
  /** Pass a monotonically-increasing value (e.g. lastEventAt) to trigger flash. */
  lastEventAt: number | null;
};

const FLASH_MS = 400;

export function Ticker({ lastEventAt }: TickerProps): JSX.Element {
  const [active, setActive] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (lastEventAt == null) return;
    setActive(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setActive(false), FLASH_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [lastEventAt]);

  return (
    <Text color={active ? tokens.color.ticker.active : tokens.color.ticker.idle}>
      {active ? '▮' : '▯'}
    </Text>
  );
}
