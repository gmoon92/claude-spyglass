/**
 * MainPanel — focused content area for the active screen.
 */

import { type ReactNode } from 'react';
import { Box } from 'ink';
import { Card } from '../display/Card';

export type MainPanelProps = {
  title?: ReactNode;
  focused?: boolean;
  children: ReactNode;
};

export function MainPanel({ title, focused = true, children }: MainPanelProps): JSX.Element {
  return (
    <Box flexGrow={1} flexDirection="column">
      <Card title={title} focused={focused} flexGrow={1}>
        {children}
      </Card>
    </Box>
  );
}
