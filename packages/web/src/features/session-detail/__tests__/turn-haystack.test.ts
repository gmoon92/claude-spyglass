/**
 * turn-haystack.test.ts — buildTurnHaystack 특성화 (P3-06, §3.3/§8)
 *
 * 원본 buildTurnHaystack(turn-views.js:492) 는 module-private 라 직접 oracle 이 없다.
 * 특성화로 핵심 불변식을 고정한다:
 *  - T번호 접두 + prompt/도구/응답/reminder 순서 포함.
 *  - extract.js SSoT 재사용: payload 우선(preview 보다 우선), preview fallback.
 *  - 소문자 normalize + 16KB 절단.
 *  - newReminders 우선, 없으면 turn.system_reminder.
 */
import { describe, it, expect } from 'vitest';
import { buildTurnHaystack, HAYSTACK_MAX } from '../turn-haystack';

describe('buildTurnHaystack — 특성화', () => {
  it('T번호 + prompt/도구/응답/reminder 를 소문자로 포함', () => {
    const turn: any = {
      turn_index: 4,
      prompt: { preview: 'Hello PROMPT', model: 'Sonnet' },
      tool_calls: [{ tool_name: 'Read', tool_detail: 'foo.ts', model: 'Haiku' }],
      responses: [{ preview: 'Assistant SAID hi', model: 'Opus' }],
    };
    const hay = buildTurnHaystack(turn, ['Reminder ALPHA']);
    expect(hay.startsWith('t4 ')).toBe(true);
    expect(hay).toContain('hello prompt');
    expect(hay).toContain('read');
    expect(hay).toContain('foo.ts');
    expect(hay).toContain('assistant said hi');
    expect(hay).toContain('reminder alpha');
    expect(hay).toBe(hay.toLowerCase());
  });

  it('extract.js SSoT 재사용 — prompt payload 가 preview 보다 우선', () => {
    const turn: any = {
      turn_index: 1,
      prompt: { preview: 'short preview', payload: { prompt: 'FULL payload body distinct' } },
      tool_calls: [],
      responses: [],
    };
    const hay = buildTurnHaystack(turn);
    expect(hay).toContain('full payload body distinct');
    // preview 와 payload 가 다르면 둘 다 포함(원본 turn-views.js:497-498).
    expect(hay).toContain('short preview');
  });

  it('response payload(last_assistant_message) 우선 추출', () => {
    const turn: any = {
      turn_index: 2,
      prompt: null,
      tool_calls: [],
      responses: [{ payload: { last_assistant_message: 'FROM payload msg' }, preview: 'ignored preview' }],
    };
    const hay = buildTurnHaystack(turn);
    expect(hay).toContain('from payload msg');
  });

  it('newReminders 없으면 turn.system_reminder fallback', () => {
    const turn: any = { turn_index: 3, prompt: null, tool_calls: [], responses: [], system_reminder: 'SYSREM raw' };
    expect(buildTurnHaystack(turn)).toContain('sysrem raw');
    // newReminders 가 있으면 그쪽이 우선(원본 turn-views.js:512-516).
    expect(buildTurnHaystack(turn, ['OVERRIDE rem'])).toContain('override rem');
    expect(buildTurnHaystack(turn, ['OVERRIDE rem'])).not.toContain('sysrem raw');
  });

  it('16KB 절단', () => {
    const big = 'x'.repeat(40000);
    const turn: any = { turn_index: 1, prompt: { preview: big }, tool_calls: [], responses: [] };
    expect(buildTurnHaystack(turn).length).toBe(HAYSTACK_MAX);
  });
});
