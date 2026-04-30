/**
 * TurnCard — header + tool rows + footer for a single turn.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/components.md §Display.TurnCard
 */

import { Box, Text } from 'ink';
import { Card } from './Card';
import { ToolRow } from './ToolRow';
import { tokens } from '../../design-tokens';
import { formatClock, formatDuration, formatTokens } from '../../lib/format';
import type { Request } from '../../types';

export type Turn = {
  id: string;
  index: number;
  prompt?: string | null;
  startedAt: number;
  endedAt?: number | null;
  endReason?: string | null;
  tools: Request[];
  totalTokens: number;
  state: 'running' | 'done' | 'error';
};

export type TurnCardProps = {
  turn: Turn;
  width?: number;
};

export function TurnCard({ turn, width = 110 }: TurnCardProps): JSX.Element {
  const tone = turn.state === 'error' ? 'danger' : turn.state === 'running' ? 'success' : 'default';
  const focused = turn.state === 'running';
  const dur = turn.endedAt != null ? formatDuration(turn.endedAt - turn.startedAt) : 'running…';

  const titleColor =
    turn.state === 'error'
      ? tokens.color.danger.fg
      : turn.state === 'running'
      ? tokens.color.primary.fg
      : tokens.color.muted.fg;

  const endReason = turn.endReason ?? (turn.state === 'running' ? '' : 'end_turn');
  const endIcon =
    turn.state === 'error' ? tokens.icon.state.err : turn.state === 'running' ? '' : tokens.icon.state.ok;

  const title = (
    <Box flexDirection="row">
      <Text color={titleColor} bold>Turn {turn.index} </Text>
      <Text color={tokens.color.muted.fg}>· {formatClock(turn.startedAt)} · {dur} · {turn.tools.length} tools · +{formatTokens(turn.totalTokens)} tok</Text>
      {endReason && (
        <>
          <Text color={tokens.color.muted.fg}>  </Text>
          <Text color={turn.state === 'error' ? tokens.color.danger.fg : tokens.color.success.fg}>
            {endIcon} {endReason}
          </Text>
        </>
      )}
    </Box>
  );

  return (
    <Card title={title} tone={tone} focused={focused}>
      {turn.prompt && (
        <Box marginBottom={1}>
          <Text color={tokens.color.accent.fg}>❯ </Text>
          <Text>{truncatePrompt(turn.prompt, width - 4)}</Text>
        </Box>
      )}
      <Box flexDirection="column">
        {turn.tools.map((t) => (
          <ToolRow key={t.tool_use_id ?? t.id} record={t} showSession={false} width={width - 4} />
        ))}
      </Box>
    </Card>
  );
}

function truncatePrompt(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
