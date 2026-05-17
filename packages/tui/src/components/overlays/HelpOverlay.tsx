/**
 * HelpOverlay — `?` 키로 표시되는 키맵 cheatsheet 모달.
 *
 * 열린 상태: background dim + 중앙 Box.
 * 닫기: ?, Esc, q
 */

import { Box, Text, useInput } from 'ink';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../design-tokens';

type KeymapItem = [string, string];
type KeymapCategory = { categoryKey: string; items: KeymapItem[] };

const KEYMAP: KeymapCategory[] = [
  {
    categoryKey: 'help-overlay.categories.navigation',
    items: [
      ['j ↓', 'help-overlay.keys.down'],
      ['k ↑', 'help-overlay.keys.up'],
      ['g', 'help-overlay.keys.top'],
      ['G', 'help-overlay.keys.bottom'],
      ['Enter', 'help-overlay.keys.open-expand'],
      ['Esc h', 'help-overlay.keys.back'],
    ],
  },
  {
    categoryKey: 'help-overlay.categories.view',
    items: [
      ['1', 'help-overlay.keys.live-feed'],
      ['2', 'help-overlay.keys.sessions'],
      ['3', 'help-overlay.keys.tools'],
      ['4', 'help-overlay.keys.anomalies'],
      ['m', 'help-overlay.keys.ambient-mode'],
      ['z', 'help-overlay.keys.zoom-panel'],
    ],
  },
  {
    categoryKey: 'help-overlay.categories.live-feed',
    items: [
      ['Space', 'help-overlay.keys.freeze'],
      ['f', 'help-overlay.keys.follow'],
      ['o', 'help-overlay.keys.session'],
      ['/', 'help-overlay.keys.search'],
    ],
  },
  {
    categoryKey: 'help-overlay.categories.tools-anomalies',
    items: [
      ['Tab', 'help-overlay.keys.next-sub-tab'],
      ['Shift+Tab', 'help-overlay.keys.prev-sub-tab'],
      ['t', 'help-overlay.keys.time-range'],
    ],
  },
  {
    categoryKey: 'help-overlay.categories.modal',
    items: [
      ['/', 'help-overlay.keys.search'],
      [':', 'help-overlay.keys.command'],
      ['?', 'help-overlay.keys.this-help'],
    ],
  },
  {
    categoryKey: 'help-overlay.categories.meta',
    items: [
      ['q', 'help-overlay.keys.quit'],
      ['r', 'help-overlay.keys.reconnect'],
      ['Ctrl+L', 'help-overlay.keys.redraw'],
    ],
  },
];

export type HelpOverlayProps = {
  onClose: () => void;
};

export function HelpOverlay({ onClose }: HelpOverlayProps): JSX.Element {
  const { t } = useTranslation('ui');

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
            {t('help-overlay.title')}
          </Text>
        </Box>

        {/* Two-column key layout */}
        <Box flexDirection="row" gap={4}>
          {/* Left column */}
          <Box flexDirection="column" width={27}>
            {leftCols.map((cat) => (
              <Box key={cat.categoryKey} flexDirection="column" marginBottom={1}>
                <Text color={tokens.color.accent.fg} bold>
                  {t(cat.categoryKey)}
                </Text>
                <Text color={tokens.color.muted.fg}>{'─'.repeat(14)}</Text>
                {cat.items.map(([key, descKey]) => (
                  <Box key={key} flexDirection="row">
                    <Text color={tokens.color.info.fg}>{key.padEnd(12)}</Text>
                    <Text color={tokens.color.fg.fg}>{t(descKey)}</Text>
                  </Box>
                ))}
              </Box>
            ))}
          </Box>

          {/* Right column */}
          <Box flexDirection="column" width={27}>
            {rightCols.map((cat) => (
              <Box key={cat.categoryKey} flexDirection="column" marginBottom={1}>
                <Text color={tokens.color.accent.fg} bold>
                  {t(cat.categoryKey)}
                </Text>
                <Text color={tokens.color.muted.fg}>{'─'.repeat(14)}</Text>
                {cat.items.map(([key, descKey]) => (
                  <Box key={key} flexDirection="row">
                    <Text color={tokens.color.info.fg}>{key.padEnd(12)}</Text>
                    <Text color={tokens.color.fg.fg}>{t(descKey)}</Text>
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        </Box>

        {/* Footer */}
        <Box justifyContent="center" marginTop={1}>
          <Text color={tokens.color.muted.fg}>
            {t('help-overlay.footer')}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
