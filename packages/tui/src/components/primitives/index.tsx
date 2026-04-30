/**
 * primitives — Box / Text / Spacer wrappers.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/components.md §Primitives
 */

import React from 'react';
import { Box as InkBox, Text as InkText } from 'ink';
import type { ComponentProps, ReactNode } from 'react';
import { tokens } from '../../design-tokens';

export const Box: typeof InkBox = InkBox;
export const Text: typeof InkText = InkText;

export type SpacerProps = { cols?: number; rows?: number };

/** Token-units only — no magic numbers. */
export function Spacer({ cols, rows }: SpacerProps): JSX.Element {
  if (rows != null) return <InkBox height={rows} />;
  return <InkBox width={cols ?? tokens.spacing.xs} />;
}

export type LabelProps = {
  children: ReactNode;
  color?: string;
};

/** ALL CAPS small-cap label (`type.label`). */
export function Label({ children, color }: LabelProps): JSX.Element {
  return (
    <InkText dimColor color={color ?? tokens.color.muted.fg}>
      {typeof children === 'string' ? children.toUpperCase() : children}
    </InkText>
  );
}

export type MetricProps = {
  value: string | number;
  unit?: string;
  color?: string;
};

/** L1 hero number — bold metric + dim unit. */
export function Metric({ value, unit, color }: MetricProps): JSX.Element {
  return (
    <InkText>
      <InkText bold color={color}>{value}</InkText>
      {unit != null && <InkText dimColor>{unit}</InkText>}
    </InkText>
  );
}

export type CodeProps = ComponentProps<typeof InkText>;

export function Code(props: CodeProps): JSX.Element {
  return <InkText {...props} />;
}
