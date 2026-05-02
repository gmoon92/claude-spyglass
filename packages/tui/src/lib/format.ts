/**
 * format.ts — Token / duration / timestamp / sparkline formatters.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/information-hierarchy.md §3
 */

const SPARK_BLOCKS = '▁▂▃▄▅▆▇█';
const BAR_BLOCKS = ' ▏▎▍▌▋▊▉█';
const BRAILLE_PIXELS = [' ', '⠁', '⡀', '⠐', '⣿'];

/**
 * Format token count using the project standard.
 *   < 1000    → "847"
 *   ≥ 1000    → "1.2k"
 *   ≥ 10000   → "12k"
 *   ≥ 1M      → "1.2M"
 */
export function formatTokens(value?: number | null): string {
  if (value == null || value === 0) return '0';
  const v = Math.abs(value);
  if (v < 1000) return `${value}`;
  if (v < 10_000) return `${(value / 1000).toFixed(1)}k`;
  if (v < 1_000_000) return `${Math.round(value / 1000)}k`;
  if (v < 10_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return `${Math.round(value / 1_000_000)}M`;
}

/**
 * Format duration in ms.
 *   < 1ms        → "<1ms"
 *   < 1000ms     → "120ms"
 *   < 60s        → "1.2s"
 *   ≥ 60s        → "1m24s"
 *   ≥ 1h         → "1h12m"
 */
export function formatDuration(ms?: number | null): string {
  // ASCII '-' (U+002D) — tui-glyph-ascii ADR-001 (정렬 보장).
  // 이전 '—'(U+2014 em dash)는 East Asian Ambiguous로 환경별 visual width 변동.
  if (ms == null) return '-';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${m}m${s}s`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h${m}m`;
}

/** Format absolute timestamp (ms) → "HH:MM:SS". */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format relative time → "2s ago", "3m ago". */
export function formatRelative(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  if (diff < 1000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** Build a unicode block sparkline from an array of numbers. */
export function sparkline(data: readonly number[], width?: number): string {
  if (data.length === 0) return '';
  const slice = width != null && data.length > width ? data.slice(-width) : data;
  const max = Math.max(...slice, 1);
  return slice
    .map((v) => SPARK_BLOCKS[Math.min(7, Math.max(0, Math.floor((v / max) * 8)))])
    .join('');
}

/** ASCII fallback sparkline. */
export function sparklineAscii(data: readonly number[], width?: number): string {
  const ramp = '._-=*';
  if (data.length === 0) return '';
  const slice = width != null && data.length > width ? data.slice(-width) : data;
  const max = Math.max(...slice, 1);
  return slice
    .map((v) => ramp[Math.min(4, Math.max(0, Math.floor((v / max) * 5)))])
    .join('');
}

/** 1/8th-resolution horizontal bar. */
export function bar(ratio: number, width: number): string {
  const r = Math.max(0, Math.min(1, ratio));
  const filled = r * width;
  const full = Math.floor(filled);
  const partialIdx = Math.floor((filled - full) * 8);
  const partial = full < width ? BAR_BLOCKS[partialIdx] : '';
  return '█'.repeat(full) + partial + ' '.repeat(Math.max(0, width - full - 1));
}

/** Braille pulse pixel (4-row dithering). */
export function pulsePixel(value: number): string {
  if (value < 0.2) return BRAILLE_PIXELS[0];
  if (value < 0.4) return BRAILLE_PIXELS[1];
  if (value < 0.6) return BRAILLE_PIXELS[2];
  if (value < 0.85) return BRAILLE_PIXELS[3];
  return BRAILLE_PIXELS[4];
}

/** Pick a color from the token-usage LUT, given a 0..1 ratio. */
export function pickUsageColor(ratio: number, lut: readonly string[]): string {
  const r = Math.max(0, Math.min(0.999, ratio));
  return lut[Math.floor(r * lut.length)];
}

/**
 * Truncate string with ellipsis to fit a column width.
 *
 * ASCII '~' (U+007E) — tui-glyph-ascii ADR-001 (정렬 보장).
 * 이전 '…'(U+2026 horizontal ellipsis)는 East Asian Ambiguous로 환경별 visual
 * width 변동(narrow 1 vs wide 2)이 있어 컬럼 정렬을 깰 수 있었다.
 */
export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  if (max <= 1) return str.slice(0, max);
  return str.slice(0, max - 1) + '~';
}

/**
 * Normalize a string into a single line for column-based rendering.
 *
 * 책임 — Ink Yoga가 셀 wrap을 다음 형제 행으로 흘리지 않도록, 입력에서
 * 행 정렬을 깨뜨리는 모든 whitespace 변형을 제거한다.
 *
 * 의존성 — 없음 (순수 함수).
 * 호출 흐름 — `ToolRow.describeTarget()`이 호출 직전에 사용. 어떤 셀에든
 * 멀티라인 텍스트가 들어올 가능성이 있다면 출력 직전에 적용해야 한다.
 *
 * - `\r?\n`, `\t`를 단일 공백으로 치환
 * - 연속된 whitespace를 단일 공백으로 압축
 * - 양 끝 trim
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/docs/plans/tui-feed-alignment/adr.md ADR-001
 */
export function sanitizeOneLine(input?: string | null): string {
  if (!input) return '';
  return input.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Compress mcp__playwright__browser_click → ◇ click (depending on width budget).
 *
 * 책임 — 도구 이름을 budget 길이 이내의 단일라인 문자열로 정규화한다.
 *   결과 길이 <= budget 을 항상 보장한다 (호출 측 padEnd 정렬 의존).
 *
 * 의존성 — 없음.
 * 호출 흐름 — `ToolRow`에서 `compressToolName(name, 14)` 후 padEnd(14)로 정렬.
 *   따라서 어떤 분기든 14자 초과를 반환하면 정렬이 깨진다.
 */
export function compressToolName(name?: string | null, budget = 24): string {
  if (!name) return '';
  let out: string;
  if (name.startsWith('mcp__')) {
    const parts = name.split('__');
    const tail = parts[parts.length - 1] ?? name;
    if (budget < 12) {
      out = tail.slice(0, budget);
    } else if (budget < 20) {
      out = tail;
    } else {
      out = parts.slice(1).join(':');
    }
  } else {
    out = name;
  }
  // Hard ceiling — every branch must respect budget.
  // 길이 초과 시 ASCII '~'로 한 글자 차감하여 budget 정확히 맞춤
  // (tui-glyph-ascii ADR-001 — 이전 '…'는 ambiguous width).
  if (out.length > budget) {
    return budget <= 1 ? out.slice(0, budget) : out.slice(0, budget - 1) + '~';
  }
  return out;
}

/**
 * Shorten long IDs into S-xxxxxx form.
 *
 * 빈 ID 폴백은 ASCII '-' (tui-glyph-ascii ADR-001).
 */
export function shortSession(id?: string | null): string {
  if (!id) return '-';
  return `S-${id.slice(0, 6)}`;
}
