/**
 * Tools — sorted bar chart of tool calls.
 */

import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Card } from '../components/display/Card';
import { BarChart } from '../components/charts/BarChart';
import { tokens } from '../design-tokens';
import { toolIconForRecord } from '../lib/tool-icon';
import { TIME_RANGES } from '../lib/time-range';
import type { TimeRange } from '../lib/time-range';
import type { ToolStat } from '../types';

export type ToolsProps = {
  apiUrl: string;
  timeRange?: TimeRange;
};

export function Tools({ apiUrl, timeRange = '1h' }: ToolsProps): JSX.Element {
  const [stats, setStats] = useState<ToolStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/stats/tools?range=${timeRange}`);
        const json = (await res.json()) as { success: boolean; data: ToolStat[] };
        if (cancelled) return;
        setStats(json.data ?? []);
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
            Tools · {stats.length}
          </Text>
          {rangeSelector}
        </Box>
      }
      focused
    >
      {loading && <Text dimColor>loading…</Text>}
      {error && <Text color={tokens.color.danger.fg}>error: {error}</Text>}
      {!loading && !error && stats.length === 0 && (
        <Text color={tokens.color.muted.fg}>( )( )  No tool calls yet</Text>
      )}
      {!loading && !error && stats.length > 0 && (
        <BarChart
          series={stats.slice(0, 12).map((t) => ({
            label: t.tool_name,
            value: t.calls,
            prefix: toolIconForRecord({ tool_name: t.tool_name }).glyph,
            color: toolIconForRecord({ tool_name: t.tool_name }).color,
          }))}
          width={36}
          labelWidth={16}
        />
      )}
    </Card>
  );
}
