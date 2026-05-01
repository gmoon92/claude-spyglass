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

import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useFeed } from '../hooks/useFeed';
import { useFollowMode } from '../hooks/useFollowMode';
import { useProxyRequests } from '../hooks/useProxyRequests';
import type { ProxyRequestSummary } from '../hooks/useProxyRequests';
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
  apiUrl: string;
};

export function LiveFeed({ width, rows, sseStatus, frozen, apiUrl }: LiveFeedProps): JSX.Element {
  const feed = useFeed();
  const { latestEndTurn } = useProxyRequests(apiUrl, 30_000);
  const {
    followState,
    selectedIdx,
    onNewRow,
    onMove,
    onFollowToggle,
    onGoTop,
    onGoBottom,
  } = useFollowMode();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // 검색 취소 시 복귀할 expandedId 저장
  const savedExpandedRef = useRef<string | null>(null);
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
    // 검색 모드 처리
    if (searchActive) {
      if (key.escape) {
        // 검색 취소 — 쿼리 폐기, 원래 상태 복귀
        setSearchActive(false);
        setSearchQuery('');
        setExpandedId(savedExpandedRef.current);
        return;
      }
      if (key.return) {
        // 검색 확정 — 쿼리 보존, 노멀 모드 복귀
        setSearchActive(false);
        return;
      }
      if (key.backspace || key.delete) {
        setSearchQuery((q) => q.slice(0, -1));
        return;
      }
      // 일반 문자 입력 (알파벳/숫자/공백/하이픈/점/밑줄 등)
      if (input && input.length === 1 && !key.ctrl && !key.meta) {
        setSearchQuery((q) => q + input);
        return;
      }
      return; // 검색 모드 중 다른 키 무시
    }

    // 노멀 모드
    const listLen = filteredFeed.length;
    if (input === '/') {
      // 검색 모드 진입
      savedExpandedRef.current = expandedId;
      setSearchActive(true);
      setSearchQuery('');
      return;
    }
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
      const rec = filteredFeed[selectedIdx];
      if (!rec) return;
      const rid = rec.tool_use_id ?? rec.id;
      setExpandedId((prev) => (prev === rid ? null : rid));
      return;
    }
    if (key.escape) {
      if (searchQuery) {
        // 검색어 있으면 클리어
        setSearchQuery('');
        return;
      }
      setExpandedId(null);
      return;
    }
  });

  // 검색 필터 적용 (case-insensitive substring match)
  const filteredFeed = React.useMemo(() => {
    if (!searchQuery) return feed;
    const q = searchQuery.toLowerCase();
    return feed.filter((r) => {
      const toolName = (r.tool_name ?? '').toLowerCase();
      const detail = (r.tool_detail ?? '').toLowerCase();
      const sid = (r.session_id ?? '').slice(0, 8).toLowerCase();
      return toolName.includes(q) || detail.includes(q) || sid.includes(q);
    });
  }, [feed, searchQuery]);

  // Visible slice calculation: account for expanded detail box (+4 rows) and response panel (+1 row).
  const hasExpand = expandedId != null;
  const expandRows = hasExpand ? 5 : 0;
  const searchBarRows = searchActive || searchQuery ? 1 : 0;
  const responseRows = latestEndTurn ? 1 : 0;
  const visible = Math.max(4, rows - 2 - expandRows - searchBarRows - responseRows);
  const slice = filteredFeed.slice(0, visible + (hasExpand ? 1 : 0));

  const title = titleNode(feed.length, frozen, followState, searchActive, searchQuery, filteredFeed.length);

  if (feed.length === 0) {
    return (
      <Card title={title} focused>
        {latestEndTurn && <LatestResponseBar record={latestEndTurn} width={width} />}
        <EmptyState sseStatus={sseStatus} />
      </Card>
    );
  }

  return (
    <Card title={title} focused>
      <Box flexDirection="column">
        {/* 최신 어시스턴트 응답 */}
        {latestEndTurn && <LatestResponseBar record={latestEndTurn} width={width} />}
        {/* 검색바 */}
        {(searchActive || searchQuery) && (
          <Box flexDirection="row" marginBottom={0}>
            <Text color={tokens.color.warning.fg}>{'╭─ /'}</Text>
            <Text color={tokens.color.info.fg} bold>search: </Text>
            <Text color={tokens.color.fg.fg}>{searchQuery}</Text>
            {searchActive && <Text color={tokens.color.warning.fg}>█</Text>}
            <Text color={tokens.color.muted.fg}>
              {searchActive ? ' (Enter: 확정  Esc: 취소)' : '  [Esc] 클리어'}
            </Text>
          </Box>
        )}
        {slice.map((r, i) => {
          const rid = r.tool_use_id ?? r.id;
          const isSelected = followState === 'paused' && i === selectedIdx;
          const isExpanded = expandedId === rid;
          const isSearchMatch = !!searchQuery;

          return (
            <React.Fragment key={rid}>
              <RowAccent since={r.arrivedAt} selected={isSelected}>
                <Box flexDirection="row">
                  {isSearchMatch && (
                    <Text color={tokens.color.warning.fg}>▎</Text>
                  )}
                  <Box flexGrow={1}>
                    <ToolRow
                      record={r}
                      highlightSince={undefined}
                      width={isSearchMatch ? width - 1 : width}
                    />
                  </Box>
                </Box>
              </RowAccent>
              {isExpanded && <DetailBox record={r} width={width} onClose={() => setExpandedId(null)} />}
            </React.Fragment>
          );
        })}
        {filteredFeed.length > visible && followState === 'following' && (
          <Text dimColor>
            … {filteredFeed.length - visible} more · f to pause
          </Text>
        )}
        {followState === 'paused' && filteredFeed.length > visible && (
          <Text color={tokens.color.warning.fg} dimColor>
            +{filteredFeed.length - visible} more · g to follow
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

function titleNode(
  count: number,
  frozen: boolean,
  followState: 'following' | 'paused',
  searchActive: boolean,
  searchQuery: string,
  hitCount: number,
): React.ReactNode {
  return (
    <Box flexDirection="row">
      <Text color={tokens.color.primary.fg} bold>Live Feed </Text>
      <Text color={tokens.color.muted.fg}>· {count} req</Text>
      {searchQuery && (
        <>
          <Text color={tokens.color.muted.fg}> · </Text>
          <Text color={tokens.color.warning.fg}>/search: {searchQuery}</Text>
          <Text color={tokens.color.muted.fg}> · {hitCount} hits</Text>
        </>
      )}
      {searchActive && !searchQuery && (
        <Text color={tokens.color.warning.fg}>  /search…</Text>
      )}
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

/**
 * One-line bar showing the most recent end_turn assistant response from the proxy.
 * Truncated to fit the available width.
 */
function LatestResponseBar({
  record,
  width,
}: {
  record: ProxyRequestSummary;
  width: number;
}): JSX.Element {
  const modelShort = record.model
    ? record.model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
    : '—';
  const preview = record.response_preview ?? '';
  // Reserve space for prefix: "◆ [end_turn] modelShort  " + 2 padding
  const prefixLen = 4 + 9 + modelShort.length + 2;
  const maxPreview = Math.max(10, width - prefixLen - 4);
  const truncated = preview.length > maxPreview
    ? preview.slice(0, maxPreview - 1) + '…'
    : preview;

  return (
    <Box flexDirection="row" marginBottom={0}>
      <Text color={tokens.color.accent.fg}>{'◆ '}</Text>
      <Text color={tokens.color.muted.fg}>{'['}</Text>
      <Text color={tokens.color.success.fg}>{'end_turn'}</Text>
      <Text color={tokens.color.muted.fg}>{'] '}</Text>
      <Text color={tokens.color.info.fg}>{modelShort}</Text>
      <Text color={tokens.color.muted.fg}>{'  '}</Text>
      <Text color={tokens.color.fg.fg}>{truncated}</Text>
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
