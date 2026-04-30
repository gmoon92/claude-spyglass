/**
 * HelpOverlay — `?` 키로 표시되는 키맵 cheatsheet 모달.
 *
 * 열린 상태: background dim + 중앙 Box.
 * 닫기: ?, Esc, q
 */

import { Box, Text, useInput } from 'ink';
import { tokens } from '../../design-tokens';

type KeymapItem = [string, string];
type KeymapCategory = { category: string; items: KeymapItem[] };

const KEYMAP: KeymapCategory[] = [
  {
    category: 'Navigation',
    items: [
      ['j ↓', 'down'],
      ['k ↑', 'up'],
      ['g', 'top'],
      ['G', 'bottom'],
      ['Enter', 'open/expand'],
      ['Esc h', 'back'],
    ],
  },
  {
    category: 'View',
    items: [
      ['1', 'Live Feed'],
      ['2', 'Sessions'],
      ['3', 'Tools'],
      ['4', 'Anomalies'],
      ['m', 'Ambient mode'],
      ['z', 'Zoom panel'],
    ],
  },
  {
    category: 'Live Feed',
    items: [
      ['Space', 'freeze'],
      ['f', 'follow'],
      ['o', 'session'],
      ['/', 'search'],
    ],
  },
  {
    category: 'Tools / Anomalies',
    items: [
      ['Tab', 'next sub-tab'],
      ['Shift+Tab', 'prev sub-tab'],
      ['t', 'time range'],
    ],
  },
  {
    category: 'Modal',
    items: [
      ['/', 'search'],
      [':', 'command'],
      ['?', 'this help'],
    ],
  },
  {
    category: 'Meta',
    items: [
      ['q', 'quit'],
      ['r', 'reconnect'],
      ['Ctrl+L', 'redraw'],
    ],
  },
];

export type HelpOverlayProps = {
  onClose: () => void;
};

export function HelpOverlay({ onClose }: HelpOverlayProps): JSX.Element {
  useInput((input, key) => {
    if (input === '?' || input === 'q' || key.escape) {
      onClose();
    }
  });

  // Split into two columns: first 3 categories left, last 3 right
  const leftCols = KEYMAP.slice(0, 3);
  const rightCols = KEYMAP.slice(3);

  return (
    <Box
      position="absolute"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      width="100%"
      height="100%"
    >
      <Box
        borderStyle={tokens.border.modal}
        borderColor={tokens.color.primary.fg}
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        width={62}
      >
        {/* Title */}
        <Box justifyContent="center" marginBottom={1}>
          <Text color={tokens.color.primary.fg} bold>
            Help · spyglass
          </Text>
        </Box>

        {/* Two-column key layout */}
        <Box flexDirection="row" gap={4}>
          {/* Left column */}
          <Box flexDirection="column" width={27}>
            {leftCols.map((cat) => (
              <Box key={cat.category} flexDirection="column" marginBottom={1}>
                <Text color={tokens.color.accent.fg} bold>
                  {cat.category}
                </Text>
                <Text color={tokens.color.muted.fg}>{'─'.repeat(14)}</Text>
                {cat.items.map(([key, desc]) => (
                  <Box key={key} flexDirection="row">
                    <Text color={tokens.color.info.fg}>{key.padEnd(12)}</Text>
                    <Text color={tokens.color.fg.fg}>{desc}</Text>
                  </Box>
                ))}
              </Box>
            ))}
          </Box>

          {/* Right column */}
          <Box flexDirection="column" width={27}>
            {rightCols.map((cat) => (
              <Box key={cat.category} flexDirection="column" marginBottom={1}>
                <Text color={tokens.color.accent.fg} bold>
                  {cat.category}
                </Text>
                <Text color={tokens.color.muted.fg}>{'─'.repeat(14)}</Text>
                {cat.items.map(([key, desc]) => (
                  <Box key={key} flexDirection="row">
                    <Text color={tokens.color.info.fg}>{key.padEnd(12)}</Text>
                    <Text color={tokens.color.fg.fg}>{desc}</Text>
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        </Box>

        {/* Footer */}
        <Box justifyContent="center" marginTop={1}>
          <Text color={tokens.color.muted.fg}>
            [?] / [Esc] / [q] to close
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
