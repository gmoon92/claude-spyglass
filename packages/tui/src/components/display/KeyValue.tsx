/**
 * KeyValue — aligned LABEL · VALUE rows.
 */

import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';

export type KvPair = {
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
  unit?: string;
};

export type KeyValueProps = {
  pairs: KvPair[];
  inline?: boolean;
  separator?: string;
};

const TONE: Record<NonNullable<KvPair['tone']>, string> = {
  default: tokens.color.fg.fg,
  success: tokens.color.success.fg,
  warning: tokens.color.warning.fg,
  danger: tokens.color.danger.fg,
  info: tokens.color.info.fg,
  accent: tokens.color.accent.fg,
};

export function KeyValue({ pairs, inline = false, separator = '·' }: KeyValueProps): JSX.Element {
  if (inline) {
    return (
      <Box flexDirection="row">
        {pairs.map((p, i) => (
          <Box key={i} marginRight={1}>
            {i > 0 && (
              <Text color={tokens.color.muted.fg}>
                {separator}{' '}
              </Text>
            )}
            <Text dimColor>{p.label.toUpperCase()} </Text>
            <Text bold color={TONE[p.tone ?? 'default']}>
              {p.value}
            </Text>
            {p.unit && <Text dimColor>{p.unit}</Text>}
          </Box>
        ))}
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      {pairs.map((p, i) => (
        <Box key={i} flexDirection="row">
          <Box width={12}>
            <Text dimColor>{p.label.toUpperCase()}</Text>
          </Box>
          <Text bold color={TONE[p.tone ?? 'default']}>
            {p.value}
          </Text>
          {p.unit && <Text dimColor> {p.unit}</Text>}
        </Box>
      ))}
    </Box>
  );
}
