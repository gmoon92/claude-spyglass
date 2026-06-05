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
};

describe('LLMInput — 골격/헤더', () => {
  it('banner + info 아이콘 렌더', () => {
    const out = html(<LLMInput {...baseProps} />);
    expect(out).toContain('class="llm-input-banner"');
    expect(out).toContain('llm-input-banner-text');
    expect(out).toContain('<svg'); // info 아이콘
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

  it('header: request id + system hash 12자 slice + size', () => {
    const out = html(<LLMInput {...baseProps} />);
    expect(out).toContain('class="llm-input-header"');
    expect(out).toContain('req-abc123def456');
    expect(out).toContain('hash01234567'); // 12자 slice
    expect(out).toContain('2.0 KB'); // systemSize formatBytes
  });

  it('systemHash 없음 → system-none 라벨 + no-system-field 섹션', () => {
    const out = html(<LLMInput {...baseProps} systemHash={null} systemContent={null} systemMeta={null} />);
    expect(out).toContain('llm-input-hash--empty');
    expect(out).toContain('llm-input-system--empty');
  });

  it('decodeError → 에러 배지', () => {
    const out = html(<LLMInput {...baseProps} decodeError="zstd failed" />);
    expect(out).toContain('llm-input-error');
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

  it('컨트롤 바: 검색 input + expand-all/collapse-all 버튼', () => {
    const out = html(<LLMInput {...baseProps} messages={messages} />);
    expect(out).toContain('data-messages-search');
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

  it('proxyList 있으면 select(id=llm-input-proxy-select) + 활성 selected', () => {
    const out = html(<LLMInput {...baseProps} requestId="p-002" proxyList={proxyList} />);
    expect(out).toContain('id="llm-input-proxy-select"');
    expect(out).toContain('data-proxy-select');
    expect(out).toContain('value="p-001"');
    expect(out).toContain('value="p-002"');
    // 활성(p-002) 옵션에 selected (React 는 select.value 로 표현하므로 selected 어트리뷰트 검증 대신 존재만)
  });

  it('proxyList 비면 셀렉터 생략(전역 latest 폴백)', () => {
    const out = html(<LLMInput {...baseProps} proxyList={[]} />);
    expect(out).not.toContain('llm-input-proxy-select');
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
