/**
 * LiveFeed — default screen. SSE stream → ToolRow list, with empty/loading states.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/screen-inventory.md T1
 */

import React from 'react';
import { Box, Text } from 'ink';
import { useFeed } from '../hooks/useFeed';
import { ToolRow } from '../components/display/ToolRow';
import { Spinner } from '../components/feedback/Spinner';
import { tokens } from '../design-tokens';
import { Card } from '../components/display/Card';

export type LiveFeedProps = {
  width: number;
  rows: number;
  sseStatus: string;
  frozen: boolean;
};

export function LiveFeed({ width, rows, sseStatus, frozen }: LiveFeedProps): JSX.Element {
  const feed = useFeed();
  const visible = Math.max(4, rows - 2);
  const slice = feed.slice(0, visible);

  if (feed.length === 0) {
    return (
      <Card title={titleNode(feed.length, frozen)} focused>
        <EmptyState sseStatus={sseStatus} />
      </Card>
    );
  }

  return (
    <Card title={titleNode(feed.length, frozen)} focused>
      <Box flexDirection="column">
        {slice.map((r) => (
          <ToolRow
            key={r.tool_use_id ?? r.id}
            record={r}
            highlightSince={r.arrivedAt}
            width={width}
          />
        ))}
        {feed.length > visible && (
          <Text dimColor>
            … {feed.length - visible} more (scroll not yet implemented)
          </Text>
        )}
      </Box>
    </Card>
  );
}

function titleNode(count: number, frozen: boolean): React.ReactNode {
  return (
    <Box flexDirection="row">
      <Text color={tokens.color.primary.fg} bold>Live Feed </Text>
      <Text color={tokens.color.muted.fg}>· {count} req</Text>
      {frozen && (
        <>
          <Text color={tokens.color.warning.fg} bold>  [FROZEN]</Text>
        </>
      )}
    </Box>
  );
}

function EmptyState({ sseStatus }: { sseStatus: string }): JSX.Element {
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box flexDirection="row">
        <Text color={tokens.color.primary.fg}>( )( )  </Text>
        <Text color={tokens.color.fg.fg} bold>Waiting for Claude activity…</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={tokens.color.muted.fg}>spyglass is listening. Start a Claude Code session to see requests.</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={tokens.color.muted.fg}>Try: </Text>
        <Text color={tokens.color.accent.fg}>claude</Text>
        <Text color={tokens.color.muted.fg}>  (in another terminal)</Text>
      </Box>
      <Box marginTop={1}>
        <Spinner variant="net" color={tokens.color.warning.fg} />
        <Text color={tokens.color.muted.fg}> sse: </Text>
        <Text color={sseStatus === 'open' ? tokens.color.success.fg : tokens.color.warning.fg}>{sseStatus}</Text>
      </Box>
    </Box>
  );
}
