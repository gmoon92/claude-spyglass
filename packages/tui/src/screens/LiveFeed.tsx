/**
 * LiveFeed — default screen. SSE stream → ToolRow list with follow mode + keyboard nav.
 *
 * New in v2:
 *  - useFollowMode FSM: FOLLOWING / PAUSED
 *  - ↑↓ / j/k: row selection (auto-freeze)
 *  - g/G: top/bottom jump
 *  - f: follow toggle
 *  - Enter: 4-line inline detail expand (one at a time)
 *  - RowAccent: 1.2s left stripe fade on new rows, ▌ on selected
 *
 * @see spec.md §2.3, §2.4
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/screen-inventory.md T1
 */

import React, { useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { useFeed } from '../hooks/useFeed';
import { useFollowMode } from '../hooks/useFollowMode';
import { ToolRow } from '../components/display/ToolRow';
import { RowAccent } from '../components/feedback/RowAccent';
import { Spinner } from '../components/feedback/Spinner';
import { tokens } from '../design-tokens';
import { Card } from '../components/display/Card';
import {
  formatDuration,
  shortSession,
} from '../lib/format';
import { TokenTree } from '../components/display/TokenTree';
import type { Request } from '../types';

export type LiveFeedProps = {
  width: number;
  rows: number;
  sseStatus: string;
  frozen: boolean;
};

export function LiveFeed({ width, rows, sseStatus, frozen }: LiveFeedProps): JSX.Element {
  const feed = useFeed();
  const {
    followState,
    selectedIdx,
    onNewRow,
    onMove,
    onFollowToggle,
    onGoTop,
    onGoBottom,
  } = useFollowMode();

  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const prevFeedLenRef = useRef(feed.length);

  // Detect new rows prepended — notify follow mode.
  useEffect(() => {
    const prev = prevFeedLenRef.current;
    if (feed.length > prev) {
      const diff = feed.length - prev;
      for (let i = 0; i < diff; i++) onNewRow();
    }
    prevFeedLenRef.current = feed.length;
  }, [feed.length, onNewRow]);

  // Keyboard handling within LiveFeed.
  useInput((input, key) => {
    const listLen = feed.length;
    if (key.upArrow || input === 'k') {
      onMove(-1, listLen);
      return;
    }
    if (key.downArrow || input === 'j') {
      onMove(1, listLen);
      return;
    }
    if (input === 'g') {
      onGoTop();
      return;
    }
    if (input === 'G') {
      onGoBottom(listLen);
      return;
    }
    if (input === 'f') {
      onFollowToggle();
      return;
    }
    if (key.return) {
      // Toggle inline expand for selected row.
      const rec = feed[selectedIdx];
      if (!rec) return;
      const rid = rec.tool_use_id ?? rec.id;
      setExpandedId((prev) => (prev === rid ? null : rid));
      return;
    }
    if (key.escape) {
      setExpandedId(null);
      return;
    }
  });

  // Visible slice calculation: account for expanded detail box (+4 rows).
  const hasExpand = expandedId != null;
  const expandRows = hasExpand ? 5 : 0;
  const visible = Math.max(4, rows - 2 - expandRows);
  const slice = feed.slice(0, visible + (hasExpand ? 1 : 0));

  if (feed.length === 0) {
    return (
      <Card title={titleNode(feed.length, frozen, followState)} focused>
        <EmptyState sseStatus={sseStatus} />
      </Card>
    );
  }

  return (
    <Card title={titleNode(feed.length, frozen, followState)} focused>
      <Box flexDirection="column">
        {slice.map((r, i) => {
          const rid = r.tool_use_id ?? r.id;
          const isSelected = followState === 'paused' && i === selectedIdx;
          const isExpanded = expandedId === rid;

          return (
            <React.Fragment key={rid}>
              <RowAccent since={r.arrivedAt} selected={isSelected}>
                <ToolRow
                  record={r}
                  highlightSince={undefined}
                  width={width}
                />
              </RowAccent>
              {isExpanded && <DetailBox record={r} width={width} onClose={() => setExpandedId(null)} />}
            </React.Fragment>
          );
        })}
        {feed.length > visible && followState === 'following' && (
          <Text dimColor>
            … {feed.length - visible} more · f to pause
          </Text>
        )}
        {followState === 'paused' && feed.length > visible && (
          <Text color={tokens.color.warning.fg} dimColor>
            +{feed.length - visible} more · g to follow
          </Text>
        )}
      </Box>
    </Card>
  );
}

/** Inline detail box rendered below selected row. */
function DetailBox({
  record,
  width,
  onClose,
}: {
  record: Request;
  width: number;
  onClose: () => void;
}): JSX.Element {
  void onClose; // available for future Esc handling at this level
  const boxW = Math.max(40, width - 4);
  const sid = shortSession(record.session_id);
  const dur = formatDuration(record.duration_ms);

  return (
    <Box
      borderStyle={tokens.border.subtle as never}
      borderColor={tokens.color.warning.fg}
      flexDirection="column"
      paddingX={1}
      marginLeft={1}
      width={boxW}
    >
      {/* Token usage tree */}
      <TokenTree
        input={record.tokens_input}
        output={record.tokens_output}
        cacheRead={record.tokens_cache_read}
        cacheCreate={record.tokens_cache_creation}
        total={record.tokens_total}
      />

      {/* Session / model / duration */}
      <Box flexDirection="row" marginTop={1}>
        <Text color={tokens.color.muted.fg} dimColor>├─ ses  </Text>
        <Text color={tokens.color.muted.fg} dimColor>
          {sid} · {record.model ?? '—'} · {dur}
        </Text>
      </Box>

      {/* Action hints */}
      <Box flexDirection="row">
        <Text color={tokens.color.warning.fg} dimColor>└─ </Text>
        <Text color={tokens.color.primary.fg}>[o]</Text>
        <Text color={tokens.color.muted.fg} dimColor> session  </Text>
        <Text color={tokens.color.primary.fg}>[Enter]</Text>
        <Text color={tokens.color.muted.fg} dimColor> collapse  </Text>
        <Text color={tokens.color.primary.fg}>[Esc]</Text>
        <Text color={tokens.color.muted.fg} dimColor> close</Text>
      </Box>
    </Box>
  );
}

function titleNode(count: number, frozen: boolean, followState: 'following' | 'paused'): React.ReactNode {
  return (
    <Box flexDirection="row">
      <Text color={tokens.color.primary.fg} bold>Live Feed </Text>
      <Text color={tokens.color.muted.fg}>· {count} req</Text>
      {frozen && (
        <Text color={tokens.color.warning.fg} bold>  [FROZEN]</Text>
      )}
      {followState === 'following' && (
        <Text color={tokens.color.success.fg}>  follow ●</Text>
      )}
      {followState === 'paused' && (
        <Text color={tokens.color.warning.fg}>  paused ‖</Text>
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
        <Text color={tokens.color.muted.fg}>
          {' '}{sseStatus === 'open' ? '●' : '○'} {sseStatus === 'open' ? 'connected' : sseStatus}
        </Text>
      </Box>
    </Box>
  );
}
