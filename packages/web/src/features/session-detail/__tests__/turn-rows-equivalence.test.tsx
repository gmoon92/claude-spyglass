/**
 * turn-rows-equivalence.test.tsx — TurnRows TSX ↔ 원본 makeTurnLogRows 출력 동치 (P3-05)
 *
 * 골든마스터 보호:
 *  - oracle = assets/js/session-detail/turn-rows.js#makeTurnLogRows (병존, 무수정).
 *  - 신규 TSX TurnRows 의 renderToStaticMarkup 결과가 oracle HTML 과 정규화 후 동치임을 증명.
 *
 * 정규화(renderers-equivalence.test.tsx 와 동일 철학 + 속성순서 무시):
 *  - self-close 통일 / 공백·줄바꿈 축약 / HTML 엔티티 디코드 / 속성명 소문자화.
 *  - 추가: **태그 내 속성을 이름순 정렬** — 원본 injectChipKey 는 data-chip-key 를 `<tr `
 *    첫 속성으로 삽입(turn-rows.js:323)하지만, RequestRow 는 chipKey 를 className 앞에 두므로
 *    위치가 다를 수 있다. HTML 속성 순서는 spec 상 무의미하므로 정렬로 흡수(동치의 충분조건).
 *  - 거짓통과 가드로 "구조/속성/값 차이는 여전히 잡힘"을 별도 증명.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { TurnRows } from '../TurnRows';
// oracle — 원본 JS(병존, 무수정).
import { makeTurnLogRows } from '../../../../assets/js/session-detail/turn-rows.js';

const NOW_FIXED_MS = new Date('2026-05-04T10:00:00Z').getTime();
const originalDateNow = Date.now;

beforeAll(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.I18n = {
    t: (key: string, vars?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'session.rows.empty-message': '메시지 없음',
        'badges.renderers.tool-status.error': '오류',
        'badges.renderers.model.unknown': '모델불명',
        'badges.renderers.model.synthetic': 'SDK 합성',
        'badges.renderers.model.no-info': '모델 정보 없음',
      };
      return map[key] ?? key;
    },
  };
  Date.now = () => NOW_FIXED_MS;
});

afterAll(() => {
  Date.now = originalDateNow;
});

// ── 정규화 ────────────────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** 단일 시작 태그의 속성을 이름순 정렬(값 보존). */
function sortAttrsInTag(tag: string): string {
  // tag 예: '<tr data-chip-key="x" class="y" data-type="z">'
  const m = tag.match(/^<([a-zA-Z][\w-]*)\s+([\s\S]*?)(\/?)>$/);
  if (!m) return tag;
  const [, name, attrBody, selfClose] = m;
  const attrs = attrBody.match(/[a-zA-Z][\w-]*(="[^"]*")?/g) ?? [];
  const sorted = attrs
    .map((a) => a.trim())
    .filter(Boolean)
    .sort();
  return `<${name}${sorted.length ? ' ' + sorted.join(' ') : ''}${selfClose}>`;
}

function normalizeHtml(s: string): string {
  const decoded = decodeEntities(
    s
      .replace(/<([a-zA-Z]+)([^<>]*?)\/>/g, '<$1$2></$1>')
      .replace(/>\s+</g, '><')
      .replace(/\s+/g, ' ')
      .replace(/\s+>/g, '>')
      .replace(/(\s)([a-zA-Z][a-zA-Z0-9-]*)(=)/g, (_m, sp, nm, eq) => `${sp}${nm.toLowerCase()}${eq}`)
      .trim(),
  );
  // 시작 태그마다 속성 정렬(닫는 태그/텍스트는 보존).
  return decoded.replace(/<[a-zA-Z][\w-]*\s[^<>]*?>/g, (tag) => sortAttrsInTag(tag));
}

const tsx = (el: Parameters<typeof renderToStaticMarkup>[0]) => normalizeHtml(renderToStaticMarkup(el));
const js = (s: string) => normalizeHtml(s);

// ── fixtures ────────────────────────────────────────────────────────────────

function prompt(id: string, turn_id = 't1') {
  return {
    id,
    type: 'prompt',
    session_id: 's1',
    turn_id,
    tokens_input: 200,
    tokens_output: 0,
    timestamp: '2026-04-28T10:00:00Z',
    model: 'claude-3-5-sonnet',
    duration_ms: 50,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
  };
}

function tool(id: string, tool_name = 'Read', extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'tool_call',
    session_id: 's1',
    turn_id: 't1',
    tokens_input: 0,
    tokens_output: 80,
    timestamp: '2026-04-28T10:01:00Z',
    model: null,
    tool_name,
    duration_ms: 120,
    ...extra,
  };
}

function response(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'response',
    session_id: 's1',
    turn_id: 't1',
    tokens_input: 0,
    tokens_output: 300,
    timestamp: '2026-04-28T10:02:00Z',
    model: 'claude-3-5-sonnet',
    duration_ms: 900,
    ...extra,
  };
}

// ── 동치 ──────────────────────────────────────────────────────────────────────

describe('TurnRows ≡ makeTurnLogRows (golden master)', () => {
  it('prompt 단독 (본문 없음)', () => {
    const turn: any = { prompt: prompt('p1'), items: [] };
    expect(tsx(<TurnRows turn={turn} />)).toBe(js(makeTurnLogRows(turn)));
  });

  it('items[] 인터리빙 (tool → response → tool)', () => {
    const turn: any = {
      prompt: prompt('p1'),
      items: [
        { kind: 'tool', request: tool('a1', 'Read') },
        { kind: 'response', request: response('r1') },
        { kind: 'tool', request: tool('a2', 'Bash') },
      ],
    };
    expect(tsx(<TurnRows turn={turn} />)).toBe(js(makeTurnLogRows(turn)));
  });

  it('items 미제공 → 폴백 시간순 머지(tool_calls + responses)', () => {
    const turn: any = {
      prompt: prompt('p1'),
      tool_calls: [tool('a1', 'Read', { timestamp: '2026-04-28T10:01:00Z' }), tool('a2', 'Edit', { timestamp: '2026-04-28T10:03:00Z' })],
      responses: [response('r1', { timestamp: '2026-04-28T10:02:00Z' })],
    };
    expect(tsx(<TurnRows turn={turn} />)).toBe(js(makeTurnLogRows(turn)));
  });

  it('showSession: true', () => {
    const turn: any = {
      prompt: prompt('p1'),
      items: [{ kind: 'tool', request: tool('a1', 'Read') }],
    };
    expect(tsx(<TurnRows turn={turn} showSession />)).toBe(js(makeTurnLogRows(turn, { showSession: true })));
  });

  it('anomalyFlags (spike + loop on tool, slow on response)', () => {
    const turn: any = {
      prompt: prompt('p1'),
      items: [
        { kind: 'tool', request: tool('a1', 'Bash', { duration_ms: 2500 }) },
        { kind: 'response', request: response('r1', { duration_ms: 4000 }) },
      ],
    };
    const flags = new Map<string, Set<string>>([
      ['a1', new Set(['spike', 'loop'])],
      ['r1', new Set(['slow'])],
    ]);
    expect(tsx(<TurnRows turn={turn} anomalyFlags={flags} />)).toBe(
      js(makeTurnLogRows(turn, { anomalyFlags: flags })),
    );
  });

  it('chip-key 6분기 (agent/skill/mcp/task/tool/response) 모두 행에 주입', () => {
    const turn: any = {
      prompt: prompt('p1'),
      items: [
        { kind: 'tool', request: tool('a1', 'Agent', { tool_detail: 'researcher' }) },
        { kind: 'tool', request: tool('a2', 'Skill', { tool_detail: 'commit' }) },
        { kind: 'tool', request: tool('a3', 'mcp__redmine__getIssue') },
        { kind: 'tool', request: tool('a4', 'TaskUpdate', { tool_detail: 'Task #6 fix', payload: { tool_input: { taskId: 6, status: 'done' } } }) },
        { kind: 'tool', request: tool('a5', 'Write') },
        { kind: 'response', request: response('r1') },
      ],
    };
    expect(tsx(<TurnRows turn={turn} />)).toBe(js(makeTurnLogRows(turn)));
  });

  it('turn 없음 → null (oracle 은 빈 문자열)', () => {
    expect(tsx(<TurnRows turn={null} />)).toBe(js(makeTurnLogRows(null as any)));
  });
});

// ── 거짓통과 가드 ──────────────────────────────────────────────────────────────

describe('정규화 거짓통과 가드 — 의도적 변형은 잡혀야 한다', () => {
  const turn: any = {
    prompt: prompt('p1'),
    items: [{ kind: 'tool', request: tool('a1', 'Read') }],
  };
  const base = () => makeTurnLogRows(turn);

  it('data-chip-key 값 변형 시 불일치', () => {
    const b = base();
    const mutated = b.replace('data-chip-key="tool:Read"', 'data-chip-key="tool:ReadX"');
    expect(js(mutated)).not.toBe(js(b));
  });

  it('행 개수 차이(prompt 행 제거) 시 불일치', () => {
    const b = base();
    const mutated = b.replace(/<tr[^>]*data-type="prompt"[\s\S]*?<\/tr>/, '');
    expect(js(mutated)).not.toBe(js(b));
  });

  it('속성 정렬은 순서차만 흡수(동일 속성 집합은 일치)', () => {
    expect(js('<tr data-chip-key="k" class="c" data-type="t"></tr>')).toBe(
      js('<tr class="c" data-type="t" data-chip-key="k"></tr>'),
    );
    // 속성 값이 다르면 정렬해도 불일치
    expect(js('<tr class="c" data-type="t"></tr>')).not.toBe(js('<tr class="c" data-type="x"></tr>'));
  });
});
