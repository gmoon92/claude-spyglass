/**
 * SessionDetail — Turn cards for the focused session.
 *
 * v1: minimal — shows recent tool rows grouped by turn_id.
 */

import { Box, Text } from 'ink';
import { Card } from '../components/display/Card';
import { TurnCard, type Turn } from '../components/display/TurnCard';
import { tokens } from '../design-tokens';
import { useFeed } from '../hooks/useFeed';

export type SessionDetailProps = {
  sessionId: string;
};

export function SessionDetail({ sessionId }: SessionDetailProps): JSX.Element {
  const feed = useFeed();
  const rows = feed.filter((r) => r.session_id === sessionId);

  // Group by turn_id (fallback: lump into one).
  const byTurn = new Map<string, Turn>();
  for (const r of rows) {
    const turnId = r.turn_id ?? 'turn-?';
    let t = byTurn.get(turnId);
    if (!t) {
      t = {
        id: turnId,
        index: byTurn.size + 1,
        prompt: null,
        startedAt: r.timestamp,
        endedAt: r.timestamp,
        endReason: null,
        tools: [],
        totalTokens: 0,
        state: 'done',
      };
      byTurn.set(turnId, t);
    }
    t.tools.push(r);
    t.totalTokens += r.tokens_total ?? 0;
    if (r.timestamp < t.startedAt) t.startedAt = r.timestamp;
    if (r.timestamp > (t.endedAt ?? 0)) t.endedAt = r.timestamp;
    if (r.event_type === 'pre_tool') t.state = 'running';
    else if (r.status === 'error' && t.state !== 'running') t.state = 'error';
  }

  const turns = [...byTurn.values()];

  return (
    <Card
      title={
        <Text color={tokens.color.primary.fg} bold>
          Session · S-{sessionId.slice(0, 8)}
        </Text>
      }
      focused
    >
      {turns.length === 0 ? (
        <Text dimColor>No requests captured for this session yet.</Text>
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
