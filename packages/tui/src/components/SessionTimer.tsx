/** @jsxImportSource react */
import { useState, useEffect } from 'react';
import { Text } from 'ink';

export interface SessionTimerProps {
  startedAt: number;
  endedAt?: number;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function SessionTimer({ startedAt, endedAt }: SessionTimerProps): JSX.Element {
  const [now, setNow] = useState(() => endedAt ?? Date.now());

  useEffect(() => {
    if (endedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endedAt]);

  const elapsed = (endedAt ?? now) - startedAt;
  return <Text bold>{formatElapsed(elapsed)}</Text>;
}
