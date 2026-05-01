/**
 * TurnCard — header + tool rows + footer for a single turn.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/components.md §Display.TurnCard
 */

import { Box, Text } from 'ink';
import { Card } from './Card';
import { ToolRow } from './ToolRow';
import { TokenTree } from './TokenTree';
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
  totalInput?: number;
  totalOutput?: number;
  totalCacheRead?: number;
  totalCacheCreation?: number;
  state: 'running' | 'done' | 'error';
};

export type TurnCardProps = {
  turn: Turn;
  width?: number;
  /** Show expanded token breakdown in the card footer. Default: false */
  showTokenTree?: boolean;
};

export function TurnCard({ turn, width = 110, showTokenTree = false }: TurnCardProps): JSX.Element {
  const tone = turn.state === 'error' ? 'danger' : turn.state === 'running' ? 'success' : 'default';
  const focused = turn.state === 'running';
  const dur = turn.endedAt != null ? formatDuration(turn.endedAt - turn.startedAt) : 'running…';

  const titleColor =
    turn.state === 'error'
      ? tokens.color.danger.fg
      : turn.state === 'running'
      ? tokens.color.primary.fg
      : tokens.color.muted.fg;

  // data-honesty-ui: 가짜 'end_turn' 합성 금지. DB stop_reason(turn.endReason) 그대로 노출.
  // running 상태는 표지 없음. 그 외 endReason 부재 시 '—'.
  const endReason = turn.state === 'running'
    ? ''
    : (turn.endReason ?? '—');
  const endIcon = turn.state === 'error'
    ? tokens.icon.state.err
    : turn.state === 'running' || endReason === '—'
    ? ''
    : tokens.icon.state.ok;

  const endColor = turn.state === 'error'
    ? tokens.color.danger.fg
    : endReason === '—'
    ? tokens.color.muted.fg
    : tokens.color.success.fg;

  const title = (
    <Box flexDirection="row">
      <Text color={titleColor} bold>Turn {turn.index} </Text>
      <Text color={tokens.color.muted.fg}>· {formatClock(turn.startedAt)} · {dur} · {turn.tools.length} tools · +{formatTokens(turn.totalTokens)} tok</Text>
      {endReason && (
        <>
          <Text color={tokens.color.muted.fg}>  </Text>
          <Text color={endColor}>
            {endIcon ? `${endIcon} ` : ''}{endReason}
          </Text>
        </>
      )}
    </Box>
  );

  // Derive per-turn cache totals from tools (or use pre-aggregated values if available).
  const cacheReadTotal = turn.totalCacheRead ?? turn.tools.reduce((s, t) => s + (t.tokens_cache_read ?? 0), 0);
  const cacheCreationTotal = turn.totalCacheCreation ?? turn.tools.reduce((s, t) => s + (t.tokens_cache_creation ?? 0), 0);
  const inputTotal = turn.totalInput ?? turn.tools.reduce((s, t) => s + (t.tokens_input ?? 0), 0);
  const outputTotal = turn.totalOutput ?? turn.tools.reduce((s, t) => s + (t.tokens_output ?? 0), 0);

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
      {showTokenTree && (
        <Box marginTop={1} paddingLeft={1}>
          <TokenTree
            input={inputTotal || undefined}
            output={outputTotal || undefined}
            cacheRead={cacheReadTotal || undefined}
            cacheCreate={cacheCreationTotal || undefined}
            total={turn.totalTokens || undefined}
          />
        </Box>
      )}
    </Card>
  );
}

function truncatePrompt(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
