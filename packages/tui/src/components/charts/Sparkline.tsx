/**
 * Sparkline — 8-step block sparkline.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/charts.md §2
 *
 * Enhanced: gradient option renders each bar char individually with interpolated color.
 * API is backward-compatible — existing callers pass color/threshold as before.
 */

import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';
import { sparkline } from '../../lib/format';
import { pickGradientColor } from '../../lib/gradient';

const BARS: string[] = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

export type SparklineProps = {
  data: readonly number[];
  width?: number;
  /** Solid color for all bars (backward compat). */
  color?: string;
  threshold?: number;
  /**
   * Gradient stops (hex). When provided, each bar is colored individually
   * from stops[0] (lowest bar) → stops[last] (highest bar).
   * `color` takes precedence if both are given.
   */
  gradientStops?: readonly string[];
};

export function Sparkline({ data, width, color, threshold, gradientStops }: SparklineProps): JSX.Element {
  const w = width ?? 8;

  // Gradient mode: render char-by-char.
  if (!color && gradientStops && gradientStops.length >= 2) {
    const slice = data.slice(-w);
    const peak = Math.max(...slice, 1);
    const chars = slice.map((v) => {
      const ratio = Math.max(0, Math.min(1, v / peak));
      const idx = Math.min(BARS.length - 1, Math.floor(ratio * BARS.length));
      const bar = BARS[idx] ?? '▁';
      const col = pickGradientColor(gradientStops, ratio);
      return { bar, col };
    });
    // Pad left if short.
    while (chars.length < w) chars.unshift({ bar: ' ', col: gradientStops[0] ?? '#565f89' });
    return (
      <Box flexDirection="row">
        {chars.map((c, i) => (
          <Text key={i} color={c.col}>{c.bar}</Text>
        ))}
      </Box>
    );
  }

  // Solid-color mode (original behavior).
  const text = sparkline(data, w);
  const peak = Math.max(...data, 0);
  const ratio = threshold != null && threshold > 0 ? peak / threshold : 0;
  const inferred =
    ratio > 1.5 ? tokens.color.danger.fg : ratio > 1.0 ? tokens.color.warning.fg : tokens.color.primary.fg;
  return <Text color={color ?? inferred}>{text || ' '.repeat(w)}</Text>;
}
