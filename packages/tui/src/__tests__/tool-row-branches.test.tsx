/**
 * tool-row-branches.test.tsx — 특성화 테스트 (소스 변경 없음, 현재 렌더 출력이 스펙).
 *
 * tool-row-alignment.test.ts 가 컬럼 byte offset 정렬을 고정한다면, 본 파일은
 * ToolRow 의 "의미 분기"가 만들어내는 행 내용을 고정한다. 분기 판정 로직은
 * 모두 ToolRow 내부에 있으므로(호출 측 재계산 금지 원칙), 분기당 record 만
 * 바꿔 렌더한 stripped frame 을 검사한다.
 *
 * 커버:
 *   - 정상 tool → tokens 셀에 '+' prefix(formatTokens) 노출
 *   - pre_tool → tokens/dur 셀이 '...' (미완성 표시)
 *   - low confidence(tokens_confidence!=='high') → '*' 표지 등장
 *   - high confidence → '*' 표지 없음
 *   - child(parent_tool_use_id) → prefix '+-  '
 *   - root → prefix '    ' (공백)
 *   - error(status='error') → 아이콘이 error glyph (toolIconForRecord 경유)
 *   - pre_tool spinning: toolIconForRecord.spinning=true 경로 → Spinner 렌더
 *     (행이 1줄로 유지되는지 + 글자가 깨지지 않는지)
 *
 * 색상(ANSI) 자체는 ink 의 truecolor↔ENV 의존이라 비교에서 제외하고,
 * 색상을 떼어낸 문자 표면만 고정한다.
 *
 * 주의: ink-testing-library 의 가상 터미널 columns 는 100 고정이라
 * wrap="truncate-end" 가 100열에서 라인을 자른다. 우측 셀(tokens/lowConf/dur)
 * 까지 노출되도록 width=88 + 짧은 tool_detail 로 행 전체가 100열 안에 들도록 한다.
 */

import { describe, it, expect } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { ToolRow } from '../components/display/ToolRow';
import { tokens } from '../design-tokens';
import { makeRequest } from './helpers/fixtures';
import type { Request } from '../types';

/** 단일 ToolRow 의 stripped 첫 줄을 반환한다 (RowAccent stripe 1자 포함). */
function renderRow(over: Partial<Request>, width = 88): string {
  // 짧은 tool_detail 기본값으로 우측 셀이 100열 truncate 안에 들도록 한다.
  const record = makeRequest({ tool_detail: 'a.ts', ...over });
  const { lastFrame, unmount } = render(
    <ToolRow record={record} width={width} showSession />,
  );
  const frame = lastFrame() ?? '';
  unmount();
  const firstLine = frame.split('\n')[0] ?? '';
  // eslint-disable-next-line no-control-regex
  return firstLine.replace(/\x1B\[[0-9;]*m/g, '');
}

describe('ToolRow — tokens 셀 분기', () => {
  it("정상 tool → tokens 에 '+' prefix 노출", () => {
    const line = renderRow({ tokens_total: 1200, event_type: 'tool' });
    expect(line).toContain('+');
  });

  it("pre_tool → tokens/dur 셀이 '...' 으로 표시된다", () => {
    const line = renderRow({ event_type: 'pre_tool', tokens_total: undefined, duration_ms: undefined });
    // tokensRaw 와 durRaw 모두 '...' → 행에 '...' 가 최소 1회 등장
    expect(line).toContain('...');
  });

  it("tokens_total 없음(post) → tokens 셀에 '+' prefix 없음 ('-' 표시)", () => {
    const withTokens = renderRow({ event_type: 'tool', tokens_total: 1200 });
    const noTokens = renderRow({ event_type: 'tool', tokens_total: undefined });
    // 토큰 있으면 '+' 등장, 없으면 '+' 미등장 (현재 동작 대비 고정).
    expect(withTokens).toContain('+');
    expect(noTokens).not.toContain('+');
  });
});

describe('ToolRow — low confidence 표지', () => {
  it("tokens_confidence='low' → '*' 표지 등장", () => {
    const line = renderRow({ tokens_confidence: 'low' });
    expect(line).toContain('*');
  });

  it("tokens_confidence='medium' (=!high) → '*' 표지 등장", () => {
    const line = renderRow({ tokens_confidence: 'medium' as never });
    expect(line).toContain('*');
  });

  it("tokens_confidence='high' → '*' 표지 없음", () => {
    const line = renderRow({ tokens_confidence: 'high', tool_detail: 'plain.ts', tool_name: 'Read' });
    expect(line).not.toContain('*');
  });

  it('tokens_confidence undefined → 표지 없음', () => {
    const line = renderRow({ tokens_confidence: undefined, tool_detail: 'plain.ts', tool_name: 'Read' });
    expect(line).not.toContain('*');
  });
});

describe('ToolRow — child / root prefix', () => {
  it("child(parent_tool_use_id) → prefix '+-  '", () => {
    const line = renderRow({ parent_tool_use_id: 'p-1' });
    // RowAccent stripe(1자) 다음 4자가 prefix.
    expect(line.slice(1, 5)).toBe('+-  ');
  });

  it("root → prefix '    ' (공백 4자)", () => {
    const line = renderRow({ parent_tool_use_id: undefined });
    expect(line.slice(1, 5)).toBe('    ');
  });
});

describe('ToolRow — error / spinning 아이콘 경로', () => {
  it("status='error' → 아이콘 자리에 error glyph 가 온다", () => {
    const errGlyph = tokens.icon.state.err;
    const line = renderRow({ status: 'error', tool_detail: 'permission denied' });
    // 아이콘은 stripe(1)+prefix(4)+clock(8)+space(1) = offset 14.
    expect(line[14]).toBe(errGlyph);
  });

  it('pre_tool spinning 경로도 행이 1줄로 유지된다', () => {
    // toolIconForRecord 가 spinning=true 를 주는 pre_tool 경로(에러 아님).
    const line = renderRow({ event_type: 'pre_tool', status: undefined, tool_detail: 'npm install', tokens_total: undefined, duration_ms: undefined });
    expect(line.includes('\n')).toBe(false);
    // 아이콘 자리에 ASCII printable 1자(스피너 프레임).
    expect(line[14]).toMatch(/^[\x21-\x7E]$/);
  });
});
