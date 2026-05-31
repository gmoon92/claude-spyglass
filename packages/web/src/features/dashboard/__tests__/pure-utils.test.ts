/**
 * pure-utils.test.ts — P3-09 순수 util 이식 동치/계약 (context-window, request-types,
 *  tool-colors, metrics-fetchers qs, infra-state).
 *
 * 원본 .js 와 병존 import 로 동치 비교(회귀 0).
 */
import { describe, it, expect } from 'vitest';
import { formatContextWindowLabel, DEFAULT_CONTEXT_WINDOW } from '../context-window';
import { subTypeOf, isAnchorTool, SUB_TYPES } from '../request-types';
import { getToolColor, readToolColorsFromCss, TOOL_COLORS } from '../tool-colors';
import { buildMetricQuery } from '../metrics-fetchers';
import {
  initialScrollLock,
  incrementScrollLock,
  resetScrollLock,
  isScrollLockBannerVisible,
} from '../infra-state';
// 원본(병존) — 동치 기준
import {
  formatContextWindowLabel as origCtxLabel,
  DEFAULT_CONTEXT_WINDOW as ORIG_DEFAULT,
} from '../../../../assets/js/context-window.js';
import {
  subTypeOf as origSubTypeOf,
  isAnchorTool as origIsAnchor,
} from '../../../../assets/js/request-types.js';
import { getToolColor as origGetToolColor } from '../../../../assets/js/tool-colors.js';

describe('context-window — 원본 동치', () => {
  it('DEFAULT_CONTEXT_WINDOW = 200_000', () => {
    expect(DEFAULT_CONTEXT_WINDOW).toBe(200_000);
    expect(DEFAULT_CONTEXT_WINDOW).toBe(ORIG_DEFAULT);
  });
  it.each([200_000, 1_000_000, 1_500_000, 262_144, 999, 0, 200_001])(
    'formatContextWindowLabel(%i) 동치',
    (n) => {
      expect(formatContextWindowLabel(n)).toBe(origCtxLabel(n));
    },
  );
  it('대표 표기: 200K / 1M / 1.5M / 262.1K', () => {
    expect(formatContextWindowLabel(200_000)).toBe('200K');
    expect(formatContextWindowLabel(1_000_000)).toBe('1M');
    expect(formatContextWindowLabel(1_500_000)).toBe('1.5M');
    expect(formatContextWindowLabel(262_144)).toBe('262.1K');
  });
});

describe('request-types — 원본 동치', () => {
  const cases = [
    { tool_name: 'Agent' },
    { tool_name: 'Skill' },
    { tool_name: 'mcp__server__tool' },
    { tool_name: 'TaskCreate' },
    { tool_name: 'Bash' },
    { tool_name: null },
    { type: 'response' },
    { tool_name: 'TaskUpdate' },
  ];
  it('subTypeOf 동치', () => {
    for (const c of cases) expect(subTypeOf(c)).toBe(origSubTypeOf(c));
  });
  it('isAnchorTool 동치(response/TaskUpdate/sub-type)', () => {
    for (const c of cases) expect(isAnchorTool(c)).toBe(origIsAnchor(c));
    expect(isAnchorTool(null)).toBe(false);
  });
  it('SUB_TYPES 집합 보존', () => {
    expect([...SUB_TYPES]).toEqual(['agent', 'skill', 'mcp', 'task']);
  });
});

describe('tool-colors — 원본 동치 + CSS override 순수화', () => {
  it.each(['Agent', 'Bash', 'mcp__x__Read', 'Unknown', null, ''])(
    'getToolColor(%s) 기본 테이블 동치',
    (name) => {
      expect(getToolColor(name)).toBe(origGetToolColor(name));
    },
  );
  it('mcp__ 접두사 → 마지막 세그먼트 룩업', () => {
    expect(getToolColor('mcp__srv__Bash')).toBe(TOOL_COLORS.Bash);
  });
  it('미존재 → default', () => {
    expect(getToolColor('Nonexistent')).toBe(TOOL_COLORS.default);
  });
  it('readToolColorsFromCss: CSS 변수 주입 시 override, 빈 값은 폴백(전역 불변)', () => {
    const cssVars: Record<string, string> = {
      '--tool-agent': '#111111',
      '--tool-bash': '', // 빈 → 폴백
    };
    const table = readToolColorsFromCss((n) => cssVars[n] ?? '');
    expect(table.Agent).toBe('#111111');
    expect(table.Skill).toBe('#111111'); // agent 와 동기
    expect(table.Bash).toBe(TOOL_COLORS.Bash); // 빈 → 기본 유지
    // base 불변(전역 mutate 폐기)
    expect(TOOL_COLORS.Agent).toBe('#f59e0b');
  });
});

describe('metrics-fetchers — qs 빌더', () => {
  it('빈 객체 → ""', () => {
    expect(buildMetricQuery({})).toBe('');
  });
  it('null/빈 값 키 생략', () => {
    expect(buildMetricQuery({ range: 'all', from: undefined, to: '' })).toBe('?range=all');
  });
  it('from/to/bucket 직렬화', () => {
    expect(buildMetricQuery({ from: 100, to: 200, bucket: 'hour' })).toBe('?from=100&to=200&bucket=hour');
  });
});

describe('infra-state — 스크롤 락 카운터(불변 전이)', () => {
  it('초기 0 → 배너 미노출', () => {
    expect(initialScrollLock.newCount).toBe(0);
    expect(isScrollLockBannerVisible(initialScrollLock)).toBe(false);
  });
  it('increment → newCount+1, 배너 노출', () => {
    const s = incrementScrollLock(incrementScrollLock(initialScrollLock));
    expect(s.newCount).toBe(2);
    expect(isScrollLockBannerVisible(s)).toBe(true);
  });
  it('reset → 0', () => {
    expect(resetScrollLock().newCount).toBe(0);
  });
  it('불변: 원본 상태 미변형', () => {
    incrementScrollLock(initialScrollLock);
    expect(initialScrollLock.newCount).toBe(0);
  });
});
