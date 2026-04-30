/**
 * Strip — KPI row: 3 × BigKpi + Sessions sidebar.
 *
 * Replaces the 6-cell flat layout with 3 large KPI boxes (REQ/MIN, P95, ERR%)
 * plus a Sessions summary panel on the right.
 *
 * @see spec.md §2.2
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/layouts.md §2
 */

import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';
import { BigKpi } from '../display/BigKpi';
import { derivePulseState } from '../signature/PulseWave';
import { formatDuration, shortSession } from '../../lib/format';
import type { StripStats, Session } from '../../types';

export type StripProps = {
  pulseBuckets: readonly number[];
  lastEventAt: number | null;
  stats: StripStats | null;
  activeSessions: Session[];
  width: number;
  status: 'open' | 'connecting' | 'reconnecting' | 'closed';
};

/** Compute signed delta percentage string. */
function deltaPct(current: number, baseline: number): { str: string; dir: 'up' | 'down' | 'flat' } {
  if (baseline === 0) return { str: '—', dir: 'flat' };
  const pct = ((current - baseline) / baseline) * 100;
  if (Math.abs(pct) < 1) return { str: '~0%', dir: 'flat' };
  const dir = pct > 0 ? 'up' : 'down';
  return { str: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`, dir };
}

export function Strip({ pulseBuckets, lastEventAt, stats, activeSessions, width }: StripProps): JSX.Element {
  const pulseState = derivePulseState(pulseBuckets, lastEventAt);

  const p95 = stats?.p95_duration_ms ?? 0;
  const errRate = stats?.error_rate ?? 0;
  const totalReq = stats?.total_requests ?? 0;

  // Approximate req/min from last 6 buckets (each bucket = 10s).
  const last6 = pulseBuckets.slice(-6);
  const reqMin = last6.reduce((a, b) => a + b, 0) / 1; // rough req in last minute

  // Delta approximation: compare last 6 vs prev 6 buckets.
  const prev6 = pulseBuckets.slice(-12, -6);
  const prev6Sum = prev6.reduce((a, b) => a + b, 0);
  const reqDelta = deltaPct(reqMin, prev6Sum);

  const kpiW = Math.max(14, Math.floor((width - 2) / 5));

  // Sessions sidebar.
  const sidebarW = Math.max(20, width - kpiW * 3 - 8);

  return (
    <Box flexDirection="row" paddingX={0}>
      <BigKpi
        label="REQ/MIN"
        value={reqMin > 0 ? reqMin.toFixed(0) : '—'}
        delta={reqDelta.str}
        deltaDir={reqDelta.dir}
        trend={pulseBuckets.slice(-12)}
        tone={pulseState === 'spike' ? 'danger' : pulseState === 'active' ? 'info' : 'primary'}
        width={kpiW}
      />
      <BigKpi
        label="P95 ms"
        value={p95 > 0 ? formatDuration(p95) : '—'}
        deltaDir="flat"
        tone={p95 > 5000 ? 'danger' : p95 > 1500 ? 'warning' : 'success'}
        trend={pulseBuckets.slice(-12)}
        width={kpiW}
      />
      <BigKpi
        label="ERR %"
        value={`${(errRate * 100).toFixed(1)}%`}
        deltaDir={errRate >= 0.03 ? 'up' : 'flat'}
        tone={errRate >= 0.03 ? 'danger' : errRate >= 0.01 ? 'warning' : 'success'}
        width={kpiW}
      />
      <SessionsSidebar sessions={activeSessions} totalReq={totalReq} width={sidebarW} />
    </Box>
  );
}

function SessionsSidebar({
  sessions,
  totalReq,
  width,
}: {
  sessions: Session[];
  totalReq: number;
  width: number;
}): JSX.Element {
  const maxRows = 4;
  const visible = sessions.slice(0, maxRows);
  const barMax = Math.max(...sessions.map((s) => s.request_count ?? 0), 1);

  return (
    <Box
      borderStyle={tokens.border.subtle as never}
      borderColor={tokens.color.muted.fg}
      flexDirection="column"
      paddingX={1}
      flexGrow={1}
      width={width}
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Text color={tokens.color.muted.fg} dimColor>Sessions</Text>
        <Text color={tokens.color.muted.fg} dimColor>{totalReq} req</Text>
      </Box>
      {visible.length === 0 && (
        <Text color={tokens.color.muted.fg} dimColor>no active sessions</Text>
      )}
      {visible.map((s, i) => {
        const req = s.request_count ?? 0;
        const barLen = Math.round((req / barMax) * 5);
        const bar = '█'.repeat(barLen) + '░'.repeat(5 - barLen);
        const sid = shortSession(s.id);
        const age = s.started_at ? Math.round((Date.now() - s.started_at) / 60000) : 0;
        return (
          <Box key={s.id} flexDirection="row">
            <Text color={i === 0 ? tokens.color.primary.fg : tokens.color.muted.fg}>
              {i === 0 ? '▸' : ' '}
            </Text>
            <Text color={tokens.color.info.fg}> {sid}</Text>
            <Text color={tokens.color.muted.fg} dimColor>  {age}m  {bar}  {req} req</Text>
          </Box>
        );
      })}
    </Box>
  );
}
