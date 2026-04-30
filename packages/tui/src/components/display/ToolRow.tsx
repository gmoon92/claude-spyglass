/**
 * ToolRow — single row in Live Feed / Detail.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/components.md §Display.ToolRow
 *
 * Critical rule: same `tool_use_id` updates in place. Never duplicate pre/post.
 */

import { memo } from 'react';
import { Box, Text } from 'ink';
import { Icon } from './Icon';
import { RowAccent } from '../feedback/RowAccent';
import { tokens } from '../../design-tokens';
import {
  formatClock,
  formatDuration,
  formatTokens,
  compressToolName,
  truncate,
  shortSession,
} from '../../lib/format';
import type { Request } from '../../types';

export type ToolRowProps = {
  record: Request;
  highlightSince?: number;
  showSession?: boolean;
  width?: number;
};

export const ToolRow = memo(function ToolRow({
  record,
  highlightSince,
  showSession = true,
  width = 120,
}: ToolRowProps): JSX.Element {
  const isPre = record.event_type === 'pre_tool';
  const targetText = describeTarget(record);
  const tokensText = isPre ? '…' : record.tokens_total ? `+${formatTokens(record.tokens_total)}` : '—';
  const durText = isPre ? '…' : formatDuration(record.duration_ms);
  const sessionText = showSession ? shortSession(record.session_id) : '';
  const toolLabel = compressToolName(record.tool_name, 14).padEnd(14, ' ');

  const targetWidth = Math.max(20, width - 9 - 2 - 14 - 9 - 8 - (showSession ? 10 : 0));
  const targetTrimmed = truncate(targetText, targetWidth).padEnd(targetWidth, ' ');

  const baseColor = isPre ? tokens.color.muted.fg : tokens.color.fg.fg;

  const inner = (
    <Box flexDirection="row">
      <Text color={tokens.color.muted.fg}>{formatClock(record.timestamp)} </Text>
      <Box marginRight={1}>
        <Icon record={record} />
      </Box>
      <Text color={baseColor} dimColor={isPre}>{toolLabel} </Text>
      <Text color={baseColor} dimColor={isPre}>{targetTrimmed}</Text>
      <Text color={isPre ? tokens.color.muted.fg : tokens.color.success.fg}>{tokensText.padStart(8, ' ')} </Text>
      <Text color={tokens.color.muted.fg}>{durText.padStart(7, ' ')} </Text>
      {showSession && <Text color={tokens.color.info.fg} dimColor>{sessionText}</Text>}
    </Box>
  );

  return <RowAccent since={highlightSince}>{inner}</RowAccent>;
}, (a, b) =>
  a.record.id === b.record.id &&
  a.record.event_type === b.record.event_type &&
  a.record.tokens_total === b.record.tokens_total &&
  a.record.duration_ms === b.record.duration_ms &&
  a.record.status === b.record.status &&
  a.highlightSince === b.highlightSince &&
  a.width === b.width,
);

function describeTarget(r: Request): string {
  if (r.tool_detail) {
    // `tool_detail` is often a JSON string or short summary; try to extract a path-like.
    const td = r.tool_detail;
    if (td.length < 60) return td;
    return td.slice(0, 60) + '…';
  }
  if (r.payload && r.payload.length < 60) return r.payload;
  return '';
}
