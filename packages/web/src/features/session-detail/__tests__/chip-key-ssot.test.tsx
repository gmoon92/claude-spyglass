/**
 * chip-key-ssot.test.tsx — TurnRows 의 data-chip-key 가 turn-rows.js#chipKeyForRequest SSoT 와
 * 일치함을 증명 (P3-05 "chipKey SSoT 재구현 금지").
 *
 * 전략:
 *  - TurnRows 렌더 결과에서 본문 행의 data-chip-key 를 추출.
 *  - 동일 입력으로 chipKeyForRequest(원본 export) 를 직접 호출한 값과 1:1 비교.
 *  - 6분기(response/task-event/agent/skill/mcp/tool) 전부 커버.
 *  - chipKey/chipFromRequest 도 같은 모듈에서 import 해 단위 검증(재구현본이 아님을 확정).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TurnRows } from '../TurnRows';
import {
  chipKey,
  chipFromRequest,
  chipKeyForRequest,
} from '../../../../assets/js/session-detail/turn-rows.js';

beforeAll(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.I18n = { t: (k: string) => k };
});

function tool(id: string, tool_name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'tool_call',
    session_id: 's1',
    turn_id: 't1',
    tokens_input: 0,
    tokens_output: 1,
    timestamp: '2026-04-28T10:01:00Z',
    model: null,
    tool_name,
    duration_ms: 1,
    ...extra,
  };
}

/** 렌더 HTML 에서 data-chip-key 값들을 등장 순서대로 추출. */
function extractChipKeys(html: string): string[] {
  return [...html.matchAll(/data-chip-key="([^"]*)"/g)].map((m) =>
    m[1].replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
  );
}

describe('chipKey/chipFromRequest 단위 (원본 SSoT export 재사용 확인)', () => {
  it('response → resp:<seq>', () => {
    expect(chipKey({ type: 'response', respSeq: 3 })).toBe('resp:3');
    expect(chipKeyForRequest({ type: 'response' } as any, 2)).toBe('resp:2');
  });
  it('agent/skill → agent|skill:<label>', () => {
    expect(chipKey(chipFromRequest(tool('a', 'Agent', { tool_detail: 'researcher' }), 0))).toBe('agent:researcher');
    expect(chipKey(chipFromRequest(tool('a', 'Skill', { tool_detail: 'commit' }), 0))).toBe('skill:commit');
  });
  it('mcp → mcp:<fullName>', () => {
    expect(chipKey(chipFromRequest(tool('a', 'mcp__redmine__getIssue'), 0))).toBe('mcp:mcp__redmine__getIssue');
  });
  it('task-event → task:<id>', () => {
    const r = tool('a', 'TaskUpdate', { payload: { tool_input: { taskId: 6, status: 'done' } } });
    expect(chipKey(chipFromRequest(r, 0))).toBe('task:6');
  });
  it('plain tool → tool:<label>', () => {
    expect(chipKey(chipFromRequest(tool('a', 'Read'), 0))).toBe('tool:Read');
  });
});

describe('TurnRows data-chip-key ≡ chipKeyForRequest (SSoT 위임)', () => {
  it('6분기 행의 chip-key 가 원본 함수 출력과 정확히 일치', () => {
    const items = [
      { kind: 'tool' as const, request: tool('a1', 'Agent', { tool_detail: 'researcher' }) },
      { kind: 'tool' as const, request: tool('a2', 'Skill', { tool_detail: 'commit' }) },
      { kind: 'tool' as const, request: tool('a3', 'mcp__redmine__getIssue') },
      { kind: 'tool' as const, request: tool('a4', 'TaskUpdate', { payload: { tool_input: { taskId: 6, status: 'done' } } }) },
      { kind: 'tool' as const, request: tool('a5', 'Write') },
      { kind: 'response' as const, request: { id: 'r1', type: 'response', turn_id: 't1', timestamp: '2026-04-28T10:03:00Z' } },
    ];
    const turn: any = { items };

    const html = renderToStaticMarkup(<TurnRows turn={turn} />);
    const got = extractChipKeys(html);

    // 원본 함수로 기대값 산출 — response 는 respSeq 누적(1-based).
    let respSeq = 0;
    const expected = items.map((it) => {
      if (it.kind === 'response') {
        respSeq += 1;
        return chipKeyForRequest({ ...it.request, type: 'response' } as any, respSeq);
      }
      return chipKeyForRequest({ ...it.request, type: 'tool_call' } as any, respSeq);
    });

    expect(got).toEqual(expected);
    expect(expected).toEqual(['agent:researcher', 'skill:commit', 'mcp:mcp__redmine__getIssue', 'task:6', 'tool:Write', 'resp:1']);
  });

  it('prompt 행에는 chip-key 가 없다(원본 turn-rows.js:356)', () => {
    const turn: any = { prompt: { id: 'p1', type: 'prompt', turn_id: 't1', timestamp: '2026-04-28T10:00:00Z' }, items: [] };
    const html = renderToStaticMarkup(<TurnRows turn={turn} />);
    expect(extractChipKeys(html)).toEqual([]);
  });
});
