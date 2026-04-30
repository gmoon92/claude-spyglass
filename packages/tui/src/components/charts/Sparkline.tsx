/**
 * Sparkline — 8-step block sparkline.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/charts.md §2
 */

import { Text } from 'ink';
import { tokens } from '../../design-tokens';
import { sparkline } from '../../lib/format';

export type SparklineProps = {
  data: readonly number[];
  width?: number;
  color?: string;
  threshold?: number;
};

export function Sparkline({ data, width, color, threshold }: SparklineProps): JSX.Element {
  const text = sparkline(data, width);
  const peak = Math.max(...data, 0);
  const ratio = threshold != null && threshold > 0 ? peak / threshold : 0;
  const inferred =
    ratio > 1.5 ? tokens.color.danger.fg : ratio > 1.0 ? tokens.color.warning.fg : tokens.color.primary.fg;
  return <Text color={color ?? inferred}>{text || ' '.repeat(width ?? 8)}</Text>;
}
