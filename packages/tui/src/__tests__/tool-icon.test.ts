/**
 * tool-icon.test.ts — 특성화 테스트 for tool-icon.ts pure functions.
 *
 * categorize() 와 toolIconForRecord() 의 현재 동작을 고정하는 회귀 가드.
 * design-tokens의 실제 값에 의존하여 글리프 유효성도 검증한다.
 */

import { describe, expect, test } from 'bun:test';
import { categorize, toolIconForRecord } from '../lib/tool-icon';
import { tokens } from '../design-tokens';
import type { Request } from '../types';

// ---------------------------------------------------------------------------
// categorize
// ---------------------------------------------------------------------------
describe('categorize', () => {
  test('null/undefined → "other"', () => {
    expect(categorize(null)).toBe('other');
    expect(categorize(undefined)).toBe('other');
    expect(categorize('')).toBe('other');
  });

  test('Agent / Task → "agent"', () => {
    expect(categorize('Agent')).toBe('agent');
    expect(categorize('Task')).toBe('agent');
  });

  test('mcp__ prefix → "mcp"', () => {
    expect(categorize('mcp__playwright__click')).toBe('mcp');
    expect(categorize('mcp__custom__tool')).toBe('mcp');
  });

  test('file ops → "fileops"', () => {
    for (const name of ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Delete']) {
      expect(categorize(name), name).toBe('fileops');
    }
  });

  test('search ops → "search"', () => {
    for (const name of ['Grep', 'Glob', 'WebSearch', 'WebFetch']) {
      expect(categorize(name), name).toBe('search');
    }
  });

  test('bash ops → "bash"', () => {
    for (const name of ['Bash', 'KillShell', 'BashOutput']) {
      expect(categorize(name), name).toBe('bash');
    }
  });

  test('unknown tool → "other"', () => {
    expect(categorize('CustomTool')).toBe('other');
    expect(categorize('Unknown')).toBe('other');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRequest(over: Partial<Request>): Pick<Request, 'tool_name' | 'event_type' | 'tool_detail' | 'status'> {
  return {
    tool_name: 'Read',
    event_type: 'tool',
    tool_detail: null,
    status: 'ok',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// toolIconForRecord — glyph is single ASCII printable
// ---------------------------------------------------------------------------
describe('toolIconForRecord — glyph is always single ASCII printable', () => {
  const cases: Array<{ name: string; record: ReturnType<typeof makeRequest> }> = [
    { name: 'Read',       record: makeRequest({ tool_name: 'Read' }) },
    { name: 'Edit',       record: makeRequest({ tool_name: 'Edit' }) },
    { name: 'Write',      record: makeRequest({ tool_name: 'Write' }) },
    { name: 'Delete',     record: makeRequest({ tool_name: 'Delete' }) },
    { name: 'Bash',       record: makeRequest({ tool_name: 'Bash' }) },
    { name: 'KillShell',  record: makeRequest({ tool_name: 'KillShell' }) },
    { name: 'Grep',       record: makeRequest({ tool_name: 'Grep' }) },
    { name: 'WebSearch',  record: makeRequest({ tool_name: 'WebSearch' }) },
    { name: 'Agent',      record: makeRequest({ tool_name: 'Agent' }) },
    { name: 'mcp',        record: makeRequest({ tool_name: 'mcp__playwright__click' }) },
    { name: 'other',      record: makeRequest({ tool_name: 'CustomTool' }) },
    { name: 'pre_tool',   record: makeRequest({ event_type: 'pre_tool' }) },
    { name: 'error status', record: makeRequest({ status: 'error' }) },
    { name: 'error in detail', record: makeRequest({ tool_detail: 'exit 1: error occurred' }) },
  ];

  for (const { name, record } of cases) {
    test(`${name} → glyph is single ASCII printable`, () => {
      const resolution = toolIconForRecord(record);
      expect(resolution.glyph.length).toBe(1);
      expect(resolution.glyph.charCodeAt(0)).toBeGreaterThanOrEqual(0x21);
      expect(resolution.glyph.charCodeAt(0)).toBeLessThanOrEqual(0x7e);
    });
  }
});

// ---------------------------------------------------------------------------
// toolIconForRecord — state machine
// ---------------------------------------------------------------------------
describe('toolIconForRecord — state machine', () => {
  test('error status (non-pre_tool) → err glyph, not spinning', () => {
    const r = toolIconForRecord(makeRequest({ status: 'error' }));
    expect(r.glyph).toBe(tokens.icon.state.err);
    expect(r.spinning).toBe(false);
    expect(r.color).toBe(tokens.color.danger.fg);
  });

  test('pre_tool → spinning=true', () => {
    const r = toolIconForRecord(makeRequest({ event_type: 'pre_tool', status: 'ok' }));
    expect(r.spinning).toBe(true);
    expect(r.color).toBe(tokens.color.info.fg);
  });

  test('pre_tool with error status → still spinning (pre_tool takes precedence)', () => {
    // Current behavior: pre_tool bypasses error branch
    const r = toolIconForRecord(makeRequest({ event_type: 'pre_tool', status: 'error' }));
    expect(r.spinning).toBe(true);
  });

  test('error in tool_detail → err glyph', () => {
    const r = toolIconForRecord(makeRequest({ tool_detail: 'failed to read file' }));
    expect(r.glyph).toBe(tokens.icon.state.err);
  });

  test('fileops Read → success color', () => {
    const r = toolIconForRecord(makeRequest({ tool_name: 'Read' }));
    expect(r.spinning).toBe(false);
    expect(r.color).toBe(tokens.color.success.fg);
    expect(r.glyph).toBe(tokens.icon.file.read);
  });

  test('fileops Edit → edit glyph', () => {
    const r = toolIconForRecord(makeRequest({ tool_name: 'Edit' }));
    expect(r.glyph).toBe(tokens.icon.file.edit);
  });

  test('Bash → warning color, exec glyph', () => {
    const r = toolIconForRecord(makeRequest({ tool_name: 'Bash' }));
    expect(r.color).toBe(tokens.color.warning.fg);
    expect(r.glyph).toBe(tokens.icon.bash.exec);
  });

  test('KillShell → kill glyph', () => {
    const r = toolIconForRecord(makeRequest({ tool_name: 'KillShell' }));
    expect(r.glyph).toBe(tokens.icon.bash.kill);
  });

  test('WebSearch → web search glyph', () => {
    const r = toolIconForRecord(makeRequest({ tool_name: 'WebSearch' }));
    expect(r.glyph).toBe(tokens.icon.search.web);
  });

  test('Grep → grep glyph', () => {
    const r = toolIconForRecord(makeRequest({ tool_name: 'Grep' }));
    expect(r.glyph).toBe(tokens.icon.search.grep);
  });

  test('Agent → accent color, agent glyph', () => {
    const r = toolIconForRecord(makeRequest({ tool_name: 'Agent' }));
    expect(r.color).toBe(tokens.color.accent.fg);
    expect(r.glyph).toBe(tokens.icon.agent.d0);
  });

  test('mcp__ → accent color, mcp default glyph', () => {
    const r = toolIconForRecord(makeRequest({ tool_name: 'mcp__playwright__click' }));
    expect(r.color).toBe(tokens.color.accent.fg);
    expect(r.glyph).toBe(tokens.icon.mcp.default);
  });

  test('unknown tool → other glyph, muted color', () => {
    const r = toolIconForRecord(makeRequest({ tool_name: 'CustomTool' }));
    expect(r.glyph).toBe(tokens.icon.other);
    expect(r.color).toBe(tokens.color.muted.fg);
  });

  test('label reflects tool_name', () => {
    expect(toolIconForRecord(makeRequest({ tool_name: 'Bash' })).label).toBe('Bash');
    expect(toolIconForRecord(makeRequest({ tool_name: 'Read' })).label).toBe('Read');
  });
});
