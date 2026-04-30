/**
 * RowAccent — 1-col left stripe ▎ that fades from primary → muted → invisible in 1.2s.
 *
 * Replaces Highlight.tsx.  Identical external API (since/children) but uses
 * the 1.2s decay from spec §2.3 instead of the old 880ms (80+300+500).
 *
 * States:
 *   enter  (0–80ms)    : primary ▎
 *   hold   (80–500ms)  : info ▎
 *   decay  (500–1200ms): muted ▎
 *   baseline (>1200ms) : invisible ' '
 *
 * @see spec.md §2.3
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';

export type RowAccentProps = {
  /** Timestamp (ms) when this row arrived. Re-triggers on change. */
  since?: number;
  /** Whether this row is currently selected (shows solid ▌ in primary). */
  selected?: boolean;
  children: ReactNode;
};

const ENTER_MS  = 80;
const HOLD_MS   = 420;   // enter+hold = 500ms total
const DECAY_MS  = 700;   // decay end = 1200ms total

export function RowAccent({ since, selected, children }: RowAccentProps): JSX.Element {
  const [tone, setTone] = useState<'enter' | 'hold' | 'decay' | 'baseline'>(
    since == null ? 'baseline' : 'enter',
  );

  useEffect(() => {
    if (since == null) return;
    setTone('enter');
    const t1 = setTimeout(() => setTone('hold'),     ENTER_MS);
    const t2 = setTimeout(() => setTone('decay'),    ENTER_MS + HOLD_MS);
    const t3 = setTimeout(() => setTone('baseline'), ENTER_MS + HOLD_MS + DECAY_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [since]);

  // Selected row always shows solid ▌ in primary, overriding fade.
  if (selected) {
    return (
      <Box flexDirection="row">
        <Text color={tokens.color.primary.fg}>▌</Text>
        <Box flexGrow={1}>{children}</Box>
      </Box>
    );
  }

  const stripeColor =
    tone === 'enter'
      ? tokens.color.primary.fg
      : tone === 'hold'
      ? tokens.color.info.fg
      : tone === 'decay'
      ? tokens.color.muted.fg
      : undefined;

  return (
    <Box flexDirection="row">
      <Text color={stripeColor}>{stripeColor ? '▎' : ' '}</Text>
      <Box flexGrow={1}>{children}</Box>
    </Box>
  );
}
