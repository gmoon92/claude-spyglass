/**
 * StatusBar — single bottom row with contextual key hints.
 *
 * SSE 라벨(sse: connecting 등)을 제거하고 Ticker와 StalenessIndicator로 대체.
 * 정상 상태에서는 아무 텍스트도 노출되지 않음. 이상 시에만 ⚠ 표시.
 *
 * @see spec.md §2.5
 */

import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';
import { Ticker } from '../display/Ticker';
import { StalenessIndicator } from '../feedback/StalenessIndicator';

export type Hint = { key: string; label: string };

export type StatusBarProps = {
  hints: Hint[];
  sseStatus: string;
  eventsPerSec?: number;
  frozen?: boolean;
  lastEventAt?: number | null;
};

export function StatusBar({
  hints,
  sseStatus,
  eventsPerSec = 0,
  frozen = false,
  lastEventAt = null,
}: StatusBarProps): JSX.Element {
  return (
    <Box flexDirection="row" justifyContent="space-between">
      {/* Left: key hints */}
      <Box flexDirection="row">
        {hints.map((h, i) => (
          <Box key={i} marginRight={2}>
            <Text color={tokens.color.primary.fg}>[{h.key}]</Text>
            <Text color={tokens.color.muted.fg}> {h.label}</Text>
          </Box>
        ))}
      </Box>

      {/* Right: frozen badge + staleness + ticker + ev/s */}
      <Box flexDirection="row" gap={1}>
        {frozen && <Text color={tokens.color.warning.fg} bold>[FROZEN]</Text>}
        <StalenessIndicator sseStatus={sseStatus} lastEventAt={lastEventAt} />
        <Ticker lastEventAt={lastEventAt} />
        {eventsPerSec > 0 && (
          <Text color={tokens.color.muted.fg} dimColor>{eventsPerSec} ev/s</Text>
        )}
      </Box>
    </Box>
  );
}
