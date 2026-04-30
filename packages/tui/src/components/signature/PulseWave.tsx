/**
 * PulseWave — claude-spyglass signature visual.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/signature-pulse.md
 *
 * 4-row braille pixels with sliding-window log normalization.
 * Three states:
 *   - idle   : muted ⠁/⠂ baseline breathing (SSE ping-synced)
 *   - active : info  ⣶⣿ filled, leading-edge brightness
 *   - spike  : danger bold burst peak retained
 */

import { useEffect, useState, useMemo } from 'react';
import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';
import type { PulseState } from '../../types';

const IDLE_BREATH = ['⠁', '⠂', '⠃', '⠂'];
const PIXEL_LADDER = [' ', '⠁', '⡀', '⠐', '⡄', '⢠', '⣀', '⣄', '⣆', '⣶', '⣷', '⣿'];

export type PulseWaveProps = {
  buckets: readonly number[];
  state: PulseState;
  width?: number;
  miniMode?: boolean;
};

export function PulseWave({ buckets, state, width, miniMode = false }: PulseWaveProps): JSX.Element {
  const [tick, setTick] = useState(0);

  // Idle baseline breathing — synced loosely to 1.5s.
  useEffect(() => {
    if (state !== 'idle') return;
    const id = setInterval(() => setTick((t) => (t + 1) % IDLE_BREATH.length), 750);
    return () => clearInterval(id);
  }, [state]);

  const w = width ?? (miniMode ? 24 : 80);

  const rendered = useMemo(() => {
    if (state === 'idle') {
      // Repeat breathing baseline across the width with shifting phase.
      let s = '';
      for (let i = 0; i < w; i++) {
        s += IDLE_BREATH[(i + tick) % IDLE_BREATH.length];
      }
      return s;
    }

    // Normalize buckets: log + sliding max.
    const slice = buckets.slice(-w);
    if (slice.length === 0) return ' '.repeat(w);
    const logged = slice.map((b) => Math.log10((b ?? 0) + 1));
    const peak = Math.max(...logged, 0.1);
    const normalized = logged.map((v) => v / peak);

    let chars = '';
    for (let i = 0; i < w; i++) {
      const v = normalized[i] ?? 0;
      const idx = Math.max(0, Math.min(PIXEL_LADDER.length - 1, Math.floor(v * (PIXEL_LADDER.length - 1))));
      chars += PIXEL_LADDER[idx];
    }
    return chars;
  }, [buckets, state, tick, w]);

  const bodyColor =
    state === 'spike'
      ? tokens.color.danger.fg
      : state === 'active'
      ? tokens.color.info.fg
      : tokens.color.muted.fg;

  const tailGlyph = state === 'spike' ? '!' : state === 'active' ? '⣿' : '·';
  const tailColor =
    state === 'spike'
      ? tokens.color.danger.fg
      : state === 'active'
      ? tokens.color.primary.fg
      : tokens.color.muted.fg;

  return (
    <Box flexDirection="row">
      <Text color={bodyColor} bold={state === 'spike'}>
        {rendered}
      </Text>
      <Text color={tailColor} bold={state !== 'idle'}>
        {' '}{tailGlyph}
      </Text>
    </Box>
  );
}

/** Compute pulse state from recent activity. */
export function derivePulseState(buckets: readonly number[], lastEventAt: number | null): PulseState {
  const now = Date.now();
  const idleMs = lastEventAt == null ? Number.POSITIVE_INFINITY : now - lastEventAt;
  if (idleMs > 30_000) return 'idle';
  const last = buckets[buckets.length - 1] ?? 0;
  const recentAvg = buckets.slice(-12).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(12, buckets.length));
  if (last > recentAvg * 2.4 && last > 1000) return 'spike';
  return 'active';
}
