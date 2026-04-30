/**
 * Tools — 5-tab analytics dashboard.
 *
 * Sub-tabs:
 *   overview  — bar chart of top tools by call count
 *   tokens    — avg / total tokens per tool
 *   cache     — hit rate gauge + cache token breakdown + savings
 *   types     — tool_call vs prompt stacked breakdown
 *   perf      — avg duration / max duration / error rate per tool
 *
 * Keyboard: Tab = next sub-tab, Shift+Tab = previous sub-tab.
 */

import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Card } from '../components/display/Card';
import { BarChart } from '../components/charts/BarChart';
import { Gauge } from '../components/charts/Gauge';
import { TokenTree } from '../components/display/TokenTree';
import { tokens } from '../design-tokens';
import { toolIconForRecord } from '../lib/tool-icon';
import { formatTokens, formatDuration, bar } from '../lib/format';
import { TIME_RANGES } from '../lib/time-range';
import { useToolsAnalytics } from '../hooks/useToolsAnalytics';
import type { TimeRange } from '../lib/time-range';
import type { ToolStat } from '../types';
import type { ByTypeRow, CacheStats } from '../hooks/useToolsAnalytics';

export type ToolsProps = {
  apiUrl: string;
  timeRange?: TimeRange;
};

type SubTab = 'overview' | 'tokens' | 'cache' | 'types' | 'perf';

const SUB_TABS: Array<{ id: SubTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'cache', label: 'Cache' },
  { id: 'types', label: 'Types' },
  { id: 'perf', label: 'Perf' },
];

// ─── Sub-tab views ────────────────────────────────────────────────────────────

function OverviewView({ tools }: { tools: ToolStat[] }): JSX.Element {
  if (tools.length === 0) {
    return <Text color={tokens.color.muted.fg}>( )( )  No tool calls yet</Text>;
  }
  const top = tools.slice(0, 10);
  return (
    <BarChart
      series={top.map((t) => ({
        label: t.tool_name,
        value: t.calls,
        prefix: toolIconForRecord({ tool_name: t.tool_name }).glyph,
        color: toolIconForRecord({ tool_name: t.tool_name }).color,
      }))}
      width={36}
      labelWidth={16}
    />
  );
}

function TokensView({ tools }: { tools: ToolStat[] }): JSX.Element {
  if (tools.length === 0) {
    return <Text color={tokens.color.muted.fg}>No data</Text>;
  }
  // Sort by avg_tokens desc for the main chart; also show total_tokens column.
  const sorted = [...tools]
    .filter((t) => (t.avg_tokens ?? 0) > 0)
    .sort((a, b) => (b.avg_tokens ?? 0) - (a.avg_tokens ?? 0))
    .slice(0, 10);

  if (sorted.length === 0) {
    return <Text color={tokens.color.muted.fg}>No token data recorded</Text>;
  }

  const peakAvg = Math.max(...sorted.map((t) => t.avg_tokens ?? 0), 1);

  return (
    <Box flexDirection="column" gap={0}>
      <Box flexDirection="row" marginBottom={1}>
        <Text color={tokens.color.muted.fg} dimColor>{'tool'.padEnd(16)}</Text>
        <Text color={tokens.color.muted.fg} dimColor>{'avg_tok'.padEnd(28)}</Text>
        <Text color={tokens.color.muted.fg} dimColor>avg</Text>
      </Box>
      {sorted.map((t) => {
        const ratio = (t.avg_tokens ?? 0) / peakAvg;
        const icon = toolIconForRecord({ tool_name: t.tool_name });
        return (
          <Box key={t.tool_name} flexDirection="row">
            <Text color={icon.color}>{icon.glyph} </Text>
            <Text color={tokens.color.fg.fg}>{(t.tool_name ?? '').padEnd(15).slice(0, 15)}</Text>
            <Text color={tokens.color.info.fg}>{bar(ratio, 24)}</Text>
            <Text color={tokens.color.muted.fg}> {formatTokens(t.avg_tokens)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function CacheView({ cache }: { cache: CacheStats | null }): JSX.Element {
  if (!cache) {
    return <Text color={tokens.color.muted.fg}>No cache data available</Text>;
  }

  const hitPct = Math.round(cache.hitRate * 100);
  const savePct = Math.round(cache.savingsRate * 100);

  return (
    <Box flexDirection="column" gap={1}>
      {/* Hit rate gauge */}
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Text color={tokens.color.fg.fg}>Cache Hit Rate</Text>
          <Text color={tokens.color.success.fg} bold>{hitPct}%</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Gauge value={cache.hitRate} max={1} width={32} thresholds={{ warn: 0.5, danger: 0.9 }} />
        </Box>
      </Box>

      {/* Token breakdown */}
      <TokenTree
        cacheRead={cache.cacheReadTokens}
        cacheCreate={cache.cacheCreationTokens}
        total={cache.cacheReadTokens + cache.cacheCreationTokens}
      />

      {/* Savings */}
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Text color={tokens.color.muted.fg} dimColor>savings rate</Text>
          <Text color={tokens.color.success.fg} bold>{savePct}%</Text>
        </Box>
        <Box flexDirection="row" gap={2}>
          <Text color={tokens.color.muted.fg} dimColor>saved USD</Text>
          <Text color={tokens.color.success.fg}>${cache.savingsUsd.toFixed(2)}</Text>
        </Box>
        <Box flexDirection="row" gap={2}>
          <Text color={tokens.color.muted.fg} dimColor>cost w/ cache</Text>
          <Text color={tokens.color.warning.fg}>${cache.costWithCache.toFixed(2)}</Text>
        </Box>
        <Box flexDirection="row" gap={2}>
          <Text color={tokens.color.muted.fg} dimColor>cost w/o cache</Text>
          <Text color={tokens.color.muted.fg}>${cache.costWithoutCache.toFixed(2)}</Text>
        </Box>
      </Box>
    </Box>
  );
}

function TypesView({ byType }: { byType: ByTypeRow[] }): JSX.Element {
  if (byType.length === 0) {
    return <Text color={tokens.color.muted.fg}>No data</Text>;
  }

  const totalCount = byType.reduce((a, r) => a + r.count, 0) || 1;
  const maxCount = Math.max(...byType.map((r) => r.count), 1);

  const TYPE_COLORS: Record<string, string> = {
    tool_call: tokens.color.primary.fg,
    prompt: tokens.color.accent.fg,
    system: tokens.color.info.fg,
  };

  return (
    <Box flexDirection="column" gap={1}>
      {/* Count bars */}
      <Box flexDirection="column">
        <Text color={tokens.color.muted.fg} dimColor>call count by type</Text>
        {byType.map((r) => {
          const ratio = r.count / maxCount;
          const color = TYPE_COLORS[r.type] ?? tokens.color.muted.fg;
          const pct = Math.round((r.count / totalCount) * 100);
          return (
            <Box key={r.type} flexDirection="row">
              <Text color={tokens.color.fg.fg}>{r.type.padEnd(12).slice(0, 12)}</Text>
              <Text color={color}>{bar(ratio, 20)}</Text>
              <Text color={tokens.color.muted.fg}> {r.count} ({pct}%)</Text>
            </Box>
          );
        })}
      </Box>

      {/* Token totals */}
      <Box flexDirection="column">
        <Text color={tokens.color.muted.fg} dimColor>tokens by type</Text>
        <Box flexDirection="row" marginBottom={1}>
          <Text color={tokens.color.muted.fg} dimColor>{'type'.padEnd(12)}</Text>
          <Text color={tokens.color.muted.fg} dimColor>{'total_tok'.padEnd(12)}</Text>
          <Text color={tokens.color.muted.fg} dimColor>avg_tok</Text>
        </Box>
        {byType.map((r) => {
          const color = TYPE_COLORS[r.type] ?? tokens.color.muted.fg;
          return (
            <Box key={r.type} flexDirection="row">
              <Text color={color}>{r.type.padEnd(12).slice(0, 12)}</Text>
              <Text color={tokens.color.warning.fg}>{formatTokens(r.total_tokens).padEnd(12)}</Text>
              <Text color={tokens.color.info.fg}>{formatTokens(r.avg_tokens)}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function PerfView({ tools }: { tools: ToolStat[] }): JSX.Element {
  if (tools.length === 0) {
    return <Text color={tokens.color.muted.fg}>No data</Text>;
  }

  // Sort by avg_duration desc (prefer actual data, fallback to p95)
  const sorted = [...tools]
    .sort((a, b) => (b.p95_duration_ms ?? 0) - (a.p95_duration_ms ?? 0))
    .slice(0, 10);

  const maxDur = Math.max(...sorted.map((t) => t.p95_duration_ms ?? 0), 1);

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" marginBottom={1}>
        <Text color={tokens.color.muted.fg} dimColor>{'tool'.padEnd(16)}</Text>
        <Text color={tokens.color.muted.fg} dimColor>{'p95_dur'.padEnd(10)}</Text>
        <Text color={tokens.color.muted.fg} dimColor>{'err%'.padEnd(8)}</Text>
        <Text color={tokens.color.muted.fg} dimColor>calls</Text>
      </Box>
      {sorted.map((t) => {
        const dur = t.p95_duration_ms ?? 0;
        const errRate = t.error_rate ?? 0;
        const durRatio = dur / maxDur;
        const durColor =
          durRatio > 0.8
            ? tokens.color.danger.fg
            : durRatio > 0.5
            ? tokens.color.warning.fg
            : tokens.color.success.fg;
        const errColor =
          errRate > 0.1
            ? tokens.color.danger.fg
            : errRate > 0.02
            ? tokens.color.warning.fg
            : tokens.color.muted.fg;
        const icon = toolIconForRecord({ tool_name: t.tool_name });
        return (
          <Box key={t.tool_name} flexDirection="row">
            <Text color={icon.color}>{icon.glyph} </Text>
            <Text color={tokens.color.fg.fg}>{(t.tool_name ?? '').padEnd(14).slice(0, 14)}</Text>
            <Text color={durColor}>{formatDuration(dur).padEnd(10)}</Text>
            <Text color={errColor}>{(errRate * 100).toFixed(1).padEnd(8)}%</Text>
            <Text color={tokens.color.muted.fg}>{t.calls}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ─── SubTabBar ────────────────────────────────────────────────────────────────

function SubTabBar({ active, timeRange }: { active: SubTab; timeRange: TimeRange }): JSX.Element {
  return (
    <Box flexDirection="row" gap={1} marginBottom={1}>
      {SUB_TABS.map((st) => {
        const isActive = active === st.id;
        return (
          <Text
            key={st.id}
            color={isActive ? tokens.color.primary.fg : tokens.color.muted.fg}
            bold={isActive}
          >
            {isActive ? `[${st.label}]` : st.label}
          </Text>
        );
      })}
      <Text color={tokens.color.muted.fg}>  [Tab] cycle ·</Text>
      <Text color={tokens.color.warning.fg} bold>{timeRange}</Text>
      <Text color={tokens.color.muted.fg}>[t]</Text>
    </Box>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function Tools({ apiUrl, timeRange = '1h' }: ToolsProps): JSX.Element {
  const [tab, setTab] = useState<SubTab>('overview');
  const { tools, byType, cache, isLoading, error } = useToolsAnalytics(apiUrl, timeRange);

  const tabIndex = SUB_TABS.findIndex((st) => st.id === tab);

  useInput((_input, key) => {
    if (key.tab) {
      if (key.shift) {
        const prev = (tabIndex - 1 + SUB_TABS.length) % SUB_TABS.length;
        setTab(SUB_TABS[prev]!.id);
      } else {
        const next = (tabIndex + 1) % SUB_TABS.length;
        setTab(SUB_TABS[next]!.id);
      }
    }
  });

  const rangeSelector = (
    <Box flexDirection="row" gap={1}>
      {TIME_RANGES.map((r) => (
        <Text key={r} color={r === timeRange ? tokens.color.primary.fg : tokens.color.muted.fg} bold={r === timeRange}>
          {r === timeRange ? `[${r}]` : r}
        </Text>
      ))}
    </Box>
  );

  return (
    <Card
      title={
        <Box flexDirection="row" gap={1}>
          <Text color={tokens.color.primary.fg} bold>
            Tools · {tools.length}
          </Text>
          {rangeSelector}
        </Box>
      }
      focused
    >
      <SubTabBar active={tab} timeRange={timeRange} />

      {isLoading && <Text dimColor>loading…</Text>}
      {error && <Text color={tokens.color.danger.fg}>error: {error}</Text>}

      {!isLoading && !error && (
        <>
          {tab === 'overview' && <OverviewView tools={tools} />}
          {tab === 'tokens' && <TokensView tools={tools} />}
          {tab === 'cache' && <CacheView cache={cache} />}
          {tab === 'types' && <TypesView byType={byType} />}
          {tab === 'perf' && <PerfView tools={tools} />}
        </>
      )}
    </Card>
  );
}
