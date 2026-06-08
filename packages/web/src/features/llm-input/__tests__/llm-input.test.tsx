/**
 * llm-input.test.tsx — LLMInput TSX 렌더/계약 검증 (대화 뷰 단일화 후)
 *
 * raw(원본) 아코디언 뷰는 폐기됨 — LLMInput 은 항상 대화(chat) 뷰를 렌더한다.
 * 본 파일은 (1) a-head 헤더 계약(proxy 칩·req/system 핀 칩·검색·banner), (2) 대화 뷰 골격
 * (chat-room/shell/인스펙터/리사이저), (3) 검색 하이라이트(좌 타임라인 + 우 인스펙터 공용)를 검증한다.
 * 세부 대화 모델(말풍선/행동카드/사고거품)은 llm-input-chat-model.test.ts + ChatRoom 가 담당.
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

describe('LLMInput — a-head 헤더', () => {
  it('banner(a-sub 접이판) + info(?) 아이콘 렌더', () => {
    const out = html(<LLMInput {...baseProps} />);
    expect(out).toContain('llm-input-asub-banner');
    expect(out).toContain('<svg'); // ? help 아이콘(Info)
  });

  it('banner 텍스트에 <strong> 이 포함되면 escape 되지 않고 실제 태그로 렌더 (결함 #1)', () => {
    globalThis.__setTestT?.((k) =>
      k === 'ui:llm-input.banner-text'
        ? '이 탭은 proxy가 전송한 <strong>원본 페이로드</strong>입니다.'
        : k,
    );
    try {
      const out = html(<LLMInput {...baseProps} />);
      expect(out).toContain('<strong>원본 페이로드</strong>');
      expect(out).not.toContain('&lt;strong&gt;');
    } finally {
      globalThis.__resetTestT?.();
    }
  });

  it('a-bar 메타: req 칩(full id data-tip) + system 핀 칩(seg·size + ref 버튼)', () => {
    const out = html(<LLMInput {...baseProps} />);
    expect(out).toContain('llm-input-abar-meta');
    expect(out).toContain('req-abc123def456'); // req 칩 data-tip(full id)
    // system 핀 칩 — seg·size 요약 + ref 버튼(hash 계약)
    expect(out).toContain('llm-input-syspin');
    expect(out).toContain('seg 3');
    expect(out).toContain('2.0 KB');
    expect(out).toContain('data-refs-hash="hash0123456789abcdef"');
    expect(out).toContain('ref 5');
  });

  it('systemHash 없음 → system 핀 칩 자리에 pill--empty', () => {
    const out = html(<LLMInput {...baseProps} systemHash={null} systemContent={null} systemMeta={null} />);
    expect(out).toContain('pill--empty');
    // raw 전용 no-system 섹션은 더 이상 렌더되지 않음
    expect(out).not.toContain('llm-input-system--empty');
  });

  it('decodeError → a-bar 에러 칩', () => {
    const out = html(<LLMInput {...baseProps} decodeError="zstd failed" />);
    expect(out).toContain('pill--err');
  });

  it('대화/원본 뷰 토글 마크업은 제거됨', () => {
    const out = html(<LLMInput {...baseProps} />);
    expect(out).not.toContain('llm-input-view-toggle');
    expect(out).not.toContain('data-view="raw"');
  });
});

describe('LLMInput — proxy 셀렉터(세션 데이터 props)', () => {
  const proxyList = [
    { id: 'p-001', timestamp: 1, model: 'claude-3-5-sonnet', tokens_input: 100, tokens_output: 50 },
    { id: 'p-002', timestamp: 2, model: 'claude-3-5-haiku', tokens_input: 10, tokens_output: 5 },
  ];

  it('proxyList 있으면 a-bar proxy 칩(숨은 select) + 활성 selected', () => {
    const out = html(<LLMInput {...baseProps} requestId="p-002" proxyList={proxyList} />);
    expect(out).toContain('llm-input-abar-proxy');
    expect(out).toContain('data-proxy-select');
    expect(out).toContain('value="p-001"');
    expect(out).toContain('value="p-002"');
  });

  it('proxyList 비면 칩 생략(전역 latest 폴백)', () => {
    const out = html(<LLMInput {...baseProps} proxyList={[]} />);
    expect(out).not.toContain('llm-input-abar-proxy');
  });
});

describe('LLMInput — 대화(chat) 뷰 골격', () => {
  it('항상 chat-room + 7:3 shell + 상시 인스펙터 + 리사이저, raw 아코디언 부재', () => {
    const messages: MessageLike[] = [
      { role: 'user', content: '첫 질문' },
      { role: 'assistant', content: '마지막 답변 본문' },
    ];
    const out = html(<LLMInput {...baseProps} messages={messages} />);
    expect(out).toContain('class="chat-room"');
    expect(out).toContain('chat-shell');
    expect(out).toContain('chat-inspector');
    expect(out).toContain('chat-resizer');
    expect(out).toContain('chat-inspector-body');
    // raw 전용 마크업 부재
    expect(out).not.toContain('llm-input-messages-list');
    // 인스펙터 자체 검색박스 제거(헤더 검색으로 일원화)
    expect(out).not.toContain('chat-inspector-search');
    // 진입 기본값 = 마지막 항목 → 인스펙터에 마지막 답변 노출(empty 아님)
    expect(out).not.toContain('chat-inspector-body--empty');
    expect(out).toContain('마지막 답변 본문');
  });

  it('tool_use → 행동 카드, tool_result 는 결과 칩으로 귀속(user 말풍선 아님)', () => {
    const messages: MessageLike[] = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'a.ts' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok', is_error: false }] },
    ];
    const out = html(<LLMInput {...baseProps} messages={messages} />);
    expect(out).toContain('chat-action');
    expect(out).toContain('chat-result--ok');
    expect(out).toContain('toolu_1');
    expect(out).not.toContain('chat-bubble--me');
  });

  it('thinking → 사고 거품, redacted 는 잠금 분기(signature 미노출)', () => {
    const messages: MessageLike[] = [
      { role: 'assistant', content: [
        { type: 'thinking', thinking: '속으로 생각', signature: 'sig' },
        { type: 'redacted_thinking', data: 'blob' },
      ] },
    ];
    const out = html(<LLMInput {...baseProps} messages={messages} />);
    expect(out).toContain('chat-think');
    expect(out).toContain('chat-think--locked');
    expect(out).not.toContain('sig');
  });

  it('메시지 0건 → no-messages 폴백(타임라인)', () => {
    const out = html(<LLMInput {...baseProps} messages={[]} />);
    expect(out).toContain('chat-room');
    expect(out).toContain('no-messages');
  });

  it('typing=true → 타임라인 하단 타이핑 버블(점 애니메이션) 렌더', () => {
    const messages: MessageLike[] = [{ role: 'assistant', content: '직전 답변' }];
    const off = html(<LLMInput {...baseProps} messages={messages} />);
    expect(off).not.toContain('chat-row--typing');
    const on = html(<LLMInput {...baseProps} messages={messages} typing />);
    expect(on).toContain('chat-row--typing');
    expect(on).toContain('chat-typing-dots');
  });

  it('거대 본문은 타임라인 행에 미리보기 cap 까지만 주입(전문은 인스펙터) — 렌더 비용 상한', () => {
    // 첫 메시지(거대)는 타임라인 행 → cap 슬라이스(꼬리 드롭). 마지막(소형)은 인스펙터 기본 노출.
    const messages: MessageLike[] = [
      { role: 'user', content: 'X'.repeat(4000) + 'NEEDLE_TAIL_MARKER' },
      { role: 'assistant', content: 'short last answer' },
    ];
    const out = html(<LLMInput {...baseProps} messages={messages} />);
    // 거대 행 꼬리 마커는 DOM 에 주입되지 않음(슬라이스) — 전체 4018자 통째 렌더 회피
    expect(out).not.toContain('NEEDLE_TAIL_MARKER');
    // 잘림 표식(…) 존재
    expect(out).toContain('…');
    // 인스펙터 기본값 = 마지막 소형 항목
    expect(out).toContain('short last answer');
  });
});

describe('LLMInput — 검색 하이라이트(initialSearch prop 경유, 좌/우 공용)', () => {
  it('initialSearch 매칭 → 타임라인 + 인스펙터 본문 모두 mark.llm-input-mark', () => {
    const messages: MessageLike[] = [{ role: 'assistant', content: 'the needle in haystack' }];
    const out = html(<LLMInput {...baseProps} messages={messages} initialSearch="needle" />);
    // 최소 2곳(타임라인 본문 + 인스펙터 기본 노출 본문)에 mark 출현
    expect(out).toContain('<mark class="llm-input-mark">needle</mark>');
    expect(out.match(/llm-input-mark/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('initialSearch < MIN_LEN 은 하이라이트 없음', () => {
    const messages: MessageLike[] = [{ role: 'assistant', content: 'the needle in haystack' }];
    const out = html(<LLMInput {...baseProps} messages={messages} initialSearch="n" />);
    expect(out).not.toContain('llm-input-mark');
  });
});
