/**
 * Icon — single resolution point for tool icons.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/tool-icons.md §4
 *
 * Callers pass the raw record; Icon decides spinner vs static via toolIconForRecord.
 */

import { memo } from 'react';
import { Text } from 'ink';
import { Spinner } from '../feedback/Spinner';
import { toolIconForRecord, type ToolIconResolution } from '../../lib/tool-icon';
import { tokens } from '../../design-tokens';
import type { Request } from '../../types';

export type IconProps = {
  record: Pick<Request, 'tool_name' | 'event_type' | 'tool_detail' | 'status'>;
};

export const Icon = memo(function Icon({ record }: IconProps): JSX.Element {
  const r: ToolIconResolution = toolIconForRecord(record);
  if (r.spinning) return <Spinner variant="tool" color={r.color} />;
  return <Text color={r.color}>{r.glyph}</Text>;
});

/** Stand-alone state icon (✓/✗/⚠/●/○). */
export function StateIcon({ kind, color }: { kind: keyof typeof tokens.icon.state; color?: string }): JSX.Element {
  const stateColors: Record<string, string> = {
    ok: tokens.color.success.fg,
    err: tokens.color.danger.fg,
    warn: tokens.color.warning.fg,
    info: tokens.color.info.fg,
    running: tokens.color.primary.fg,
    idle: tokens.color.muted.fg,
  };
  return (
    <Text color={color ?? stateColors[kind] ?? tokens.color.fg.fg}>
      {tokens.icon.state[kind]}
    </Text>
  );
}
