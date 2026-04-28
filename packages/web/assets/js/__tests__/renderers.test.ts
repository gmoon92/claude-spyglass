import { describe, it, expect } from 'bun:test';
import { makeRequestRow, makeTargetCell, makeSessionRow } from '../renderers.js';

// ── 목 데이터 ─────────────────────────────────────────────────────────────────

function prompt(id: string, session_id: string, tokens_input: number = 100) {
  return {
    id,
    type: 'prompt',
    session_id,
    tokens_input,
    tokens_output: 0,
    timestamp: '2026-04-28T10:00:00Z',
    model: 'claude-3-5-sonnet',
    duration_ms: 50,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
  };
}

function tool_call(id: string, turn_id: string, tool_name: string = 'Read') {
  return {
    id,
    type: 'tool_call',
    session_id: 's1',
    tokens_input: 0,
    tokens_output: 100,
    timestamp: '2026-04-28T10:01:00Z',
    model: null,
    tool_name,
    turn_id,
    duration_ms: 200,
  };
}

function session(id: string, started_at: string = '2026-04-28T10:00:00Z', total_tokens: number = 5000) {
  return {
    id,
    started_at,
    ended_at: null as string | null,
    first_prompt_payload: JSON.stringify({ preview: '첫 프롬프트 미리보기' }),
    total_tokens,
  };
}

// ── makeRequestRow 테스트 ──────────────────────────────────────────────────────

describe('makeRequestRow', () => {
  it('prompt 타입 with showSession: false', () => {
    const r = prompt('r1', 's1', 500);
    const html = makeRequestRow(r, { showSession: false });
    expect(html).toMatchSnapshot();
  });

  it('prompt 타입 with showSession: true', () => {
    const r = prompt('r1', 's1', 500);
    const html = makeRequestRow(r, { showSession: true });
    expect(html).toMatchSnapshot();
  });

  it('tool_call 타입 with 정상 응답', () => {
    const r = tool_call('r2', 'turn1', 'Read');
    const html = makeRequestRow(r, { showSession: false });
    expect(html).toMatchSnapshot();
  });

  it('tool_call 타입 with anomaly flags (spike + loop)', () => {
    const r = tool_call('r3', 'turn2', 'Bash');
    r.duration_ms = 2000;
    const flags = new Set(['spike', 'loop']);
    const html = makeRequestRow(r, { showSession: false, anomalyFlags: flags });
    expect(html).toMatchSnapshot();
  });

  it('system 타입 (드물지만 포함)', () => {
    const r: any = {
      id: 'r4',
      type: 'system',
      session_id: 's1',
      tokens_input: 0,
      tokens_output: 0,
      timestamp: '2026-04-28T10:02:00Z',
      model: null,
      duration_ms: 10,
    };
    const html = makeRequestRow(r, { showSession: true });
    expect(html).toMatchSnapshot();
  });

  it('토큰 0 인 경우 (빈 셀)', () => {
    const r = prompt('r5', 's2', 0);
    r.tokens_output = 0;
    const html = makeRequestRow(r, { showSession: false });
    expect(html).toMatchSnapshot();
  });

  it('모델명 없는 prompt (synthetic)', () => {
    const r = prompt('r6', 's3');
    r.model = 'synthetic';
    const html = makeRequestRow(r, { showSession: false });
    expect(html).toMatchSnapshot();
  });

  it('캐시 토큰 포함', () => {
    const r = prompt('r7', 's4', 1000);
    r.cache_read_tokens = 500;
    r.cache_creation_tokens = 250;
    const html = makeRequestRow(r, { showSession: false });
    expect(html).toMatchSnapshot();
  });

  it('anomaly flag: slow만 포함', () => {
    const r = tool_call('r8', 'turn3', 'Write');
    r.duration_ms = 3000;
    const flags = new Set(['slow']);
    const html = makeRequestRow(r, { showSession: false, anomalyFlags: flags });
    expect(html).toMatchSnapshot();
  });
});

// ── makeTargetCell 테스트 ──────────────────────────────────────────────────────

describe('makeTargetCell', () => {
  it('prompt 타입 (user role)', () => {
    const r = prompt('r1', 's1');
    const html = makeTargetCell(r);
    expect(html).toMatchSnapshot();
  });

  it('tool_call 타입 with tool_name', () => {
    const r = tool_call('r2', 'turn1', 'Read');
    const html = makeTargetCell(r);
    expect(html).toMatchSnapshot();
  });

  it('tool_call 타입 tool_name 없음', () => {
    const r = tool_call('r3', 'turn2', '');
    r.tool_name = null as any;
    const html = makeTargetCell(r);
    expect(html).toMatchSnapshot();
  });

  it('Agent/Skill 타입 (특수 렌더링)', () => {
    const r = tool_call('r4', 'turn3', 'Agent');
    const html = makeTargetCell(r);
    expect(html).toMatchSnapshot();
  });

  it('system 타입', () => {
    const r: any = {
      id: 'r5',
      type: 'system',
      session_id: 's1',
    };
    const html = makeTargetCell(r);
    expect(html).toMatchSnapshot();
  });
});

// ── makeSessionRow 테스트 ──────────────────────────────────────────────────────

describe('makeSessionRow', () => {
  it('활성 세션 (ended_at: null) with preview', () => {
    const s = session('s1', '2026-04-28T10:00:00Z', 10000);
    const html = makeSessionRow(s, false);
    expect(html).toMatchSnapshot();
  });

  it('활성 세션 (ended_at: null) isSelected: true', () => {
    const s = session('s2', '2026-04-28T09:00:00Z', 5000);
    const html = makeSessionRow(s, true);
    expect(html).toMatchSnapshot();
  });

  it('종료된 세션 (ended_at 설정)', () => {
    const s = session('s3', '2026-04-28T08:00:00Z', 3000);
    s.ended_at = '2026-04-28T08:30:00Z';
    const html = makeSessionRow(s, false);
    expect(html).toMatchSnapshot();
  });

  it('미리보기 없는 세션', () => {
    const s = session('s4');
    s.first_prompt_payload = JSON.stringify({});
    const html = makeSessionRow(s, false);
    expect(html).toMatchSnapshot();
  });

  it('토큰이 많은 세션', () => {
    const s = session('s5', '2026-04-28T07:00:00Z', 1000000);
    const html = makeSessionRow(s, false);
    expect(html).toMatchSnapshot();
  });

  it('긴 미리보기 텍스트', () => {
    const s = session('s6');
    s.first_prompt_payload = JSON.stringify({
      preview: '이것은 매우 긴 프롬프트 텍스트입니다. ' +
               '여러 줄에 걸쳐 있을 수 있으며 특수 문자도 포함됩니다: <>&"\'',
    });
    const html = makeSessionRow(s, false);
    expect(html).toMatchSnapshot();
  });
});
