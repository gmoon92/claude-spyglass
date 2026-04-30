/**
 * Highlight — wraps a row, fades from primary background to baseline over 800ms.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/motion.md §4
 *
 * Implementation note: Ink does not let us paint a background highlight on a row
 * cheaply (no per-line bg color). We approximate with a left stripe that decays.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';

export type HighlightProps = {
  since?: number;
  children: ReactNode;
};

export function Highlight({ since, children }: HighlightProps): JSX.Element {
  const [tone, setTone] = useState<'enter' | 'hold' | 'decay' | 'baseline'>(
    since == null ? 'baseline' : 'enter',
  );

  useEffect(() => {
    if (since == null) return;
    const t1 = setTimeout(() => setTone('hold'), tokens.motion.highlight.enter);
    const t2 = setTimeout(() => setTone('decay'), tokens.motion.highlight.enter + tokens.motion.highlight.hold);
    const t3 = setTimeout(
      () => setTone('baseline'),
      tokens.motion.highlight.enter + tokens.motion.highlight.hold + tokens.motion.highlight.decay,
    );
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [since]);

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
      <Text color={stripeColor}>{stripeColor ? tokens.icon.stripe : ' '}</Text>
      <Box flexGrow={1}>{children}</Box>
    </Box>
  );
}
