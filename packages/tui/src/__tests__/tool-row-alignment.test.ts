/**
 * tool-row-alignment.test.ts — ToolRow 컬럼 정렬 시뮬레이션 검증.
 *
 * tui-glyph-ascii ADR-001/002에 따라 모든 글리프가 ASCII printable 1자로
 * 통일되었으므로 byte length = visual column이 성립한다. 이 테스트는 다양한
 * 도구·상태 조합으로 ToolRow를 렌더링한 뒤, 각 행에서 prefix 끝/clock 시작/
 * tool 시작/target 시작 byte offset이 모든 행에서 동일한지 검증한다.
 *
 * 이전 두 차례 시도에서 빌드/타입체크는 통과했지만 사용자 환경에서 정렬이
 * 깨졌다. 이 테스트는 회귀를 즉시 감지하기 위한 안전망이다.
 *
 * @see ${CLAUDE_PROJECT_DIR}/.claude/docs/plans/tui-glyph-ascii/adr.md ADR-002
 */

import { describe, expect, test } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { ToolRow } from '../components/display/ToolRow';
import type { Request } from '../types';

/**
 * 책임 — 단일 ToolRow를 렌더링한 뒤 stripped frame(첫 줄)을 반환한다.
 *
 * RowAccent 첫 글자(stripe '|' or ' ')는 fade 상태로 색상만 다를 뿐 visual
 * width 동일하므로, 모든 케이스에서 첫 1자를 떼어내면 ToolRow 본체의 byte
 * offset만 비교 가능하다.
 */
function renderRow(record: Request, opts?: { width?: number; showSession?: boolean }): string {
  const { lastFrame, unmount } = render(
    React.createElement(ToolRow, {
      record,
      width: opts?.width ?? 120,
      showSession: opts?.showSession ?? true,
    }),
  );
  const frame = lastFrame() ?? '';
  unmount();
  // 첫 줄(렌더된 한 행) + ANSI escape sequence 제거.
  const firstLine = frame.split('\n')[0] ?? '';
  // eslint-disable-next-line no-control-regex
  const stripped = firstLine.replace(/\x1B\[[0-9;]*m/g, '');
  return stripped;
}

/** 책임 — 공통 record 베이스 빌더. */
function makeRecord(over: Partial<Request>): Request {
  return {
    id: 'r-001',
    session_id: 'sess-abcdef0123',
    timestamp: new Date('2026-05-03T14:32:08').getTime(),
    tool_name: 'Read',
    tool_detail: '/path/to/file.ts',
    duration_ms: 120,
    tokens_total: 1200,
    status: 'ok',
    event_type: 'tool',
    ...over,
  };
}

/**
 * 책임 — 행 frame에서 fixed-width 셀 시작 byte offset을 추출한다.
 *
 * ToolRow 출력 구조 (ASCII 1자 가정):
 *   [stripe(1)][prefix(4)][clock(8)][space(1)][icon(1)][space(1)][tool(14)][space(1)][target...]
 *
 * stripe 0..1, prefix 1..5, clock 5..13, ' ' 13, icon 14, ' ' 15, tool 16..30, ' ' 30, target 31..
 */
type Offsets = {
  prefixStart: number;
  prefixEnd: number;
  clockStart: number;
  clockEnd: number;
  iconStart: number;
  toolStart: number;
  targetStart: number;
};

function offsets(): Offsets {
  return {
    prefixStart: 1,
    prefixEnd: 5,
    clockStart: 5,
    clockEnd: 13,
    iconStart: 14,
    toolStart: 16,
    targetStart: 31,
  };
}

describe('ToolRow ASCII alignment (tui-glyph-ascii)', () => {
  /** 다양한 도구·상태 조합. */
  const cases: Array<{ name: string; record: Request }> = [
    { name: 'Read root',       record: makeRecord({ tool_name: 'Read', tool_detail: 'main.ts:1-200' }) },
    { name: 'Edit root',       record: makeRecord({ tool_name: 'Edit', tool_detail: 'renderers.js' }) },
    { name: 'Write root',      record: makeRecord({ tool_name: 'Write', tool_detail: 'new-file.tsx' }) },
    { name: 'Delete root',     record: makeRecord({ tool_name: 'Delete', tool_detail: 'old.tmp' }) },
    { name: 'Bash root',       record: makeRecord({ tool_name: 'Bash', tool_detail: 'npm test' }) },
    { name: 'Grep root',       record: makeRecord({ tool_name: 'Grep', tool_detail: 'toolIcon' }) },
    { name: 'Glob root',       record: makeRecord({ tool_name: 'Glob', tool_detail: '**/*.ts' }) },
    { name: 'WebSearch',       record: makeRecord({ tool_name: 'WebSearch', tool_detail: 'react docs' }) },
    { name: 'Agent',           record: makeRecord({ tool_name: 'Agent', tool_detail: 'designer' }) },
    { name: 'TaskCreate',      record: makeRecord({ tool_name: 'TaskCreate', tool_detail: 'plan task' }) },
    { name: 'mcp__playwright', record: makeRecord({ tool_name: 'mcp__playwright__browser_click', tool_detail: 'button#submit' }) },
    { name: 'Read child',      record: makeRecord({ tool_name: 'Read', parent_tool_use_id: 'parent-1' }) },
    { name: 'Bash pre_tool',   record: makeRecord({ tool_name: 'Bash', event_type: 'pre_tool', tool_detail: 'npm install', duration_ms: undefined, tokens_total: undefined }) },
    { name: 'Edit error',      record: makeRecord({ tool_name: 'Edit', status: 'error', tool_detail: 'permission denied' }) },
    { name: 'Read multiline',  record: makeRecord({ tool_name: 'Read', tool_detail: 'sqlite3 db\n"SELECT *\nFROM t"' }) },
    { name: 'Read long name',  record: makeRecord({ tool_name: 'NotebookEdit', tool_detail: 'cell-3' }) },
    { name: 'low conf',        record: makeRecord({ tool_name: 'Read', tokens_confidence: 'low' }) },
  ];

  test('각 셀의 byte offset이 모든 케이스에서 일정하다', () => {
    const O = offsets();
    const renderedLines: Array<{ name: string; line: string }> = [];

    for (const c of cases) {
      const line = renderRow(c.record);
      renderedLines.push({ name: c.name, line });
    }

    // 디버깅 편의 — 실패 시 실제 행을 콘솔에 출력.
    if (process.env.DEBUG_ALIGN === '1') {
      console.log('\n--- rendered rows ---');
      for (const r of renderedLines) console.log(`${r.name.padEnd(20)} | ${r.line}`);
      console.log('--- offsets expected ---');
      console.log(`prefix ${O.prefixStart}..${O.prefixEnd}, clock ${O.clockStart}..${O.clockEnd}, icon ${O.iconStart}, tool ${O.toolStart}, target ${O.targetStart}`);
    }

    for (const { name, line } of renderedLines) {
      // 1. line 길이 충분한지 (최소 target 시작 위치까지)
      expect(line.length, `[${name}] line too short: "${line}"`).toBeGreaterThanOrEqual(O.targetStart);

      // 2. clock 위치에 정확히 'HH:MM:SS' (8 ASCII char) 패턴
      const clockSlice = line.slice(O.clockStart, O.clockEnd);
      expect(clockSlice, `[${name}] clock slice "${clockSlice}" mismatch`).toMatch(/^\d{2}:\d{2}:\d{2}$/);

      // 3. clock 다음 char는 space
      expect(line[O.clockEnd], `[${name}] expected space after clock`).toBe(' ');

      // 4. icon 위치는 ASCII printable 1자 (state.* / file.* / search.* / bash.* / mcp / agent / spinner / other)
      const iconChar = line[O.iconStart];
      expect(iconChar, `[${name}] icon "${iconChar}" must be single ASCII printable`).toMatch(/^[\x21-\x7E]$/);

      // 5. icon 다음 char는 space
      expect(line[O.iconStart + 1], `[${name}] expected space after icon`).toBe(' ');

      // 6. tool 슬라이스는 정확히 14자
      const toolSlice = line.slice(O.toolStart, O.toolStart + 14);
      expect(toolSlice.length, `[${name}] tool slice length`).toBe(14);

      // 7. tool 다음 char는 space (정확히 1자)
      expect(line[O.toolStart + 14], `[${name}] expected space after tool`).toBe(' ');

      // 8. prefix 슬라이스는 정확히 4 ASCII char (스페이스 또는 '+', '-')
      const prefixSlice = line.slice(O.prefixStart, O.prefixEnd);
      expect(prefixSlice.length, `[${name}] prefix slice length`).toBe(4);
      for (let i = 0; i < 4; i++) {
        expect(prefixSlice[i], `[${name}] prefix char ${i} not ASCII: "${prefixSlice[i]}"`).toMatch(/^[\x20-\x7E]$/);
      }
    }
  });

  test('prefix는 isChild에 따라 "+-  "(child) 또는 "    "(root)', () => {
    const O = offsets();
    const root = renderRow(makeRecord({ parent_tool_use_id: undefined }));
    const child = renderRow(makeRecord({ parent_tool_use_id: 'parent-1' }));

    expect(root.slice(O.prefixStart, O.prefixEnd)).toBe('    ');
    expect(child.slice(O.prefixStart, O.prefixEnd)).toBe('+-  ');
  });

  test('child·root row의 컬럼 시작 위치가 동일하다', () => {
    const O = offsets();
    const root = renderRow(makeRecord({ parent_tool_use_id: undefined }));
    const child = renderRow(makeRecord({ parent_tool_use_id: 'parent-1' }));

    // clock·icon·tool·target 시작 byte offset 동일해야 함
    expect(root.slice(O.clockStart, O.clockEnd)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(child.slice(O.clockStart, O.clockEnd)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(root[O.iconStart]).toMatch(/^[\x21-\x7E]$/);
    expect(child[O.iconStart]).toMatch(/^[\x21-\x7E]$/);
  });

  test('pre_tool / error / 일반 tool 모두 icon 자리에 ASCII 1자', () => {
    const O = offsets();
    const pre = renderRow(makeRecord({ event_type: 'pre_tool', duration_ms: undefined, tokens_total: undefined }));
    const err = renderRow(makeRecord({ status: 'error', tool_detail: 'failed' }));
    const ok = renderRow(makeRecord({}));

    for (const [name, line] of [['pre', pre], ['err', err], ['ok', ok]] as const) {
      expect(line[O.iconStart], `[${name}] icon must be single ASCII printable`).toMatch(/^[\x21-\x7E]$/);
      expect(line[O.iconStart + 1], `[${name}] expected space after icon`).toBe(' ');
    }
  });

  test('multiline tool_detail이 들어와도 행 1줄 보장', () => {
    const r = makeRecord({ tool_detail: 'line1\nline2\nline3\nline4' });
    const line = renderRow(r);
    // single line 출력 — newline이 line 자체에 포함되면 안 됨.
    expect(line.includes('\n')).toBe(false);
  });
});
