/**
 * TargetCell — Skill/Agent 의 TARGET 셀에 모델명을 노출하지 않음을 고정.
 *
 * MODEL 컬럼이 이미 모델을 보여주므로 TARGET 의 `Skill(이름) <모델>` 중복을 제거했다.
 * 이름(action-sub-name)은 유지, action-model(모델명)은 제거.
 *
 * @see packages/web/src/components/render/cells.tsx (targetInner)
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TargetCell } from '../index';

const tool_call = (toolName: string, toolDetail: string, model: string | null) => ({
  id: 'r1', type: 'tool_call', tool_name: toolName, tool_detail: toolDetail,
  model, event_type: 'tool',
});

describe('TargetCell — Skill/Agent 모델명 미노출', () => {
  it('Skill: action-sub-name(이름) 유지, action-model(모델명) 제거', () => {
    const html = renderToStaticMarkup(<TargetCell r={tool_call('Skill', 'handoff', 'claude-sonnet-4-6')} />);
    expect(html).toContain('action-sub-name');
    expect(html).toContain('handoff');
    expect(html).not.toContain('action-model');
    expect(html).not.toContain('claude-sonnet-4-6');
  });

  it('Agent: action-sub-name(이름) 유지, action-model(모델명) 제거', () => {
    const html = renderToStaticMarkup(<TargetCell r={tool_call('Agent', 'architect', 'claude-sonnet-4-6')} />);
    expect(html).toContain('action-sub-name');
    expect(html).toContain('architect');
    expect(html).not.toContain('action-model');
    expect(html).not.toContain('claude-sonnet-4-6');
  });
});
