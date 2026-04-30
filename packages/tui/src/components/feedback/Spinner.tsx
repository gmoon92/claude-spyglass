/**
 * Spinner — animated frame cycle, 4..10 FPS.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/motion.md §3
 */

import { useEffect, useState } from 'react';
import { Text } from 'ink';
import { tokens } from '../../design-tokens';

export type SpinnerVariant = 'tool' | 'net' | 'bg' | 'agent';

export type SpinnerProps = {
  variant?: SpinnerVariant;
  color?: string;
};

export function Spinner({ variant = 'tool', color }: SpinnerProps): JSX.Element {
  const cfg = tokens.motion.spinner[variant];
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % cfg.frames.length), cfg.interval);
    return () => clearInterval(id);
  }, [cfg.frames.length, cfg.interval]);

  return <Text color={color ?? tokens.color.info.fg}>{cfg.frames[frame]}</Text>;
}
