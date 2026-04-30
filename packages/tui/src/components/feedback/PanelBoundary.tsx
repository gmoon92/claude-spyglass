/**
 * PanelBoundary — 패널 단위 ErrorBoundary.
 * 에러 발생 시 패널을 격리하고 .spyglass-errors.log에 기록.
 */

import { Component, type ReactNode, type ErrorInfo } from 'react';
import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';

type Props = { name: string; children: ReactNode };
type State = { error: Error | null };

export class PanelBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // TUI에서는 console.log 사용 불가 → 파일에 기록
    try {
      import('node:fs').then((fs) => {
        fs.appendFileSync(
          '.spyglass-errors.log',
          `${new Date().toISOString()} [${this.props.name}] ${error.stack ?? error.message}\n${info.componentStack ?? ''}\n`,
        );
      });
    } catch {
      // 로깅 실패는 무시
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <Box
          borderStyle="round"
          borderColor={tokens.color.danger.fg}
          flexDirection="column"
          paddingX={1}
        >
          <Text color={tokens.color.danger.fg} bold>
            {tokens.icon.state.warn} Panel error: {this.props.name}
          </Text>
          <Text dimColor>{this.state.error.message}</Text>
          <Text dimColor>(see .spyglass-errors.log)</Text>
        </Box>
      );
    }
    return this.props.children;
  }
}
