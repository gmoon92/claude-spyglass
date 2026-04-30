/**
 * Divider — `── LABEL ────` section break.
 */

import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';

export type DividerProps = {
  label?: string;
  width?: number;
  glyph?: string;
  color?: string;
};

export function Divider({ label, width = 60, glyph = '─', color }: DividerProps): JSX.Element {
  if (label == null) {
    return <Text color={color ?? tokens.color.muted.fg}>{glyph.repeat(width)}</Text>;
  }
  const labelText = ` ${label} `;
  const remaining = Math.max(2, width - labelText.length - 2);
  const left = 2;
  const right = remaining;
  return (
    <Box flexDirection="row">
      <Text color={color ?? tokens.color.muted.fg}>{glyph.repeat(left)}</Text>
      <Text color={color ?? tokens.color.muted.fg} dimColor>{labelText}</Text>
      <Text color={color ?? tokens.color.muted.fg}>{glyph.repeat(right)}</Text>
    </Box>
  );
}
