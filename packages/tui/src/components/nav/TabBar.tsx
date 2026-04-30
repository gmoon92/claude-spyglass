/**
 * TabBar — view selector across the top of MainPanel.
 */

import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';
import type { ScreenId } from '../../types';

export type TabBarProps = {
  active: ScreenId;
};

const TABS: Array<{ id: ScreenId; key: string; label: string }> = [
  { id: 'live', key: '1', label: 'Live' },
  { id: 'sessions', key: '2', label: 'Sessions' },
  { id: 'tools', key: '3', label: 'Tools' },
  { id: 'anomalies', key: '4', label: 'Anomalies' },
];

export function TabBar({ active }: TabBarProps): JSX.Element {
  return (
    <Box flexDirection="row">
      {TABS.map((t, i) => {
        const isActive = active === t.id;
        return (
          <Box key={t.id} marginRight={2}>
            <Text color={tokens.color.muted.fg}>[{t.key}]</Text>
            <Text color={isActive ? tokens.color.primary.fg : tokens.color.muted.fg} bold={isActive}>
              {' '}{t.label}{isActive ? ' ◀' : ''}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
