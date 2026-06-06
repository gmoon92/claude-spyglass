/**
 * llm-input-chat-model.test.ts — 대화형 순수 변환 SSoT 검증 (payload-chat-redesign)
 *
 * toChatModel/groupParallelActions 가 API 원본 messages[] 를 채팅 아이템으로 올바르게 변환하는지:
 *  - text/thinking/tool_use/tool_result 4종 위계 매핑
 *  - tool_result 의 tool_use_id 페어링(인접 가정 금지 — 병렬 호출 안전)
 *  - 짝 못 찾은 tool_result → orphan(숨기지 않음)
 *  - redacted_thinking 잠금 분기
 *  - is_error 직독(이 소스의 SSoT)
 *  - 원본 순서(msgIndex) 보존
 *  - 병렬 action 그룹핑
 */
import { describe, it, expect } from 'vitest';
import {
  toChatModel,
  groupParallelActions,
  inspectorPayloadOf,
  lastInspectablePayload,
  type ChatItem,
} from '../llm-input-chat-model';

/** i18n 스텁 — 라벨 키를 그대로 반환(번역 무관 구조 검증). */
const tStub = (k: string): string => k;

describe('toChatModel', () => {
  it('문자열 content → text 아이템(role 보존)', () => {
    const items = toChatModel([{ role: 'user', content: '안녕' }]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'text', role: 'user', text: '안녕', msgIndex: 0 });
  });

  it('thinking → think 아이템(role 강제 assistant), redacted 잠금 분기', () => {
    const items = toChatModel([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '속생각', signature: 'sig' },
          { type: 'redacted_thinking', data: 'blob' },
        ],
      },
    ]);
    expect(items[0]).toMatchObject({ kind: 'think', role: 'assistant', text: '속생각', redacted: false });
    expect(items[1]).toMatchObject({ kind: 'think', redacted: true });
    expect(items[1].text).toBe(''); // redacted 는 본문 없음
  });

  it('tool_use → action, 같은 메시지 다중은 병렬', () => {
    const items = toChatModel([
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_A', name: 'Grep', input: { pattern: 'x' } },
          { type: 'tool_use', id: 'toolu_B', name: 'Read', input: { file_path: 'a.ts' } },
        ],
      },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'action', toolName: 'Grep', toolUseId: 'toolu_A', result: null });
    expect(items[1]).toMatchObject({ kind: 'action', toolName: 'Read', toolUseId: 'toolu_B' });
  });

  it('tool_result 는 tool_use_id 로 귀속(인접 순서가 아니라 id) — 병렬 결과 역순도 정확', () => {
    const items = toChatModel([
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_A', name: 'Grep' },
          { type: 'tool_use', id: 'toolu_B', name: 'Read' },
        ],
      },
      {
        role: 'user',
        content: [
          // 결과가 역순으로 와도 id 로 정확히 매칭
          { type: 'tool_result', tool_use_id: 'toolu_B', content: 'file body' },
          { type: 'tool_result', tool_use_id: 'toolu_A', content: 'match.ts', is_error: false },
        ],
      },
    ]);
    const actions = items.filter((i): i is ChatItem => i.kind === 'action');
    const grep = actions.find((a) => a.toolUseId === 'toolu_A');
    const read = actions.find((a) => a.toolUseId === 'toolu_B');
    expect(grep?.result?.toolUseId).toBe('toolu_A');
    expect(grep?.result?.preview).toContain('match.ts');
    expect(read?.result?.toolUseId).toBe('toolu_B');
    // tool_result 는 독립 아이템으로 추가되지 않는다(귀속됨)
    expect(items.filter((i) => i.kind === 'orphan-result')).toHaveLength(0);
  });

  it('is_error=true 직독 → result.isError', () => {
    const items = toChatModel([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_C', name: 'Bash' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_C', content: 'boom', is_error: true }] },
    ]);
    const action = items.find((i) => i.kind === 'action');
    expect(action?.result?.isError).toBe(true);
  });

  it('짝 tool_use 없는 tool_result → orphan(숨기지 않음)', () => {
    const items = toChatModel([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_ghost', content: '고아' }] },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'orphan-result', toolUseId: 'toolu_ghost' });
    expect(items[0].result?.isError).toBe(false);
  });

  it('알 수 없는 part/빈 content → unknown 폴백', () => {
    const items = toChatModel([
      { role: 'assistant', content: [{ type: 'image', source: {} }] },
      { role: 'user', content: null },
    ]);
    expect(items[0]).toMatchObject({ kind: 'unknown', partType: 'image' });
    expect(items[1]).toMatchObject({ kind: 'unknown', partType: 'empty' });
  });

  it('원본 배열 순서(msgIndex) 보존', () => {
    const items = toChatModel([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
    ]);
    expect(items.map((i) => i.msgIndex)).toEqual([0, 1]);
  });
});

describe('groupParallelActions', () => {
  it('같은 msgIndex 의 연속 action 2개 이상 → action-group', () => {
    const items = toChatModel([
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_A', name: 'Grep' },
          { type: 'tool_use', id: 'toolu_B', name: 'Read' },
        ],
      },
    ]);
    const grouped = groupParallelActions(items);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ kind: 'action-group', msgIndex: 0 });
    if ('actions' in grouped[0]) expect(grouped[0].actions).toHaveLength(2);
  });

  it('단일 action 은 그룹 없이 그대로', () => {
    const items = toChatModel([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_A', name: 'Grep' }] },
    ]);
    const grouped = groupParallelActions(items);
    expect(grouped[0]).toMatchObject({ kind: 'action' });
  });
});

describe('inspectorPayloadOf', () => {
  it('text 아이템 → 전문 text + 원본 JSON, 화자 라벨', () => {
    const [item] = toChatModel([{ role: 'assistant', content: '긴 답변 본문' }]);
    const p = inspectorPayloadOf(item, tStub);
    expect(p.text).toBe('긴 답변 본문');
    expect(p.raw).toContain('"role"'); // 원본 message JSON
    expect(p.meta).toContain('#1');
  });

  it('action 아이템 → input + result preview 를 전문에 합성(지어내지 않음)', () => {
    const items = toChatModel([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'a.ts' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '파일 내용', is_error: false }] },
    ]);
    const p = inspectorPayloadOf(items[0], tStub);
    expect(p.title).toBe('Read');
    expect(p.text).toContain('a.ts'); // input
    expect(p.text).toContain('파일 내용'); // result preview
  });

  it('redacted think → 본문 대신 잠금 라벨 키', () => {
    const items = toChatModel([{ role: 'assistant', content: [{ type: 'redacted_thinking', data: 'blob' }] }]);
    const p = inspectorPayloadOf(items[0], tStub);
    expect(p.text).toBe('ui.llm-input.chat.thinking-redacted-body');
  });
});

describe('lastInspectablePayload', () => {
  it('마지막 렌더 항목의 페이로드(없으면 null)', () => {
    expect(lastInspectablePayload([], tStub)).toBeNull();
    const items = groupParallelActions(
      toChatModel([
        { role: 'user', content: '첫 질문' },
        { role: 'assistant', content: '마지막 답변' },
      ]),
    );
    expect(lastInspectablePayload(items, tStub)?.text).toBe('마지막 답변');
  });

  it('마지막이 병렬 action 그룹이면 그룹의 마지막 action', () => {
    const items = groupParallelActions(
      toChatModel([
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'a.ts' } },
            { type: 'tool_use', id: 'toolu_2', name: 'Grep', input: { pattern: 'foo' } },
          ],
        },
      ]),
    );
    expect(lastInspectablePayload(items, tStub)?.title).toBe('Grep');
  });
});
