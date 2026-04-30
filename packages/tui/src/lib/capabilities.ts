/**
 * capabilities.ts — Terminal capability detection.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/skills/ui-designer/references/tui/capabilities.md §1
 */

export type Capabilities = {
  truecolor: boolean;
  unicode: boolean;
  braille: boolean;
  emoji: boolean;
  colors: 16 | 256 | 16777216;
  motion: boolean;
};

export function detect(): Capabilities {
  const env = process.env;
  const colorterm = env.COLORTERM ?? '';
  const term = env.TERM ?? '';
  const lang = (env.LANG ?? '') + (env.LC_ALL ?? '');
  const truecolor = /truecolor|24bit/i.test(colorterm);
  const unicode = /UTF-?8/i.test(lang) || process.platform === 'darwin';
  const isLinuxConsole = term === 'linux';
  const inScreen = term.startsWith('screen');
  const noColor = env.NO_COLOR != null && env.NO_COLOR !== '';
  const noMotion = env.SPYGLASS_NO_MOTION === '1';

  return {
    truecolor: truecolor && !isLinuxConsole && !noColor,
    unicode: unicode && !isLinuxConsole,
    braille: unicode && !isLinuxConsole && !inScreen,
    emoji: unicode && !isLinuxConsole && process.platform !== 'win32',
    colors: noColor ? 16 : truecolor ? 16777216 : term.includes('256') ? 256 : 16,
    motion: !noMotion,
  };
}
