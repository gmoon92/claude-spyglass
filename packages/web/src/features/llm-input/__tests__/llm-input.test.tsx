/**
 * llm-input.test.tsx — LLMInput TSX 렌더/계약 검증 (P3-08, TDD)
 *
 * 원본: assets/js/llm-input-view.js 의 renderHtml/renderSystemSection/renderMessagesSection/
 * renderMessageDetails/renderProxySelector 가 생성하던 HTML 을 선언적 컴포넌트로 이식한 것을
 * renderToStaticMarkup 로 검증한다(turn-rows-equivalence.test.tsx 와 동일 러너 패턴).
 *
 * 셀렉터 계약(architecture.md §2.2 "DOM id/class/data-* 1:1 유지") 보존을 명시 검증:
 *  - llm-input-banner / llm-input-header / data-proxy-select / llm-input-system(details)
 *  - data-messages-search / data-action=expand-all|collapse-all
 *  - 각 메시지 details: data-message-id / data-message-role / llm-input-msg--<role> / open(system)
 *  - ref_count 칩: data-refs-hash + aria-expanded
 *  - 검색 하이라이트: <mark class="llm-input-mark">
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LLMInput } from '../LLMInput';
import type { MessageLike } from '../llm-input-state';

beforeAll(() => {
  // i18n 기본 t(passthrough)는 vitest.setup 가 담당 — window 만 보장(루트 bun test 대응).
  (globalThis as any).window = (globalThis as any).window ?? {};
});

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

const baseProps = {
  requestId: 'req-abc123def456',
  systemHash: 'hash0123456789abcdef',
  systemSize: 2048,
  systemContent: 'You are a helpful assistant.\nFollow the rules.',
  systemMeta: { segment_count: 3, byte_size: 2048, ref_count: 5 },
  messages: [] as MessageLike[],
  decodeError: null as string | null,
  // 본 파일은 'raw'(현행 아코디언) 뷰의 셀렉터 계약을 검증한다(payload-chat-redesign 후 기본은 'chat').
  //   대화형 뷰 동작은 llm-input-chat-model.test.ts + ChatRoom 가 담당.
  initialViewMode: 'raw' as const,
};

describe('LLMInput — 골격/헤더', () => {
  it('banner(a-sub 접이판) + info(?) 아이콘 렌더', () => {
    const out = html(<LLMInput {...baseProps} />);
    // banner 안내는 a-head 의 a-sub(? 토글) 안으로 이동(payload-chat-redesign 2차).
    expect(out).toContain('llm-input-asub-banner');
    expect(out).toContain('<svg'); // ? help 아이콘(Info)
  });

  it('banner 텍스트에 <strong> 이 포함되면 escape 되지 않고 실제 태그로 렌더 (결함 #1)', () => {
    // 레거시 i18n 키(ui.llm-input.banner-text)는 <strong> 강조 태그를 포함한다.
    // 기본 텍스트 보간은 이를 escape 해 `&lt;strong&gt;` 문자로 노출(버그). dangerouslySetInnerHTML 로 복원.
    globalThis.__setTestT?.((k) =>
      k === 'ui.llm-input.banner-text'
        ? '이 탭은 proxy가 전송한 <strong>원본 페이로드</strong>입니다.'
        : k,
    );
    try {
      const out = html(<LLMInput {...baseProps} />);
      // 실제 <strong> 엘리먼트로 렌더 — escape 된 &lt;strong&gt; 가 아님.
      expect(out).toContain('<strong>원본 페이로드</strong>');
      expect(out).not.toContain('&lt;strong&gt;');
    } finally {
      globalThis.__resetTestT?.();
    }
  });

  it('a-bar 메타 칩: request id + system hash(data-tip) + size', () => {
    const out = html(<LLMInput {...baseProps} />);
    expect(out).toContain('llm-input-abar-meta');
    expect(out).toContain('req-abc123def456'); // req 칩 data-tip(full id)
    expect(out).toContain('hash01234567'); // sys 칩 data-tip 12자 slice
    expect(out).toContain('2.0 KB'); // systemSize formatBytes
  });

  it('systemHash 없음 → a-bar pill--empty + chat-pin/no-system-field 섹션', () => {
    const out = html(<LLMInput {...baseProps} systemHash={null} systemContent={null} systemMeta={null} />);
    expect(out).toContain('pill--empty'); // a-bar 빈 system 칩
    expect(out).toContain('llm-input-system--empty'); // raw 뷰 no-system 섹션
  });

  it('decodeError → a-bar 에러 칩', () => {
    const out = html(<LLMInput {...baseProps} decodeError="zstd failed" />);
    expect(out).toContain('pill--err');
  });
});

describe('LLMInput — system 섹션 (scroll 점유 토글)', () => {
  it('content 있으면 details(기본 펼침) + meta 칩 + ref_count 버튼', () => {
    const out = html(<LLMInput {...baseProps} />);
    expect(out).toContain('class="llm-input-system"');
    expect(out).toMatch(/<details[^>]*class="llm-input-system"[^>]*open/);
    expect(out).toContain('segment_count: 3');
    expect(out).toContain('byte_size: 2.0 KB');
    // ref_count 칩: 계약 속성
    expect(out).toContain('data-refs-hash="hash0123456789abcdef"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('ref_count: 5');
    // 본문 노출(escape 는 React 자동)
    expect(out).toContain('You are a helpful assistant.');
  });

  it('content 없음(hash 있으나 fetch 실패) → system--loading', () => {
    const out = html(<LLMInput {...baseProps} systemContent={null} />);
    expect(out).toContain('llm-input-system--loading');
  });
});

describe('LLMInput — messages 아코디언', () => {
  const messages: MessageLike[] = [
    { role: 'system', content: 'system msg' },
    { role: 'user', content: 'find the needle here' },
    { role: 'assistant', content: [{ type: 'text', text: 'sure' }, { type: 'tool_use', name: 'Read' }] },
  ];

  it('메시지 0건 → no-messages 폴백', () => {
    const out = html(<LLMInput {...baseProps} messages={[]} />);
    expect(out).toContain('llm-input-messages');
    expect(out).toContain('Messages (0)');
    expect(out).toContain('no-messages');
  });

  it('컨트롤 바: 검색(a-bar 일원화) + expand-all/collapse-all 버튼', () => {
    const out = html(<LLMInput {...baseProps} messages={messages} />);
    // 검색은 상단 a-bar 로 일원화 — raw 컨트롤바는 펼침/접기만.
    expect(out).toContain('feed-search-input'); // a-bar 검색 입력
    expect(out).toContain('data-action="expand-all"');
    expect(out).toContain('data-action="collapse-all"');
    expect(out).toContain('Messages (3)');
  });

  it('각 메시지 details: data-message-id / role / class', () => {
    const out = html(<LLMInput {...baseProps} messages={messages} />);
    expect(out).toContain('data-message-id="m-0"');
    expect(out).toContain('data-message-id="m-1"');
    expect(out).toContain('data-message-id="m-2"');
    expect(out).toContain('data-message-role="system"');
    expect(out).toContain('llm-input-msg--user');
    expect(out).toContain('llm-input-msg--assistant');
  });

  it('system role 메시지는 open, 그 외는 collapsed (초기 선언적 상태)', () => {
    const out = html(<LLMInput {...baseProps} messages={messages} />);
    // m-0(system) details 에 open
    expect(out).toMatch(/data-message-id="m-0"[^>]*open/);
    // m-1(user) details 에 open 없음
    const m1 = out.match(/<details[^>]*data-message-id="m-1"[^>]*>/)?.[0] ?? '';
    expect(m1).not.toContain('open');
  });

  it('summary: role + preview(100자) + idx, body: text pre', () => {
    const out = html(<LLMInput {...baseProps} messages={messages} />);
    expect(out).toContain('llm-input-msg-preview');
    expect(out).toContain('find the needle here'); // preview
    expect(out).toContain('#2'); // idx (m-1 → #2)
    expect(out).toContain('llm-input-msg-text'); // body pre
    expect(out).toContain('[tool_use]'); // 비-text 파트 라벨(preview)
  });
});

describe('LLMInput — proxy 셀렉터(세션 데이터 props)', () => {
  const proxyList = [
    { id: 'p-001', timestamp: 1, model: 'claude-3-5-sonnet', tokens_input: 100, tokens_output: 50 },
    { id: 'p-002', timestamp: 2, model: 'claude-3-5-haiku', tokens_input: 10, tokens_output: 5 },
  ];

  it('proxyList 있으면 a-bar proxy 칩(숨은 select) + 활성 selected', () => {
    const out = html(<LLMInput {...baseProps} requestId="p-002" proxyList={proxyList} />);
    expect(out).toContain('llm-input-abar-proxy'); // 칩 + 숨은 select 하이브리드
    expect(out).toContain('data-proxy-select');
    expect(out).toContain('value="p-001"');
    expect(out).toContain('value="p-002"');
  });

  it('proxyList 비면 칩 생략(전역 latest 폴백)', () => {
    const out = html(<LLMInput {...baseProps} proxyList={[]} />);
    expect(out).not.toContain('llm-input-abar-proxy');
  });
});

describe('LLMInput — 검색 하이라이트(선언적, initialSearch prop 경유)', () => {
  const messages: MessageLike[] = [{ role: 'user', content: 'the needle in haystack' }];

  it('initialSearch 매칭 시 body 에 mark.llm-input-mark + 자동 펼침', () => {
    const out = html(<LLMInput {...baseProps} messages={messages} initialSearch="needle" />);
    expect(out).toContain('<mark class="llm-input-mark">needle</mark>');
    // 매칭 메시지 m-0 자동 펼침
    expect(out).toMatch(/data-message-id="m-0"[^>]*open/);
  });

  it('initialSearch < MIN_LEN 은 하이라이트 없음', () => {
    const out = html(<LLMInput {...baseProps} messages={messages} initialSearch="n" />);
    expect(out).not.toContain('llm-input-mark');
  });
});

describe('LLMInput — 대화형(chat) 뷰 (payload-chat-redesign 기본)', () => {
  const chatProps = { ...baseProps, initialViewMode: 'chat' as const };

  it('기본 viewMode=chat → chat-room + 토글(대화 pressed) 렌더, raw 아코디언 부재', () => {
    const out = html(<LLMInput {...chatProps} />);
    expect(out).toContain('class="chat-room"');
    expect(out).toContain('llm-input-view-toggle');
    expect(out).toMatch(/data-view="chat" aria-pressed="true"/);
    // raw 전용 메시지 아코디언 마크업은 없어야 함
    expect(out).not.toContain('llm-input-messages-list');
  });

  it('tool_use → 행동 카드(tool_use 라벨), tool_result 는 user 말풍선이 아니라 결과 칩으로 귀속', () => {
    const messages: MessageLike[] = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'a.ts' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok', is_error: false }] },
    ];
    const out = html(<LLMInput {...chatProps} messages={messages} />);
    expect(out).toContain('chat-action');
    expect(out).toContain('chat-result--ok');
    expect(out).toContain('toolu_1');
    // tool_result-only user 메시지를 우측 user 말풍선으로 렌더하지 않음(1급 함정 차단)
    expect(out).not.toContain('chat-bubble--me');
  });

  it('thinking → 사고 거품(기본 접힘), redacted 는 잠금 분기', () => {
    const messages: MessageLike[] = [
      { role: 'assistant', content: [
        { type: 'thinking', thinking: '속으로 생각', signature: 'sig' },
        { type: 'redacted_thinking', data: 'blob' },
      ] },
    ];
    const out = html(<LLMInput {...chatProps} messages={messages} />);
    expect(out).toContain('chat-think');
    expect(out).toContain('chat-think--locked');
    expect(out).not.toContain('sig'); // signature 미노출
  });

  it('7:3 shell + 상시 인스펙터, 진입 시 타임라인 마지막 항목 기본 노출', () => {
    const messages: MessageLike[] = [
      { role: 'user', content: '첫 질문' },
      { role: 'assistant', content: '마지막 답변 본문' },
    ];
    const out = html(<LLMInput {...chatProps} messages={messages} />);
    expect(out).toContain('chat-shell'); // split grid
    expect(out).toContain('chat-inspector'); // 우측 상시 인스펙터
    expect(out).toContain('chat-resizer'); // 좌우 폭 리사이저
    expect(out).toContain('chat-inspector-body'); // 본문 영역
    // 진입 기본값 = 마지막 항목(lastInspectablePayload) → 인스펙터에 마지막 답변이 노출(empty 아님)
    expect(out).not.toContain('chat-inspector-body--empty');
    expect(out).toContain('마지막 답변 본문'); // 마지막 항목 전문이 인스펙터에 기본 노출
    // 말풍선은 클릭 가능 박스(button) — 클릭 시 인스펙터 표시(↗ 버튼 폐기).
    expect(out).toContain('ui.llm-input.chat.inspect-tip');
  });
});
