/**
 * icons-equivalence.test.tsx — TSX 아이콘 ↔ 원본 JS 아이콘 출력 동치 검증 (P2-01)
 *
 * 전략(done_criteria: "출력(SVG markup)이 원본과 동치"):
 *  - 원본 assets/js/design-system/icons/*.js 의 svg* 함수가 반환하는 SVG 문자열과
 *    신규 src/components/design-system/icons/*.tsx 컴포넌트를 renderToStaticMarkup 으로
 *    렌더한 결과를 **정규화 후 1:1 비교**한다.
 *  - 정규화가 필요한 이유: React 는 void 가 아닌 요소(circle/line/rect/path)를
 *    `<circle></circle>` 로 닫고, 원본 문자열은 `<circle/>` 자기닫음을 쓴다.
 *    또 들여쓰기/줄바꿈(note 원본 멀티라인)도 다르다. 정규화는 (1) 자기닫음 ↔ 빈 요소 통일,
 *    (2) 무의미 공백 제거만 수행하며 속성 이름/값/순서는 보존한다(시각적 동치의 충분조건).
 *  - 원본(svg* 문자열) = oracle. 모든 아이콘·주요 옵션 분기를 망라한다.
 *
 * 회귀 가드: 이 파일은 신규 계약(P2-01). 원본 js 는 무수정, 병존.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

// 신규 TSX 컴포넌트(barrel 경유 — barrel export 완전성도 동시 검증).
import {
  AgentDot,
  Bolt,
  Check,
  Chevron,
  Diamond,
  ErrorIcon,
  Info,
  McpDot,
  Note,
  Quote,
  Radio,
  Refresh,
  Search,
  SkillDot,
  StatusActive,
  StatusEnded,
  StatusStale,
  ToolDot,
  Trash,
  Warn,
} from '../index';

// 원본 JS 아이콘(병존, 무수정) — 동치 비교 기준(oracle).
import { svgAgentDot } from '../../../../../assets/js/design-system/icons/agent-dot.js';
import { svgBolt } from '../../../../../assets/js/design-system/icons/bolt.js';
import { svgCheck } from '../../../../../assets/js/design-system/icons/check.js';
import { svgChevron } from '../../../../../assets/js/design-system/icons/chevron.js';
import { svgDiamond } from '../../../../../assets/js/design-system/icons/diamond.js';
import { svgError } from '../../../../../assets/js/design-system/icons/error.js';
import { svgInfo } from '../../../../../assets/js/design-system/icons/info.js';
import { svgMcpDot } from '../../../../../assets/js/design-system/icons/mcp-dot.js';
import { svgNote } from '../../../../../assets/js/design-system/icons/note.js';
import { svgQuote } from '../../../../../assets/js/design-system/icons/quote.js';
import { svgRadio } from '../../../../../assets/js/design-system/icons/radio.js';
import { svgRefresh } from '../../../../../assets/js/design-system/icons/refresh.js';
import { svgSearch } from '../../../../../assets/js/design-system/icons/search.js';
import { svgSkillDot } from '../../../../../assets/js/design-system/icons/skill-dot.js';
import { svgStatusActive } from '../../../../../assets/js/design-system/icons/status-active.js';
import { svgStatusEnded } from '../../../../../assets/js/design-system/icons/status-ended.js';
import { svgStatusStale } from '../../../../../assets/js/design-system/icons/status-stale.js';
import { svgToolDot } from '../../../../../assets/js/design-system/icons/tool-dot.js';
import { svgTrash } from '../../../../../assets/js/design-system/icons/trash.js';
import { svgWarn } from '../../../../../assets/js/design-system/icons/warn.js';

/**
 * SVG 마크업 정규화 — 시각적 동치 비교를 위한 canonical 형태.
 *  1) `<tag .../>` (자기닫음) → `<tag ...></tag>` 로 통일 (React 출력 형태에 맞춤).
 *     SVG 속성값은 '<' '>' '/>' 를 포함하지 않으므로 [^<>]*? 로 안전하게 태그 경계를 한정.
 *  2) 태그 사이/앞뒤 무의미 공백·줄바꿈 제거.
 *  3) 태그 내부 다중 공백을 단일 공백으로 축약.
 * 속성 이름·값·순서는 변경하지 않는다.
 */
export function normalizeSvg(s: string): string {
  return s
    .replace(/<([a-zA-Z]+)([^<>]*?)\/>/g, '<$1$2></$1>')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .replace(/\s+>/g, '>')
    .trim();
}

/** TSX 컴포넌트 렌더 + 정규화. */
function tsx(el: ReactElement): string {
  return normalizeSvg(renderToStaticMarkup(el));
}
/** 원본 JS 문자열 정규화. */
function js(s: string): string {
  return normalizeSvg(s);
}

describe('icons equivalence — 20개 아이콘 default 출력 동치', () => {
  it('AgentDot (stroke-only 이중 원, size 12)', () => {
    expect(tsx(<AgentDot />)).toBe(js(svgAgentDot()));
  });
  it('Bolt (단일 path, size 14)', () => {
    expect(tsx(<Bolt />)).toBe(js(svgBolt()));
  });
  it('Check (rect only, size 12)', () => {
    expect(tsx(<Check />)).toBe(js(svgCheck()));
  });
  it('Chevron (viewBox 12, sw 1.6, data-dir right)', () => {
    expect(tsx(<Chevron />)).toBe(js(svgChevron()));
  });
  it('Diamond (fill-only, size 10)', () => {
    expect(tsx(<Diamond />)).toBe(js(svgDiamond()));
  });
  it('ErrorIcon (circle + X, size 14)', () => {
    expect(tsx(<ErrorIcon />)).toBe(js(svgError()));
  });
  it('Info (circle + line + dot, size 14)', () => {
    expect(tsx(<Info />)).toBe(js(svgInfo()));
  });
  it('McpDot (4 dots + center, size 12)', () => {
    expect(tsx(<McpDot />)).toBe(js(svgMcpDot()));
  });
  it('Note (viewBox 12, xmlns, default className)', () => {
    expect(tsx(<Note />)).toBe(js(svgNote()));
  });
  it('Quote (fill-only, viewBox 12, xmlns, size 12)', () => {
    expect(tsx(<Quote />)).toBe(js(svgQuote()));
  });
  it('Radio (outline circle, no cap/join, size 12)', () => {
    expect(tsx(<Radio />)).toBe(js(svgRadio()));
  });
  it('Refresh (4 arcs, size 12 passthrough)', () => {
    expect(tsx(<Refresh />)).toBe(js(svgRefresh()));
  });
  it('Search (circle + handle, size 14)', () => {
    expect(tsx(<Search />)).toBe(js(svgSearch()));
  });
  it('SkillDot (fish-eye, size 12)', () => {
    expect(tsx(<SkillDot />)).toBe(js(svgSkillDot()));
  });
  it('StatusActive (filled circle, size 12)', () => {
    expect(tsx(<StatusActive />)).toBe(js(svgStatusActive()));
  });
  it('StatusEnded (outline circle, size 12)', () => {
    expect(tsx(<StatusEnded />)).toBe(js(svgStatusEnded()));
  });
  it('StatusStale (outline + half-fill, size 12)', () => {
    expect(tsx(<StatusStale />)).toBe(js(svgStatusStale()));
  });
  it('ToolDot (fish-eye, size 12)', () => {
    expect(tsx(<ToolDot />)).toBe(js(svgToolDot()));
  });
  it('Trash (4 paths, size 12 passthrough)', () => {
    expect(tsx(<Trash />)).toBe(js(svgTrash()));
  });
  it('Warn (triangle + bang, size 12 passthrough)', () => {
    expect(tsx(<Warn />)).toBe(js(svgWarn()));
  });
});

describe('icons equivalence — 옵션 분기(selected/dir/size/className/ariaLabel)', () => {
  it('Check selected=true → rect + 체크 path', () => {
    expect(tsx(<Check selected />)).toBe(js(svgCheck({ selected: true })));
  });
  it('Radio selected=true → outline + 채움 점', () => {
    expect(tsx(<Radio selected />)).toBe(js(svgRadio({ selected: true })));
  });
  it('Chevron dir="down" → rotate(90deg)', () => {
    expect(tsx(<Chevron dir="down" />)).toBe(js(svgChevron({ dir: 'down' })));
  });
  it('Chevron dir="left" → rotate(180deg)', () => {
    expect(tsx(<Chevron dir="left" />)).toBe(js(svgChevron({ dir: 'left' })));
  });
  it('Chevron dir="up" → rotate(270deg)', () => {
    expect(tsx(<Chevron dir="up" />)).toBe(js(svgChevron({ dir: 'up' })));
  });
  it('Bolt size override', () => {
    expect(tsx(<Bolt size={20} />)).toBe(js(svgBolt({ size: 20 })));
  });
  it('Diamond size override', () => {
    expect(tsx(<Diamond size={24} />)).toBe(js(svgDiamond({ size: 24 })));
  });
  it('AgentDot className + ariaLabel → role=img + aria-label', () => {
    expect(tsx(<AgentDot ariaLabel="agent" className="x" />)).toBe(
      js(svgAgentDot({ ariaLabel: 'agent', className: 'x' }))
    );
  });
  it('Note className override (default 대체)', () => {
    expect(tsx(<Note className="custom" />)).toBe(js(svgNote({ className: 'custom' })));
  });
  it('Search ariaLabel 지정', () => {
    expect(tsx(<Search ariaLabel="search" />)).toBe(js(svgSearch({ ariaLabel: 'search' })));
  });
});
