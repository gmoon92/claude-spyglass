/**
 * llm-input-state.test.ts — 아코디언 상태 전이 순수 로직 (P3-08, TDD Red→Green)
 *
 * 원본: assets/js/llm-input-view.js 의 명령형 상태(`state.expandedMessages: Set`,
 * `state.currentSearch`) + DOM-변이 핸들러(onAccordionChange/setAllExpanded/applySearchHighlight)
 * 를 선언적 순수 전이 함수로 정제한 것을 검증한다.
 *
 * 여기서 검증하는 전이가 곧 LLMInput.tsx 의 useState 핸들러가 호출하는 SSoT 로직이다
 * (재구현 없음 — 컴포넌트는 이 함수를 그대로 호출).
 *
 * 검증 대상(명령형 → 선언적 동치):
 *  - initialExpanded: 페이지 로드 시 system role 만 펼침(원본 renderMessageDetails isSystem open).
 *  - toggleExpanded: 개별 토글(원본 onAccordionChange details.open add/delete).
 *  - setAllExpanded: 전체 펼침/접기(원본 setAllExpanded — system 포함).
 *  - applySearchExpansion: 검색 매칭 자동 펼침(원본 applySearchHighlight — 매칭만 add, 미매칭 보존,
 *    <MIN_LEN 은 open 상태 불변).
 *  - previewFromContent / messageHaystack / formatBytes / splitHighlight 순수 헬퍼.
 */
import { describe, it, expect } from 'bun:test';
import {
  SUMMARY_PREVIEW_LEN,
  SEARCH_MIN_LEN,
  initialExpanded,
  toggleExpanded,
  setAllExpanded,
  applySearchExpansion,
  previewFromContent,
  messageHaystack,
  formatBytes,
  splitHighlight,
  type MessageLike,
} from '../llm-input-state';

const sys = (i: string): MessageLike => ({ role: 'system', content: `sys ${i}` });
const usr = (i: string): MessageLike => ({ role: 'user', content: `user ${i}` });
const asst = (i: string): MessageLike => ({ role: 'assistant', content: `asst ${i}` });

describe('initialExpanded — system role 만 펼침 (원본 isSystem open)', () => {
  it('system 메시지는 true, 그 외는 false', () => {
    const msgs = [usr('a'), sys('b'), asst('c')];
    expect(initialExpanded(msgs)).toEqual({ 'm-0': false, 'm-1': true, 'm-2': false });
  });

  it('빈 배열 → 빈 맵', () => {
    expect(initialExpanded([])).toEqual({});
  });

  it('role 누락 → false (system 아님)', () => {
    expect(initialExpanded([{ content: 'x' }])).toEqual({ 'm-0': false });
  });
});

describe('toggleExpanded — 개별 토글 (원본 onAccordionChange)', () => {
  it('false→true / true→false 불변 갱신', () => {
    const s = { 'm-0': false, 'm-1': true };
    const opened = toggleExpanded(s, 'm-0', true);
    expect(opened).toEqual({ 'm-0': true, 'm-1': true });
    expect(opened).not.toBe(s); // 새 객체(불변)
    const closed = toggleExpanded(opened, 'm-1', false);
    expect(closed).toEqual({ 'm-0': true, 'm-1': false });
  });
});

describe('setAllExpanded — 전체 펼침/접기 (원본 setAllExpanded, system 포함)', () => {
  const msgs = [usr('a'), sys('b'), asst('c')];
  it('전체 펼침: system 포함 모두 true', () => {
    expect(setAllExpanded(msgs, true)).toEqual({ 'm-0': true, 'm-1': true, 'm-2': true });
  });
  it('전체 접기: system 포함 모두 false', () => {
    expect(setAllExpanded(msgs, false)).toEqual({ 'm-0': false, 'm-1': false, 'm-2': false });
  });
});

describe('applySearchExpansion — 검색 자동 펼침 (원본 applySearchHighlight)', () => {
  const msgs: MessageLike[] = [
    { role: 'user', content: 'hello world' },
    { role: 'assistant', content: 'goodbye moon' },
    { role: 'user', content: 'WORLD again' },
  ];
  const allClosed = { 'm-0': false, 'm-1': false, 'm-2': false };

  it('매칭 메시지만 펼침 + 미매칭 이전 상태 보존', () => {
    const next = applySearchExpansion(allClosed, msgs, 'world');
    expect(next['m-0']).toBe(true); // 'hello world' 매칭
    expect(next['m-2']).toBe(true); // 'WORLD again' 대소문자 무시 매칭
    expect(next['m-1']).toBe(false); // 미매칭 → 보존
  });

  it('이미 열린 미매칭 메시지는 닫지 않음 (additive)', () => {
    const prior = { 'm-0': false, 'm-1': true, 'm-2': false };
    const next = applySearchExpansion(prior, msgs, 'world');
    expect(next['m-1']).toBe(true); // 미매칭이지만 이전 open 보존
  });

  it('< SEARCH_MIN_LEN 입력은 open 상태 불변(원본: highlight 만 제거)', () => {
    const prior = { 'm-0': true, 'm-1': false, 'm-2': false };
    expect(applySearchExpansion(prior, msgs, 'w')).toEqual(prior);
    expect(applySearchExpansion(prior, msgs, '')).toEqual(prior);
  });

  it('SEARCH_MIN_LEN 은 2', () => {
    expect(SEARCH_MIN_LEN).toBe(2);
  });
});

describe('previewFromContent — 미리보기 추출 (원본 previewFromContent)', () => {
  it('string: 공백 평탄화', () => {
    expect(previewFromContent('a\n  b\t c')).toBe('a b c');
  });
  it('빈 string → (empty)', () => {
    expect(previewFromContent('')).toBe('(empty)');
    expect(previewFromContent('   ')).toBe('(empty)');
  });
  it('array: text 파트 join, 비-text 는 [type] 라벨', () => {
    expect(
      previewFromContent([
        { type: 'text', text: 'hi' },
        { type: 'tool_use', name: 'X' },
      ]),
    ).toBe('hi [tool_use]');
  });
  it('100자 초과 → ellipsis', () => {
    const long = 'x'.repeat(SUMMARY_PREVIEW_LEN + 50);
    const out = previewFromContent(long);
    expect(out.length).toBe(SUMMARY_PREVIEW_LEN + 1); // 100 + '…'
    expect(out.endsWith('…')).toBe(true);
  });
  it('SUMMARY_PREVIEW_LEN 은 100', () => {
    expect(SUMMARY_PREVIEW_LEN).toBe(100);
  });
});

describe('messageHaystack — 검색 매칭 대상 텍스트', () => {
  it('preview + body text 결합(소문자)', () => {
    const h = messageHaystack({ role: 'user', content: 'Hello WORLD' });
    expect(h).toContain('hello world');
  });
  it('array content 의 text 파트 포함', () => {
    const h = messageHaystack({ role: 'user', content: [{ type: 'text', text: 'FindMe' }] });
    expect(h).toContain('findme');
  });
});

describe('formatBytes — 바이트 포맷 (원본 formatBytes)', () => {
  it('B / KB / MB 경계', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.00 MB');
  });
  it('비숫자 → 빈 문자열', () => {
    expect(formatBytes(NaN)).toBe('');
    expect(formatBytes(Infinity)).toBe('');
  });
});

describe('splitHighlight — 선언적 하이라이트 분절 (원본 highlightTextNodes 의 선언적 대응)', () => {
  it('매칭 구간을 mark:true 로 분절', () => {
    const segs = splitHighlight('a WORLD b world', 'world');
    expect(segs).toEqual([
      { text: 'a ', mark: false },
      { text: 'WORLD', mark: true },
      { text: ' b ', mark: false },
      { text: 'world', mark: true },
    ]);
  });
  it('term 없음/미매칭 → 단일 비-mark 세그먼트', () => {
    expect(splitHighlight('abc', '')).toEqual([{ text: 'abc', mark: false }]);
    expect(splitHighlight('abc', 'zzz')).toEqual([{ text: 'abc', mark: false }]);
  });
  it('대소문자 무시 매칭, 원문 대소문자 보존', () => {
    expect(splitHighlight('FooBar', 'foo')).toEqual([
      { text: 'Foo', mark: true },
      { text: 'Bar', mark: false },
    ]);
  });
});
