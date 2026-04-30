/**
 * SessionDetail — HTTP fetch 기반 Turn 목록 화면.
 *
 * v2: useFeed() ring buffer → useSessionTurns() HTTP fetch 기반으로 교체.
 *     과거 turn 조회, prompt/endReason 정상 표시, running 상태 정확 반영.
 */

import { Box, Text } from 'ink';
import { Card } from '../components/display/Card';
import { TurnCard } from '../components/display/TurnCard';
import { Spinner } from '../components/feedback/Spinner';
import { tokens } from '../design-tokens';
import { useSessionTurns } from '../hooks/useSessionTurns';

export type SessionDetailProps = {
  sessionId: string;
  apiUrl: string;
};

export function SessionDetail({ sessionId, apiUrl }: SessionDetailProps): JSX.Element {
  const { turns, isLoading, error } = useSessionTurns(apiUrl, sessionId);

  const title = (
    <Text color={tokens.color.primary.fg} bold>
      Session · S-{sessionId.slice(0, 8)}
    </Text>
  );

  return (
    <Card title={title} focused>
      {error ? (
        <Box>
          <Text color={tokens.color.danger.fg}>Error: {error}</Text>
        </Box>
      ) : isLoading && turns.length === 0 ? (
        <Box gap={1}>
          <Spinner variant="net" />
          <Text dimColor>Loading turns…</Text>
        </Box>
      ) : turns.length === 0 ? (
        <Text dimColor>No turns yet.</Text>
      ) : (
        <Box flexDirection="column">
          {turns.map((t) => (
            <TurnCard key={t.id} turn={t} showTokenTree />
          ))}
        </Box>
      )}
    </Card>
  );
}
