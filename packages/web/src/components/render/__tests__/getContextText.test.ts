/**
 * getContextText — MESSAGE 컬럼 텍스트 추출 (contextPreviewData 진입점).
 *
 * 핵심 계약: Skill/Agent 의 MESSAGE 는 이름(tool_detail)이 아니라 실제 지시문을 보여준다.
 *  - payload 동반(세션 상세 on-demand): Skill=args / Agent=description 우선
 *  - payload 없음(피드, 전송 최적화): preview(수집 시 저장된 args/description) → tool_detail 폴백
 *  - Bash 등 그 외 도구: tool_detail (preview 무관, 회귀 없음)
 *
 * @see packages/web/src/components/render/extract.ts
 * @see packages/server/src/hook/preview.ts (preview 를 채우는 SSoT)
 */

import { describe, expect, it } from 'vitest';
import { getContextText, fullDetailFromPayload } from '../extract';

describe('getContextText — Skill/Agent MESSAGE', () => {
  it('Skill, payload 없음, preview=args → preview 사용(이름 중복 회피)', () => {
    const r = {
      id: '1', type: 'tool_call', tool_name: 'Skill',
      tool_detail: 'commit', preview: '변경사항 전체 커밋', payload: undefined,
    };
    expect(getContextText(r)).toBe('변경사항 전체 커밋');
  });

  it('Skill, payload 없음, preview 없음 → tool_detail 폴백', () => {
    const r = {
      id: '1', type: 'tool_call', tool_name: 'Skill',
      tool_detail: 'commit', preview: undefined, payload: undefined,
    };
    expect(getContextText(r)).toBe('commit');
  });

  it('Skill, payload 동반(args) → payload 의 args 우선', () => {
    const r = {
      id: '1', type: 'tool_call', tool_name: 'Skill',
      tool_detail: 'commit', preview: 'preview-값',
      payload: JSON.stringify({ tool_input: { skill: 'commit', args: 'payload-args' } }),
    };
    expect(getContextText(r)).toBe('payload-args');
  });

  it('Agent, payload 없음, preview=description → preview 사용', () => {
    const r = {
      id: '1', type: 'tool_call', tool_name: 'Agent',
      tool_detail: 'general-purpose', preview: '네이밍 분석 루프 설계', payload: undefined,
    };
    expect(getContextText(r)).toBe('네이밍 분석 루프 설계');
  });

  it('Bash 는 preview 와 무관하게 tool_detail(명령어) 사용 — 회귀 없음', () => {
    const r = {
      id: '1', type: 'tool_call', tool_name: 'Bash',
      tool_detail: 'ls -la', preview: undefined, payload: undefined,
    };
    expect(getContextText(r)).toBe('ls -la');
  });
});

describe('fullDetailFromPayload — 펼침 전체 본문 (slice 없음)', () => {
  it('Skill: args 전체', () => {
    const p = JSON.stringify({ tool_input: { skill: 'commit', args: '아주 긴 args 전체 지시문' } });
    expect(fullDetailFromPayload(p)).toBe('아주 긴 args 전체 지시문');
  });

  it('Agent: prompt(긴 지시문) 우선 — description(짧은 요약)보다 앞', () => {
    const p = JSON.stringify({ tool_input: { subagent_type: 'cc-docs', description: '배치 분류', prompt: '분석 전용 작업이다. 파일을 절대 Edit/Write 하지 말고...' } });
    expect(fullDetailFromPayload(p)).toBe('분석 전용 작업이다. 파일을 절대 Edit/Write 하지 말고...');
  });

  it('Agent: prompt 없으면 description 폴백', () => {
    const p = JSON.stringify({ tool_input: { subagent_type: 'Explore', description: '요약만 있음' } });
    expect(fullDetailFromPayload(p)).toBe('요약만 있음');
  });

  it('tool_input 없음(prompt/response payload)은 null → cached 유지', () => {
    expect(fullDetailFromPayload(JSON.stringify({ role: 'user', content: 'x' }))).toBeNull();
    expect(fullDetailFromPayload(undefined)).toBeNull();
    expect(fullDetailFromPayload('not-json{')).toBeNull();
  });
});
