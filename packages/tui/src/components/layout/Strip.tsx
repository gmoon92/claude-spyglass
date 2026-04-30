/**
 * Strip — top Command Center: Pulse Wave (2 row) + 6 metric cells (1 row).
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/layouts.md §2
 */

import React from 'react';
import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';
import { PulseWave, derivePulseState } from '../signature/PulseWave';
import { Sparkline } from '../charts/Sparkline';
import { Gauge } from '../charts/Gauge';
import { formatTokens, formatDuration } from '../../lib/format';
import type { StripStats, Session } from '../../types';

export type StripProps = {
  pulseBuckets: readonly number[];
  lastEventAt: number | null;
  stats: StripStats | null;
  activeSessions: Session[];
  width: number;
  status: 'open' | 'connecting' | 'reconnecting' | 'closed';
};

export function Strip({ pulseBuckets, lastEventAt, stats, activeSessions, width, status }: StripProps): JSX.Element {
  const pulseState = derivePulseState(pulseBuckets, lastEventAt);

  const totalActive = activeSessions.length;
  const totalSessions = stats?.total_sessions ?? totalActive;
  const totalTokens = stats?.total_tokens ?? 0;
  const p95 = stats?.p95_duration_ms ?? 0;
  const errRate = stats?.error_rate ?? 0;
  const totalReq = stats?.total_requests ?? 0;
  const cacheHit = stats?.cache_hit_rate ?? 0;

  const pulseLabel =
    pulseState === 'spike' ? 'SPIKE' : pulseState === 'active' ? 'ACTIVE' : 'IDLE';
  const pulseColor =
    pulseState === 'spike'
      ? tokens.color.danger.fg
      : pulseState === 'active'
      ? tokens.color.info.fg
      : tokens.color.muted.fg;

  return (
    <Box
      borderStyle={tokens.border.subtle as never}
      borderColor={tokens.color.primary.fg}
      flexDirection="column"
      paddingX={1}
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Text color={tokens.color.primary.fg} bold>
          spyglass
        </Text>
        <Text color={pulseColor}>
          {pulseLabel === 'SPIKE' ? '◉' : pulseLabel === 'ACTIVE' ? '●' : '○'} {pulseLabel}
          <Text color={tokens.color.muted.fg}> · {status}</Text>
        </Text>
      </Box>

      <Box>
        <PulseWave buckets={pulseBuckets} state={pulseState} width={Math.max(20, width - 6)} />
      </Box>

      <Box flexDirection="row" justifyContent="space-between" marginTop={0}>
        <Cell
          label="SESSIONS"
          value={`${totalActive}`}
          unit={`/${totalSessions}`}
          tone="primary"
          extra={dotCounter(totalActive)}
        />
        <Cell
          label="TOKENS"
          value={formatTokens(totalTokens)}
          tone="success"
          extra={
            <Sparkline data={pulseBuckets.slice(-12)} width={12} color={tokens.color.success.fg} />
          }
        />
        <Cell
          label="P95"
          value={formatDuration(p95)}
          tone={p95 > 5000 ? 'danger' : p95 > 1500 ? 'warning' : 'success'}
        />
        <Cell
          label="ERR"
          value={`${(errRate * 100).toFixed(1)}%`}
          unit={` · ${Math.round(errRate * totalReq)}/${totalReq || 0}`}
          tone={errRate >= 0.03 ? 'danger' : errRate >= 0.01 ? 'warning' : 'success'}
        />
        <Cell
          label="CACHE"
          value={`${Math.round(cacheHit * 100)}%`}
          tone={cacheHit >= 0.8 ? 'success' : cacheHit >= 0.5 ? 'info' : 'warning'}
          extra={<Gauge value={cacheHit} max={1} width={8} />}
        />
        <Cell
          label="REQ/HR"
          value={`${totalReq}`}
          tone="info"
        />
      </Box>
    </Box>
  );
}

function Cell({
  label,
  value,
  unit,
  tone,
  extra,
}: {
  label: string;
  value: string;
  unit?: string;
  tone: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  extra?: React.ReactNode;
}): JSX.Element {
  const color =
    tone === 'primary'
      ? tokens.color.primary.fg
      : tone === 'success'
      ? tokens.color.success.fg
      : tone === 'warning'
      ? tokens.color.warning.fg
      : tone === 'danger'
      ? tokens.color.danger.fg
      : tokens.color.info.fg;
  return (
    <Box flexDirection="column" marginRight={2}>
      <Text dimColor>{label}</Text>
      <Box flexDirection="row">
        <Text bold color={color}>{value}</Text>
        {unit && <Text dimColor>{unit}</Text>}
      </Box>
      {extra && <Box>{extra}</Box>}
    </Box>
  );
}

function dotCounter(n: number): React.ReactNode {
  const dots = '●'.repeat(Math.min(n, 5)) + (n > 5 ? '+' : '');
  return <Text color={tokens.color.primary.fg}>{dots || '○'}</Text>;
}
