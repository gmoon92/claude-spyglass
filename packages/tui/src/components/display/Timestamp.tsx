/**
 * Timestamp — self-ticking, dim color.
 */

import { useEffect, useState } from 'react';
import { Text } from 'ink';
import { tokens } from '../../design-tokens';
import { formatClock, formatRelative } from '../../lib/format';

export type TimestampProps = {
  at: number;
  format?: 'absolute' | 'relative';
};

export function Timestamp({ at, format = 'absolute' }: TimestampProps): JSX.Element {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (format !== 'relative') return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [format]);

  const text = format === 'relative' ? formatRelative(at) : formatClock(at);
  return (
    <Text color={tokens.color.muted.fg} dimColor>
      {text}
    </Text>
  );
}
