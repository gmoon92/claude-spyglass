/**
 * Tools — sorted bar chart of tool calls.
 */

import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Card } from '../components/display/Card';
import { BarChart } from '../components/charts/BarChart';
import { tokens } from '../design-tokens';
import { toolIconForRecord } from '../lib/tool-icon';
import type { ToolStat } from '../types';

export type ToolsProps = {
  apiUrl: string;
};

export function Tools({ apiUrl }: ToolsProps): JSX.Element {
  const [stats, setStats] = useState<ToolStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/stats/tools`);
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
  }, [apiUrl]);

  return (
    <Card
      title={
        <Text color={tokens.color.primary.fg} bold>
          Tools · {stats.length}
        </Text>
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
