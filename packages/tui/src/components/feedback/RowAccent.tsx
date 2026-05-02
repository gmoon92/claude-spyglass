/**
 * RowAccent — 1-col left stripe '|' that fades from primary → muted → invisible in 1.2s.
 *
 * Replaces Highlight.tsx.  Identical external API (since/children) but uses
 * the 1.2s decay from spec §2.3 instead of the old 880ms (80+300+500).
 *
 * States:
 *   enter  (0–80ms)    : primary '|'
 *   hold   (80–500ms)  : info '|'
 *   decay  (500–1200ms): muted '|'
 *   baseline (>1200ms) : invisible ' '
 *
 * Stripe glyph는 tui-glyph-ascii ADR-001에 따라 ASCII narrow 1자(`tokens.icon.stripe`)로 통일.
 * 이전 '▎'(active fade), '▌'(selected solid)는 East Asian Ambiguous로 환경별 visual
 * width가 1~2칸 변동되어 fade-in 행과 baseline 행 사이 컬럼 정렬이 깨졌다.
 *
 * @see spec.md §2.3
 * @see ${CLAUDE_PROJECT_DIR}/.claude/docs/plans/tui-glyph-ascii/adr.md ADR-001
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Box, Text } from 'ink';
import { tokens } from '../../design-tokens';

export type RowAccentProps = {
  /** Timestamp (ms) when this row arrived. Re-triggers on change. */
  since?: number;
  /** Whether this row is currently selected (shows solid stripe in primary). */
  selected?: boolean;
  children: ReactNode;
};

const ENTER_MS  = 80;
const HOLD_MS   = 420;   // enter+hold = 500ms total
const DECAY_MS  = 700;   // decay end = 1200ms total

export function RowAccent({ since, selected, children }: RowAccentProps): JSX.Element {
  const [tone, setTone] = useState<'enter' | 'hold' | 'decay' | 'baseline'>(
    since == null ? 'baseline' : 'enter',
  );

  useEffect(() => {
    if (since == null) return;
    setTone('enter');
    const t1 = setTimeout(() => setTone('hold'),     ENTER_MS);
    const t2 = setTimeout(() => setTone('decay'),    ENTER_MS + HOLD_MS);
    const t3 = setTimeout(() => setTone('baseline'), ENTER_MS + HOLD_MS + DECAY_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [since]);

  // Selected row always shows solid stripe in primary, overriding fade.
  // ASCII '|' (tokens.icon.stripe) — visual width 1 보장.
  if (selected) {
    return (
      <Box flexDirection="row">
        <Text color={tokens.color.primary.fg} bold>{tokens.icon.stripe}</Text>
        <Box flexGrow={1}>{children}</Box>
      </Box>
    );
  }

  const stripeColor =
    tone === 'enter'
      ? tokens.color.primary.fg
      : tone === 'hold'
      ? tokens.color.info.fg
      : tone === 'decay'
      ? tokens.color.muted.fg
      : undefined;

  // baseline 시 ' '(narrow space)로 유지 — stripe(visual 1) 자리와 정확히 동일 폭.
  return (
    <Box flexDirection="row">
      <Text color={stripeColor}>{stripeColor ? tokens.icon.stripe : ' '}</Text>
      <Box flexGrow={1}>{children}</Box>
    </Box>
  );
}
