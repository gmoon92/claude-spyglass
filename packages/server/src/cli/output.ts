/**
 * CLI 출력 포맷터 — 색상·심볼·CheckResult 타입.
 *
 * 변경 이유: 출력 포맷(색상·심볼·다국어) 변경 시 한 곳만 수정.
 */

const COLOR_GREEN = '\x1b[32m';
const COLOR_RED = '\x1b[31m';
const COLOR_YELLOW = '\x1b[33m';
const COLOR_RESET = '\x1b[0m';

const CHECK = '✓';
const CROSS = '✗';
const WARN = '⚠';

export interface CheckResult {
  status: 'ok' | 'fail' | 'warn';
  message: string;
  hint?: string;
}

export function log(status: CheckResult['status'], message: string, hint?: string) {
  let symbol = '';
  let color = '';

  switch (status) {
    case 'ok':
      symbol = CHECK;
      color = COLOR_GREEN;
      break;
    case 'fail':
      symbol = CROSS;
      color = COLOR_RED;
      break;
    case 'warn':
      symbol = WARN;
      color = COLOR_YELLOW;
      break;
  }

  console.log(`${color}${symbol}${COLOR_RESET} ${message}`);
  if (hint) {
    console.log(`  → ${hint}`);
  }
}
