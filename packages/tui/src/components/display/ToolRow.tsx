/**
 * ToolRow — single row in Live Feed / Detail.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/components.md §Display.ToolRow
 *
 * Critical rule: same `tool_use_id` updates in place. Never duplicate pre/post.
 *
 * ── 정렬 전략 (tui-glyph-ascii ADR-001) ───────────────────────────────────
 * 모든 글리프(icon, stripe, prefix)가 ASCII printable 1자로 통일되었다.
 *   → ASCII는 어떤 터미널·폰트·로케일에서도 visual width = 1 보장.
 *   → 따라서 byte length = visual column 이 성립하고, 별도의 wide/narrow
 *     판정·보정 로직이 불필요하다.
 *
 * 이전 ADR(tui-feed-alignment ADR-001)에서 사용한 isNarrowGlyph / Braille
 * 정규식 / iconPad 분기 / wide prefix(`'└─  '`) 보정 로직은 모두 제거되었다.
 *
 * 컬럼 폭 (모두 byte = visual = padded length 일치):
 *   prefix 4 / clock 8 + 1sp / icon 1 + 1sp / tool 14 + 1sp /
 *   target dyn / tokens 8 + 1sp / [lowConf 1] / dur 7 + 1sp /
 *   session 8 (showSession=true 시)
 */

import { memo } from 'react';
import { Text } from 'ink';
import { Spinner } from '../feedback/Spinner';
import { RowAccent } from '../feedback/RowAccent';
import { toolIconForRecord } from '../../lib/tool-icon';
import { tokens } from '../../design-tokens';
import {
  formatClock,
  formatDuration,
  formatTokens,
  compressToolName,
  truncate,
  shortSession,
  sanitizeOneLine,
} from '../../lib/format';
import type { Request } from '../../types';

export type ToolRowProps = {
  record: Request;
  highlightSince?: number;
  showSession?: boolean;
  width?: number;
};

export const ToolRow = memo(function ToolRow({
  record,
  highlightSince,
  showSession = true,
  width = 120,
}: ToolRowProps): JSX.Element {
  const isPre = record.event_type === 'pre_tool';
  // data-honesty-ui (ADR-005): parent_tool_use_id 있으면 1단계 자식 도구
  const isChild = !!record.parent_tool_use_id;
  // data-honesty-ui (ADR-002): tokens_confidence !== 'high' 면 표지
  const isLowConf = record.tokens_confidence != null && record.tokens_confidence !== 'high';

  // ── 컬럼 폭 정의 (모두 ASCII 1자 = visual 1 가정, tui-glyph-ascii ADR-001) ────
  const W = {
    prefix: 4,   // '+-  ' (자식) | '    ' (루트)
    clock: 8,    // 'HH:MM:SS'
    icon: 1,     // ASCII 1자 (이전 wide-glyph 보정 위해 3이었음)
    tool: 14,
    tokens: 8,
    dur: 7,
    session: 8,
  } as const;

  // 셀 사이 narrow space 1칸:
  //   prefix 직후 → space 없음 (prefix 자체에 trailing space 포함)
  //   clock, icon, tool, tokens, [lowConf], dur 다음 각각 space 1칸
  const FIXED_PARTS =
    W.prefix +
    W.clock + 1 +
    W.icon + 1 +
    W.tool + 1 +
    W.tokens + 1 +
    (isLowConf ? 1 : 0) +
    W.dur + 1 +
    (showSession ? W.session : 0);

  // ── 셀 콘텐츠 정규화 + 폭 강제 ─────────────────────────────────────
  // tool: compressToolName이 budget 이하 보장하지만, 안전장치로 다시 14에 맞춤.
  const toolLabel = compressToolName(record.tool_name, W.tool).slice(0, W.tool).padEnd(W.tool, ' ');

  // target: 멀티라인 입력을 단일라인화한 뒤 동적 폭에 맞춰 truncate + padEnd.
  const targetWidth = Math.max(20, width - FIXED_PARTS);
  const targetText = sanitizeOneLine(describeTarget(record));
  const targetTrimmed = truncate(targetText, targetWidth).padEnd(targetWidth, ' ');

  // tokens / dur / session — 우측 정렬은 padStart, session은 padEnd로 끝선 정렬.
  const tokensRaw = isPre ? '...' : record.tokens_total ? `+${formatTokens(record.tokens_total)}` : '-';
  const tokensText = tokensRaw.padStart(W.tokens, ' ');
  const durRaw = isPre ? '...' : formatDuration(record.duration_ms);
  const durText = durRaw.padStart(W.dur, ' ');
  const sessionText = showSession ? shortSession(record.session_id).padEnd(W.session, ' ') : '';

  // prefix: ASCII 4자 통일. isChild 표지는 색상(muted+dim)으로 추가 강조.
  //   '+-  ' (child) — 4 ASCII chars
  //   '    ' (root)  — 4 ASCII spaces
  const prefixStr = isChild ? '+-  ' : '    ';

  const baseColor = isPre || isLowConf ? tokens.color.muted.fg : tokens.color.fg.fg;
  const dim = isPre || isLowConf;

  // ── 단일 Text로 모든 셀을 출력 ─────────────────────────────────────
  // wrap="truncate-end": 부모 폭을 넘으면 라인 끝을 잘라 행 높이를 1로 고정.
  // 모든 글리프가 ASCII이므로 별도 visual-width 보정 padding 불필요.
  const iconRes = toolIconForRecord(record);

  const inner = (
    <Text wrap="truncate-end">
      <Text color={isChild ? tokens.color.muted.fg : undefined} dimColor={isChild}>{prefixStr}</Text>
      <Text color={tokens.color.muted.fg}>{formatClock(record.timestamp)} </Text>
      {iconRes.spinning ? (
        <Spinner variant="tool" color={iconRes.color} />
      ) : (
        <Text color={iconRes.color}>{iconRes.glyph}</Text>
      )}
      <Text> </Text>
      <Text color={baseColor} dimColor={dim}>{toolLabel} </Text>
      <Text color={baseColor} dimColor={dim}>{targetTrimmed}</Text>
      <Text color={isPre ? tokens.color.muted.fg : tokens.color.success.fg}>{tokensText} </Text>
      {isLowConf && <Text color={tokens.color.muted.fg} dimColor>*</Text>}
      <Text color={tokens.color.muted.fg}>{durText} </Text>
      {showSession && <Text color={tokens.color.info.fg} dimColor>{sessionText}</Text>}
    </Text>
  );

  return <RowAccent since={highlightSince}>{inner}</RowAccent>;
}, (a, b) =>
  a.record.id === b.record.id &&
  a.record.event_type === b.record.event_type &&
  a.record.parent_tool_use_id === b.record.parent_tool_use_id &&
  a.record.tokens_confidence === b.record.tokens_confidence &&
  a.record.tokens_total === b.record.tokens_total &&
  a.record.duration_ms === b.record.duration_ms &&
  a.record.status === b.record.status &&
  a.highlightSince === b.highlightSince &&
  a.width === b.width,
);

/**
 * 책임 — record에서 target 셀에 표시할 raw 문자열을 추출한다.
 *   결과는 호출 측(`ToolRow`)에서 `sanitizeOneLine`으로 한 번 더 정규화하여 단일라인 보장.
 *   여기서도 `\n` 포함 입력의 길이 판정이 의미 없으므로 정규화 후 길이 판정.
 */
function describeTarget(r: Request): string {
  if (r.tool_detail) {
    const td = sanitizeOneLine(r.tool_detail);
    if (td.length < 60) return td;
    return td.slice(0, 60) + '...';
  }
  if (r.payload) {
    const pl = sanitizeOneLine(r.payload);
    if (pl.length < 60) return pl;
    return pl.slice(0, 60) + '...';
  }
  return '';
}
