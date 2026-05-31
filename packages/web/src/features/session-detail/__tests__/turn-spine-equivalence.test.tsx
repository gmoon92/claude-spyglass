/**
 * turn-spine-equivalence.test.tsx — TurnSpine/TurnLine TSX ↔ 원본 renderSpine/turnLineHtml 동치 (P3-06)
 *
 * 골든마스터 보호(P3-06 TDD 게이트):
 *  - oracle = assets/js/session-detail/turn-views.js#{renderSpine, turnLineHtml} (exported, 병존·무수정).
 *  - 활성 턴 turn-line 은 chip-flow 전체를 임베드 → Chip/ChipFlow/ChipArrow/SpineArrow 가
 *    transitive 로 검증된다(Chip/ChipFlow 는 module-private 원본이라 직접 oracle 이 없음).
 *  - 6분기 칩(response/group/agent/skill/mcp/plain) 을 활성 턴 fixture 에 모두 포함.
 *
 * 정규화: turn-rows-equivalence.test.tsx 와 동일 철학(self-close 통일 + 공백 축약 + 엔티티 디코드
 *  + 속성명 소문자화 + 시작 태그 속성 이름순 정렬). SVG 속성 순서가 React/문자열 간 다를 수 있어 정렬 흡수.
 */
// DOM 스텁을 oracle 보다 먼저 평가 — §5 순환으로 끌려오는 flat-view.js 모듈 최상위
// document.addEventListener(flat-view.js:142) 가 깨지지 않게 한다(import hoisting 순서 보장).
import './_dom-stub';
import { describe, it, expect, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { TurnLine, TurnSpine } from '../TurnSpine';
// oracle — 원본 JS(병존·무수정).
import { turnLineHtml, renderSpine } from '../../../../assets/js/session-detail/turn-views.js';

beforeAll(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  // identity 스텁 — 양쪽이 동일 key 를 동일 vars 로 호출하므로 vars 무시 식별자로 동치 유지.
  (globalThis as any).window.I18n = { t: (k: string) => k };
});

// ── 정규화 (turn-rows-equivalence.test.tsx 와 동일) ─────────────────────────────

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

function sortAttrsInTag(tag: string): string {
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
  return decoded.replace(/<[a-zA-Z][\w-]*\s[^<>]*?>/g, (tag) => sortAttrsInTag(tag));
}

const tsx = (el: Parameters<typeof renderToStaticMarkup>[0]) => normalizeHtml(renderToStaticMarkup(el));
const js = (s: string) => normalizeHtml(s);

// ── fixtures ────────────────────────────────────────────────────────────────

function tool(id: string, tool_name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'tool_call',
    session_id: 's1',
    turn_id: 't1',
    tokens_input: 0,
    tokens_output: 1,
    timestamp: '2026-04-28T10:01:00Z',
    model: null,
    tool_name,
    duration_ms: 1,
    ...extra,
  };
}

function response(id: string, ts: string) {
  return { id, type: 'response', session_id: 's1', turn_id: 't1', timestamp: ts };
}

/** 활성 턴 — items[] 서버 인터리빙으로 6분기 칩을 모두 포함. */
function activeTurnAllBranches(): any {
  return {
    turn_id: 't1',
    turn_index: 2,
    prompt: { preview: 'do the thing' },
    items: [
      { kind: 'tool', request: tool('a1', 'Agent', { tool_detail: 'researcher' }) }, // agent
      { kind: 'tool', request: tool('a2', 'Skill', { tool_detail: 'commit' }) }, // skill
      { kind: 'tool', request: tool('a3', 'mcp__redmine__getIssue') }, // mcp
      { kind: 'tool', request: tool('a4', 'Read') }, // neutral
      { kind: 'tool', request: tool('a5', 'Bash') }, // neutral → group window
      { kind: 'tool', request: tool('a6', 'Grep') }, // neutral → group window
      { kind: 'tool', request: tool('a7', 'Write') }, // anchor-ish plain
      { kind: 'response', request: response('r1', '2026-04-28T10:03:00Z') }, // response
    ],
  };
}

function collapsedTurn(turn_id: string, turn_index: number, preview?: string): any {
  return {
    turn_id,
    turn_index,
    prompt: preview ? { preview } : null,
    items: [{ kind: 'tool', request: tool(`x${turn_index}`, 'Read') }],
  };
}

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('TurnLine ≡ turnLineHtml (oracle)', () => {
  it('비활성 turn-line + prompt title', () => {
    const turn = collapsedTurn('tA', 1, 'hello prompt');
    expect(tsx(<TurnLine turn={turn} isActive={false} />)).toBe(js(turnLineHtml(turn, false)));
  });

  it('비활성 turn-line — prompt 없으면 title 미부여', () => {
    const turn = collapsedTurn('tB', 3);
    expect(tsx(<TurnLine turn={turn} isActive={false} />)).toBe(js(turnLineHtml(turn, false)));
  });

  it('활성 turn-line — 6분기 chip-flow 임베드 동치', () => {
    const turn = activeTurnAllBranches();
    expect(tsx(<TurnLine turn={turn} isActive={true} />)).toBe(js(turnLineHtml(turn, true)));
  });

  it('활성 turn-line — 동일 도구 연속 ×N 압축 동치', () => {
    const turn: any = {
      turn_id: 'tC',
      turn_index: 5,
      prompt: { preview: 'p' },
      items: [
        { kind: 'tool', request: tool('c1', 'Edit') },
        { kind: 'tool', request: tool('c2', 'Edit') },
        { kind: 'tool', request: tool('c3', 'Edit') },
      ],
    };
    expect(tsx(<TurnLine turn={turn} isActive={true} />)).toBe(js(turnLineHtml(turn, true)));
  });
});

describe('TurnSpine ≡ renderSpine (oracle)', () => {
  it('다중 턴 — 내림차순 정렬 + spine-arrow 동치', () => {
    const turns = [collapsedTurn('t1', 1, 'a'), activeTurnAllBranches(), collapsedTurn('t3', 3, 'c')];
    const activeId = 't1'; // 활성 턴이 t1(turn_index 2)
    // activeTurnAllBranches 의 turn_id 는 't1', turn_index 2 → 활성으로 지정.
    expect(tsx(<TurnSpine turns={turns} activeTurnId={activeId} />)).toBe(js(renderSpine(turns, activeId)));
  });

  it('활성 턴 없음 — 전부 collapsed 동치', () => {
    const turns = [collapsedTurn('t1', 1, 'a'), collapsedTurn('t2', 2, 'b')];
    expect(tsx(<TurnSpine turns={turns} activeTurnId={null} />)).toBe(js(renderSpine(turns, null)));
  });

  it('빈 turns — null/빈 문자열 동치', () => {
    expect(tsx(<TurnSpine turns={[]} activeTurnId={null} />)).toBe(js(renderSpine([], null)));
  });
});

describe('거짓통과 가드 — 구조/속성 차이는 잡힌다', () => {
  it('활성/비활성 상태가 다르면 불일치', () => {
    const turn = collapsedTurn('tG', 1, 'g');
    expect(tsx(<TurnLine turn={turn} isActive={true} />)).not.toBe(js(turnLineHtml(turn, false)));
  });
});
