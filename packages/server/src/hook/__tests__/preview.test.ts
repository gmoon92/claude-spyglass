/**
 * extractPreview — 행 표시용 preview 텍스트 추출 단위 테스트.
 *
 * 핵심 계약:
 *  - prompt: raw.prompt
 *  - tool_call + Skill: tool_input.args (없으면 skill 이름)
 *  - tool_call + Agent: tool_input.description (없으면 prompt → subagent_type)
 *  - 그 외 tool_call(Bash 등): null — tool_detail 폴백으로 충분
 *  - 2000자 상한
 *
 * @see packages/server/src/hook/preview.ts
 * @see packages/web/src/components/render/extract.ts (getContextText: preview 폴백)
 */

import { describe, expect, test } from 'bun:test';
import { extractPreview } from '../preview';
import type { NormalizedHookPayload } from '../types';

function mk(p: Partial<NormalizedHookPayload>): NormalizedHookPayload {
  return {
    id: 'r1', session_id: 's1', project_name: 'p', timestamp: 0,
    event_type: 'tool', request_type: 'tool_call',
    tokens_input: 0, tokens_output: 0, tokens_total: 0,
    source: 'claude-code-hook',
    ...p,
  };
}

describe('extractPreview', () => {
  test('prompt: raw.prompt 추출', () => {
    const r = mk({ request_type: 'prompt', payload: JSON.stringify({ prompt: '안녕 작업하자' }) });
    expect(extractPreview(r)).toBe('안녕 작업하자');
  });

  test('Skill: tool_input.args 우선', () => {
    const r = mk({
      request_type: 'tool_call', tool_name: 'Skill',
      payload: JSON.stringify({ tool_input: { skill: 'commit', args: '변경사항 전체 커밋' } }),
    });
    expect(extractPreview(r)).toBe('변경사항 전체 커밋');
  });

  test('Skill: args 없으면 skill 이름 폴백', () => {
    const r = mk({
      request_type: 'tool_call', tool_name: 'Skill',
      payload: JSON.stringify({ tool_input: { skill: 'explorer' } }),
    });
    expect(extractPreview(r)).toBe('explorer');
  });

  test('Agent: tool_input.description 우선', () => {
    const r = mk({
      request_type: 'tool_call', tool_name: 'Agent',
      payload: JSON.stringify({ tool_input: { subagent_type: 'Explore', description: '동시성 패턴 탐색', prompt: '긴 프롬프트...' } }),
    });
    expect(extractPreview(r)).toBe('동시성 패턴 탐색');
  });

  test('Agent: description 없으면 prompt → subagent_type 폴백', () => {
    const onlyPrompt = mk({
      request_type: 'tool_call', tool_name: 'Agent',
      payload: JSON.stringify({ tool_input: { subagent_type: 'Explore', prompt: '프롬프트만 있음' } }),
    });
    expect(extractPreview(onlyPrompt)).toBe('프롬프트만 있음');

    const onlyType = mk({
      request_type: 'tool_call', tool_name: 'Agent',
      payload: JSON.stringify({ tool_input: { subagent_type: 'Explore' } }),
    });
    expect(extractPreview(onlyType)).toBe('Explore');
  });

  test('그 외 tool_call(Bash)은 null — tool_detail 폴백으로 충분', () => {
    const r = mk({
      request_type: 'tool_call', tool_name: 'Bash',
      payload: JSON.stringify({ tool_input: { command: 'ls -la' } }),
    });
    expect(extractPreview(r)).toBeNull();
  });

  test('payload 없으면 null', () => {
    expect(extractPreview(mk({ request_type: 'prompt', payload: undefined }))).toBeNull();
    expect(extractPreview(mk({ request_type: 'tool_call', tool_name: 'Skill', payload: undefined }))).toBeNull();
  });

  test('JSON 파싱 실패 시 null (throw 안 함)', () => {
    const r = mk({ request_type: 'tool_call', tool_name: 'Skill', payload: 'not-json{' });
    expect(extractPreview(r)).toBeNull();
  });

  test('2000자 상한 적용', () => {
    const long = 'x'.repeat(5000);
    const r = mk({
      request_type: 'tool_call', tool_name: 'Skill',
      payload: JSON.stringify({ tool_input: { skill: 'commit', args: long } }),
    });
    expect(extractPreview(r)!.length).toBe(2000);
  });

  test('system 타입은 null', () => {
    const r = mk({ request_type: 'system', payload: JSON.stringify({ prompt: 'x' }) });
    expect(extractPreview(r)).toBeNull();
  });
});
