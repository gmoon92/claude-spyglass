/**
 * Anomalies — recent anomaly events with badges.
 */

import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Card } from '../components/display/Card';
import { Badge } from '../components/display/Badge';
import { tokens } from '../design-tokens';
import { formatClock } from '../lib/format';
import { TIME_RANGES } from '../lib/time-range';
import type { TimeRange } from '../lib/time-range';
import type { Anomaly } from '../types';

export type AnomaliesProps = {
  apiUrl: string;
  timeRange?: TimeRange;
};

export function Anomalies({ apiUrl, timeRange = '1h' }: AnomaliesProps): JSX.Element {
  const [items, setItems] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/metrics/anomalies-timeseries?range=${timeRange}`);
        const json = (await res.json()) as {
          success: boolean;
          data?: { events?: Anomaly[]; recent?: Anomaly[] };
        };
        if (cancelled) return;
        const list = json.data?.events ?? json.data?.recent ?? [];
        setItems(Array.isArray(list) ? list : []);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [apiUrl, timeRange]);

  const rangeSelector = (
    <Box flexDirection="row" gap={1}>
      {TIME_RANGES.map((r) => (
        <Text key={r} color={r === timeRange ? tokens.color.primary.fg : tokens.color.muted.fg} bold={r === timeRange}>
          {r === timeRange ? `[${r}]` : r}
        </Text>
      ))}
      <Text color={tokens.color.muted.fg}> [t]</Text>
    </Box>
  );

  return (
    <Card
      title={
        <Box flexDirection="row" gap={1}>
          <Text color={tokens.color.primary.fg} bold>
            Anomalies · {items.length}
          </Text>
          {rangeSelector}
        </Box>
      }
      focused
    >
      {loading && <Text dimColor>loading…</Text>}
      {error && <Text color={tokens.color.danger.fg}>error: {error}</Text>}
      {!loading && !error && items.length === 0 && (
        <Text color={tokens.color.muted.fg}>( )( )  No anomalies in window</Text>
      )}
      {items.slice(0, 12).map((a) => {
        const tone = a.level === 'P0' ? 'danger' : a.level === 'P1' ? 'warning' : 'muted';
        return (
          <Box key={a.id} flexDirection="row">
            <Box marginRight={1}>
              <Badge tone={tone} label={a.level} />
            </Box>
            <Text color={tokens.color.muted.fg}>{formatClock(a.timestamp)} </Text>
            <Text>{a.kind} </Text>
            <Text color={tokens.color.info.fg}>S-{a.session_id.slice(0, 6)} </Text>
            <Text>{a.tool_name ?? ''} </Text>
            {a.detail && <Text dimColor>{a.detail}</Text>}
          </Box>
        );
      })}
    </Card>
  );
}
