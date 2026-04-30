/**
 * ResponsiveShell — splits Sidebar+Main with breakpoint fallback.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Box, useStdout } from 'ink';
import { tokens } from '../../design-tokens';

export type ResponsiveShellProps = {
  sidebar: ReactNode;
  main: ReactNode;
  showSidebar?: boolean;
};

export function ResponsiveShell({ sidebar, main, showSidebar = true }: ResponsiveShellProps): JSX.Element {
  const cols = useTermCols();
  const includeSidebar = showSidebar && cols >= tokens.layout.breakpoint.md;

  return (
    <Box flexDirection="row" flexGrow={1}>
      {includeSidebar && <Box marginRight={1}>{sidebar}</Box>}
      <Box flexGrow={1}>{main}</Box>
    </Box>
  );
}

export function useTermCols(): number {
  const { stdout } = useStdout();
  const [cols, setCols] = useState<number>(stdout.columns ?? 100);
  useEffect(() => {
    const onResize = () => setCols(stdout.columns ?? 100);
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);
  return cols;
}

export function useTermRows(): number {
  const { stdout } = useStdout();
  const [rows, setRows] = useState<number>(stdout.rows ?? 30);
  useEffect(() => {
    const onResize = () => setRows(stdout.rows ?? 30);
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);
  return rows;
}
