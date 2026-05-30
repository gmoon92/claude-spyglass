/**
 * capabilities.test.ts — 특성화 테스트 for capabilities.ts detect() function.
 *
 * detect()는 process.env를 직접 읽으므로, 각 테스트에서 환경변수를 설정하고
 * 원상복구한다. 소스 변경 없이 현재 동작을 고정하는 회귀 가드.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { detect } from '../lib/capabilities';

// 각 테스트 전 환경변수 원상복구를 위한 저장
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {
    COLORTERM: process.env.COLORTERM,
    TERM: process.env.TERM,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    NO_COLOR: process.env.NO_COLOR,
    SPYGLASS_NO_MOTION: process.env.SPYGLASS_NO_MOTION,
  };
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------
describe('detect() — result shape', () => {
  test('returns object with expected keys', () => {
    const cap = detect();
    expect(typeof cap.truecolor).toBe('boolean');
    expect(typeof cap.unicode).toBe('boolean');
    expect(typeof cap.braille).toBe('boolean');
    expect(typeof cap.emoji).toBe('boolean');
    expect([16, 256, 16777216]).toContain(cap.colors);
    expect(typeof cap.motion).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// truecolor
// ---------------------------------------------------------------------------
describe('detect() — truecolor', () => {
  test('COLORTERM=truecolor → truecolor=true (non-linux console)', () => {
    process.env.COLORTERM = 'truecolor';
    process.env.TERM = 'xterm-256color';
    delete process.env.NO_COLOR;
    const cap = detect();
    expect(cap.truecolor).toBe(true);
  });

  test('COLORTERM=24bit → truecolor=true', () => {
    process.env.COLORTERM = '24bit';
    process.env.TERM = 'xterm-256color';
    delete process.env.NO_COLOR;
    const cap = detect();
    expect(cap.truecolor).toBe(true);
  });

  test('NO_COLOR=1 → truecolor=false', () => {
    process.env.COLORTERM = 'truecolor';
    process.env.NO_COLOR = '1';
    process.env.TERM = 'xterm-256color';
    const cap = detect();
    expect(cap.truecolor).toBe(false);
  });

  test('TERM=linux → truecolor=false (linux console override)', () => {
    process.env.COLORTERM = 'truecolor';
    process.env.TERM = 'linux';
    delete process.env.NO_COLOR;
    const cap = detect();
    expect(cap.truecolor).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// colors
// ---------------------------------------------------------------------------
describe('detect() — colors', () => {
  test('NO_COLOR=1 → colors=16', () => {
    process.env.NO_COLOR = '1';
    process.env.COLORTERM = 'truecolor';
    const cap = detect();
    expect(cap.colors).toBe(16);
  });

  test('truecolor → colors=16777216', () => {
    process.env.COLORTERM = 'truecolor';
    process.env.TERM = 'xterm-256color';
    delete process.env.NO_COLOR;
    const cap = detect();
    expect(cap.colors).toBe(16777216);
  });

  test('TERM=xterm-256color, no truecolor → colors=256', () => {
    delete process.env.COLORTERM;
    process.env.TERM = 'xterm-256color';
    delete process.env.NO_COLOR;
    const cap = detect();
    expect(cap.colors).toBe(256);
  });
});

// ---------------------------------------------------------------------------
// motion
// ---------------------------------------------------------------------------
describe('detect() — motion', () => {
  test('SPYGLASS_NO_MOTION=1 → motion=false', () => {
    process.env.SPYGLASS_NO_MOTION = '1';
    const cap = detect();
    expect(cap.motion).toBe(false);
  });

  test('SPYGLASS_NO_MOTION unset → motion=true', () => {
    delete process.env.SPYGLASS_NO_MOTION;
    const cap = detect();
    expect(cap.motion).toBe(true);
  });

  test('SPYGLASS_NO_MOTION=0 → motion=true (only "1" disables)', () => {
    process.env.SPYGLASS_NO_MOTION = '0';
    const cap = detect();
    expect(cap.motion).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// unicode / braille
// ---------------------------------------------------------------------------
describe('detect() — unicode / braille', () => {
  test('LANG with UTF-8 → unicode=true', () => {
    process.env.LANG = 'ko_KR.UTF-8';
    process.env.TERM = 'xterm-256color';
    const cap = detect();
    expect(cap.unicode).toBe(true);
  });

  test('TERM=linux → unicode=false, braille=false', () => {
    process.env.TERM = 'linux';
    // On darwin, process.platform === 'darwin' → unicode=true but linux console overrides
    // The linux check in detect(): unicode = unicode && !isLinuxConsole
    process.env.LANG = 'ko_KR.UTF-8';
    const cap = detect();
    expect(cap.unicode).toBe(false);
    expect(cap.braille).toBe(false);
  });
});
