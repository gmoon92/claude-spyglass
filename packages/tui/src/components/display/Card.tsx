/**
 * Card — bordered container with optional title and focus state.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/components.md §Display.Card
 */

import { type ReactNode } from 'react';
import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';

export type CardProps = {
  title?: ReactNode;
  focused?: boolean;
  tone?: 'default' | 'danger' | 'warning' | 'success';
  flexGrow?: number;
  height?: number;
  children: ReactNode;
};

export function Card({
  title,
  focused = false,
  tone = 'default',
  flexGrow,
  height,
  children,
}: CardProps): JSX.Element {
  const toneColor =
    tone === 'danger'
      ? tokens.color.danger.fg
      : tone === 'warning'
      ? tokens.color.warning.fg
      : tone === 'success'
      ? tokens.color.success.fg
      : focused
      ? tokens.color.primary.fg
      : tokens.color.muted.fg;
  const borderStyle = focused ? tokens.border.focused : tokens.border.subtle;

  return (
    <Box
      borderStyle={borderStyle as never}
      borderColor={toneColor}
      paddingX={1}
      flexDirection="column"
      flexGrow={flexGrow}
      height={height}
    >
      {title != null && (
        <Box marginBottom={0}>
          {typeof title === 'string' ? (
            <Text color={toneColor} bold={focused}>
              {title}
            </Text>
          ) : (
            title
          )}
        </Box>
      )}
      {children}
    </Box>
  );
}
