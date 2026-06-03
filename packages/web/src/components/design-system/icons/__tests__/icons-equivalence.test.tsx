/**
 * icons-equivalence.test.tsx — TSX 아이콘 출력 골든 스냅샷 (P2-01 → React-only)
 *
 * 전략:
 *  - 원본 vanilla `assets/js/design-system/icons/*.js`(svg* 문자열) 는 데드로 삭제됐다.
 *    동치 oracle 이 사라졌으므로 turn-rows/anomaly-badges-equivalence(P5) 선례대로
 *    React 컴포넌트 출력을 **React-only 골든 스냅샷**으로 고정한다(회귀 가드).
 *  - 정규화(normalizeSvg)는 스냅샷을 안정적인 canonical 형태로 만들어 무의미한
 *    공백/자기닫음 차이로 인한 스냅샷 흔들림을 막는다.
 *  - barrel(`../index`) 경유로 import 하여 export 완전성도 동시 검증한다.
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

/**
 * SVG 마크업 정규화 — 스냅샷 안정화를 위한 canonical 형태.
 *  1) `<tag .../>` (자기닫음) → `<tag ...></tag>` 로 통일.
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

describe('icons golden — 20개 아이콘 default 출력', () => {
  it('AgentDot (stroke-only 이중 원, size 12)', () => {
    expect(tsx(<AgentDot />)).toMatchSnapshot();
  });
  it('Bolt (단일 path, size 14)', () => {
    expect(tsx(<Bolt />)).toMatchSnapshot();
  });
  it('Check (rect only, size 12)', () => {
    expect(tsx(<Check />)).toMatchSnapshot();
  });
  it('Chevron (viewBox 12, sw 1.6, data-dir right)', () => {
    expect(tsx(<Chevron />)).toMatchSnapshot();
  });
  it('Diamond (fill-only, size 10)', () => {
    expect(tsx(<Diamond />)).toMatchSnapshot();
  });
  it('ErrorIcon (circle + X, size 14)', () => {
    expect(tsx(<ErrorIcon />)).toMatchSnapshot();
  });
  it('Info (circle + line + dot, size 14)', () => {
    expect(tsx(<Info />)).toMatchSnapshot();
  });
  it('McpDot (4 dots + center, size 12)', () => {
    expect(tsx(<McpDot />)).toMatchSnapshot();
  });
  it('Note (viewBox 12, xmlns, default className)', () => {
    expect(tsx(<Note />)).toMatchSnapshot();
  });
  it('Radio (outline circle, no cap/join, size 12)', () => {
    expect(tsx(<Radio />)).toMatchSnapshot();
  });
  it('Refresh (4 arcs, size 12 passthrough)', () => {
    expect(tsx(<Refresh />)).toMatchSnapshot();
  });
  it('Search (circle + handle, size 14)', () => {
    expect(tsx(<Search />)).toMatchSnapshot();
  });
  it('SkillDot (fish-eye, size 12)', () => {
    expect(tsx(<SkillDot />)).toMatchSnapshot();
  });
  it('StatusActive (filled circle, size 12)', () => {
    expect(tsx(<StatusActive />)).toMatchSnapshot();
  });
  it('StatusEnded (outline circle, size 12)', () => {
    expect(tsx(<StatusEnded />)).toMatchSnapshot();
  });
  it('StatusStale (outline + half-fill, size 12)', () => {
    expect(tsx(<StatusStale />)).toMatchSnapshot();
  });
  it('ToolDot (fish-eye, size 12)', () => {
    expect(tsx(<ToolDot />)).toMatchSnapshot();
  });
  it('Trash (4 paths, size 12 passthrough)', () => {
    expect(tsx(<Trash />)).toMatchSnapshot();
  });
  it('Warn (triangle + bang, size 12 passthrough)', () => {
    expect(tsx(<Warn />)).toMatchSnapshot();
  });
});

describe('icons golden — 옵션 분기(selected/dir/size/className/ariaLabel)', () => {
  it('Check selected=true → rect + 체크 path', () => {
    expect(tsx(<Check selected />)).toMatchSnapshot();
  });
  it('Radio selected=true → outline + 채움 점', () => {
    expect(tsx(<Radio selected />)).toMatchSnapshot();
  });
  it('Chevron dir="down" → rotate(90deg)', () => {
    expect(tsx(<Chevron dir="down" />)).toMatchSnapshot();
  });
  it('Chevron dir="left" → rotate(180deg)', () => {
    expect(tsx(<Chevron dir="left" />)).toMatchSnapshot();
  });
  it('Chevron dir="up" → rotate(270deg)', () => {
    expect(tsx(<Chevron dir="up" />)).toMatchSnapshot();
  });
  it('Bolt size override', () => {
    expect(tsx(<Bolt size={20} />)).toMatchSnapshot();
  });
  it('Diamond size override', () => {
    expect(tsx(<Diamond size={24} />)).toMatchSnapshot();
  });
  it('AgentDot className + ariaLabel → role=img + aria-label', () => {
    expect(tsx(<AgentDot ariaLabel="agent" className="x" />)).toMatchSnapshot();
  });
  it('Note className override (default 대체)', () => {
    expect(tsx(<Note className="custom" />)).toMatchSnapshot();
  });
  it('Search ariaLabel 지정', () => {
    expect(tsx(<Search ariaLabel="search" />)).toMatchSnapshot();
  });
});
