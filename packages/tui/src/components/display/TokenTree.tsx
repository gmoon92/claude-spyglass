/**
 * TokenTree — token usage breakdown in tree-glyph format.
 *
 * Layout:
 *   TOKENS
 *   ├─ in           1.2k
 *   ├─ out          340
 *   ├─ cache·read   8.4k
 *   ├─ cache·write  240
 *   └─ total        10.2k
 *
 * Zero / undefined values are shown as "—" (dimmed).
 */

import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';
import { formatTokens } from '../../lib/format';

export type TokenTreeProps = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheCreate?: number;
  total?: number;
};

function ColoredTreeRow({
  glyph,
  label,
  value,
  valueColor,
  isTotal,
}: {
  glyph: '├─' | '└─';
  label: string;
  value?: number;
  valueColor: string;
  isTotal?: boolean;
}): JSX.Element {
  const hasValue = value != null && value > 0;
  return (
    <Box flexDirection="row">
      <Text color={tokens.color.muted.fg} dimColor>{glyph} </Text>
      <Text color={isTotal ? tokens.color.fg.fg : tokens.color.muted.fg} dimColor={!isTotal}>{label.padEnd(12)}</Text>
      {hasValue ? (
        <Text color={valueColor} bold={isTotal}>{formatTokens(value)}</Text>
      ) : (
        <Text color={tokens.color.muted.fg} dimColor>—</Text>
      )}
    </Box>
  );
}

export function TokenTree({ input, output, cacheRead, cacheCreate, total }: TokenTreeProps): JSX.Element {
  return (
    <Box flexDirection="column">
      <Text color={tokens.color.muted.fg} dimColor>TOKENS</Text>
      <ColoredTreeRow glyph="├─" label="in" value={input} valueColor={tokens.color.warning.fg} />
      <ColoredTreeRow glyph="├─" label="out" value={output} valueColor={tokens.color.warning.fg} />
      <ColoredTreeRow glyph="├─" label="cache·read" value={cacheRead} valueColor={tokens.color.info.fg} />
      <ColoredTreeRow glyph="├─" label="cache·write" value={cacheCreate} valueColor={tokens.color.info.fg} />
      <ColoredTreeRow glyph="└─" label="total" value={total} valueColor={tokens.color.success.fg} isTotal />
    </Box>
  );
}
