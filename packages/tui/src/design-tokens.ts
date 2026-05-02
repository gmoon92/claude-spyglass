/**
 * design-tokens.ts — Single Source of Truth for TUI tokens.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/design-tokens.md
 *
 * Components MUST reference semantic tokens (e.g. `tokens.color.primary.fg`).
 * Hex literals are forbidden in components.
 */

// Tokyo Night 9 semantic palette.
export const colorTruecolor = {
  primary: '#7aa2f7',
  success: '#9ece6a',
  warning: '#e0af68',
  danger: '#f7768e',
  info: '#7dcfff',
  muted: '#565f89',
  accent: '#bb9af7',
  fg: '#c0caf5',
  bgElev: '#1a1b26',
} as const;

// xterm-256 fallback indices (resolved by Ink as 256-color when truecolor not available).
export const color256 = {
  primary: 'rgb(122,162,247)',
  success: 'rgb(158,206,106)',
  warning: 'rgb(224,175,104)',
  danger: 'rgb(247,118,142)',
  info: 'rgb(125,207,255)',
  muted: 'rgb(86,95,137)',
  accent: 'rgb(187,154,247)',
  fg: 'rgb(192,202,245)',
  bgElev: 'rgb(26,27,38)',
} as const;

// 16-color ANSI fallback names (Ink-supported).
export const color16 = {
  primary: 'cyan',
  success: 'green',
  warning: 'yellow',
  danger: 'red',
  info: 'cyan',
  muted: 'gray',
  accent: 'magenta',
  fg: 'white',
  bgElev: 'black',
} as const;

export type SemanticColor = keyof typeof colorTruecolor;

// 7-stop OkLab gradient LUT for token usage (0% → 100%).
export const tokenUsageLut = [
  '#9ece6a', // 0..14% safe
  '#b5cf5a',
  '#cbd052',
  '#e0af68', // 50% caution
  '#e89265',
  '#ee7a72',
  '#f7768e', // >85% danger
] as const;

// Heatmap ramp.
export const heatmapLut = ['#1a1b26', '#3b4261', '#7aa2f7', '#bb9af7', '#f7768e'] as const;

export const tokens = {
  color: {
    primary: { fg: colorTruecolor.primary, ansi: color16.primary },
    success: { fg: colorTruecolor.success, ansi: color16.success },
    warning: { fg: colorTruecolor.warning, ansi: color16.warning },
    danger: { fg: colorTruecolor.danger, ansi: color16.danger },
    info: { fg: colorTruecolor.info, ansi: color16.info },
    muted: { fg: colorTruecolor.muted, ansi: color16.muted },
    accent: { fg: colorTruecolor.accent, ansi: color16.accent },
    fg: { fg: colorTruecolor.fg, ansi: color16.fg },
    bgElev: { fg: colorTruecolor.bgElev, ansi: color16.bgElev },
    scale: {
      tokenUsage: tokenUsageLut,
      heatmap: heatmapLut,
      /** percentile gradient: p0→p50 info, p50→p95 warning, p95+ danger */
      percentile: ['#7dcfff', '#a8d8a8', '#e0af68', '#f7768e'] as const,
    },
    /** SSE connection state semantic colors */
    live: '#9ece6a',
    paused: '#e0af68',
    stale: '#f7768e',
    /** Ticker dot colors */
    ticker: {
      active: '#7aa2f7',
      idle: '#565f89',
    },
  },
  spacing: {
    none: 0,
    xs: 1,
    sm: 2,
    md: 3,
    lg: 4,
    xl: 6,
    '2xl': 8,
  },
  border: {
    none: 'none',
    subtle: 'round',
    default: 'single',
    focused: 'bold',
    modal: 'double',
  } as const,
  motion: {
    duration: {
      instant: 0,
      fast: 80,
      normal: 150,
      slow: 300,
      glacial: 800,
    },
    spinner: {
      // ASCII narrow 1자 spinner — tui-glyph-ascii ADR-001 (정렬 보장).
      // 모든 프레임은 ASCII printable이므로 visual width 항상 1.
      tool: { frames: '|/-\\'.split(''), interval: 100 },
      net: { frames: '|/-\\'.split(''), interval: 100 },
      bg: { frames: '.oOo'.split(''), interval: 150 },
      agent: { frames: '|/-\\'.split(''), interval: 250 },
    },
    highlight: {
      enter: 80,
      hold: 300,
      decay: 500,
    },
  },
  /**
   * ASCII narrow 1-character icons — tui-glyph-ascii ADR-001.
   *
   * 모든 글리프는 ASCII printable(0x20–0x7E) 1자로 통일하여
   * 어떤 터미널·폰트·로케일에서도 visual width = 1 보장.
   * 의미 구분은 색상 토큰(success/warning/danger/info/accent)으로 유지.
   *
   * 미관은 trade-off로 수용. 향후 환경 진단 도구 도입 시 unicode 복원 가능.
   */
  icon: {
    file: { read: 'R', edit: 'E', write: 'W', delete: 'X' },
    search: { grep: '?', glob: '?', web: '@' },
    bash: { exec: '$', kill: 'K' },
    mcp: { default: 'M' },
    // d1/d2는 호출처가 단일 글리프 가정으로 사용하지만 현재 사용처 없음.
    // 단일 'A'로 통일하여 정렬 깨짐 방지 (이전 '▼▼▼'은 visual 4~6칸으로 위험).
    agent: { d0: 'A', d1: 'A', d2: 'A' },
    state: {
      ok: '+',
      err: '!',
      warn: '?',
      info: 'i',
      running: '*',
      idle: '.',
    },
    other: '.',
    stripe: '|',
  },
  layout: {
    breakpoint: { sm: 80, md: 100, lg: 140, xl: 180 },
    sidebarWidth: { collapsed: 4, default: 28, wide: 36 },
    stripHeight: 6,
    statusBarHeight: 1,
  },
  buffer: {
    feedMax: 500,
    sessionLru: 50,
    anomalyMax: 100,
    chartBuckets: 180,
  },
  type: {
    body: { bold: false, dim: false },
    label: { bold: false, dim: true },
    heading: { bold: true, dim: false },
    metric: { bold: true, dim: false },
    unit: { bold: false, dim: true },
    code: { bold: false, dim: false },
  },
} as const;

export type Tokens = typeof tokens;
