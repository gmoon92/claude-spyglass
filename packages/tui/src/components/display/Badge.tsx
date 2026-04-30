/**
 * Badge — `[OK]` / `[ERR]` style status pill.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/components.md §Display.Badge
 */

import { Text } from 'ink';
import { tokens } from '../../design-tokens';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'accent';

export type BadgeProps = {
  tone?: BadgeTone;
  label: string;
  bracket?: '[' | '·';
};

const TONE_COLORS: Record<BadgeTone, string> = {
  success: tokens.color.success.fg,
  warning: tokens.color.warning.fg,
  danger: tokens.color.danger.fg,
  info: tokens.color.info.fg,
  muted: tokens.color.muted.fg,
  accent: tokens.color.accent.fg,
};

export function Badge({ tone = 'info', label, bracket = '[' }: BadgeProps): JSX.Element {
  const color = TONE_COLORS[tone];
  if (bracket === '·') {
    return <Text color={color}>· {label}</Text>;
  }
  return (
    <Text color={color} bold={tone === 'danger'}>
      [{label}]
    </Text>
  );
}
