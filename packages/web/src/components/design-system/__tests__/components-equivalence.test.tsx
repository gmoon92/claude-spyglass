/**
 * components-equivalence.test.tsx — TSX 컴포넌트 ↔ 원본 JS 렌더 함수 출력 동치 검증 (P2-03)
 *
 * 범위(P2-03 batch — markers 2 + badges/chips/stats 3, 총 5 컴포넌트):
 *  - markers: Dot ↔ renderDot, SortHead ↔ renderSortHead
 *  - badges:  Badge ↔ renderBadge
 *  - chips:   Chip  ↔ renderChip
 *  - stats:   Bar   ↔ renderBar
 *  (feedback/index 는 원본이 placeholder — 렌더 출력이 없어 동치 대상 아님. 별도 존재 검증만.)
 *
 * 전략(done_criteria: "출력(HTML markup)이 원본과 동치"):
 *  - 원본 assets/js/design-system/{markers,badges,chips,stats}/*.js 의 render* 함수가 반환하는
 *    HTML 문자열(= oracle)과, 신규 src/components/design-system/*.tsx 컴포넌트를
 *    renderToStaticMarkup 으로 렌더한 결과를 **정규화 후 1:1 비교**한다.
 *  - 정규화는 icons-equivalence.test.tsx 의 normalizeSvg 를 재사용한다(canonical 단일화):
 *    (1) 자기닫음 ↔ 빈 요소 통일, (2) 무의미 공백 제거. 속성 이름/값/순서는 보존.
 *  - icon 합성(Badge icon=<ErrorIcon/> vs svgError()) 도 동일 정규화로 동치 비교한다
 *    (아이콘 자체 동치는 icons-equivalence.test.tsx 가 별도 보증).
 *
 * 회귀 가드: 신규 계약(P2-03). 원본 js 는 무수정·병존. 기존 261 통과분에 가산.
 * false-pass 가드: 정규화가 모든 차이를 삼켜 항상 통과하지 않음을, 의도적 불일치로 검증한다.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

// 정규화 함수 재사용(P2-01 과 단일 canonical 형태 유지).
import { normalizeSvg } from '../icons/__tests__/icons-equivalence.test';

// 신규 TSX 컴포넌트(배럴 경유 — 배럴 export 완전성도 동시 검증).
import { Dot, SortHead } from '../markers';
import { Badge } from '../badges';
import { Chip } from '../chips';
import { Bar } from '../stats';
import { ErrorIcon, Warn } from '../icons';

// 원본 JS 렌더 함수(병존, 무수정) — 동치 비교 기준(oracle).
import { renderDot } from '../../../../assets/js/design-system/markers/dot.js';
import { renderSortHead } from '../../../../assets/js/design-system/markers/sort-head.js';
import { renderBadge } from '../../../../assets/js/design-system/badges/badge.js';
import { renderChip } from '../../../../assets/js/design-system/chips/chip.js';
import { renderBar } from '../../../../assets/js/design-system/stats/bar.js';
// 원본 SVG 아이콘(icon prop 합성 동치 비교용).
import { svgError } from '../../../../assets/js/design-system/icons/error.js';
import { svgWarn } from '../../../../assets/js/design-system/icons/warn.js';

/** TSX 컴포넌트 렌더 + 정규화. */
function tsx(el: ReactElement): string {
  return normalizeSvg(renderToStaticMarkup(el));
}
/** 원본 JS 문자열 정규화. */
function js(s: string): string {
  return normalizeSvg(s);
}

describe('markers/Dot ↔ renderDot — 출력 동치', () => {
  it('default (tone=info, size=md, aria-hidden=true)', () => {
    expect(tsx(<Dot />)).toBe(js(renderDot()));
  });
  it('tone=active + size=sm + label (title 속성)', () => {
    expect(tsx(<Dot tone="active" size="sm" label="활성 세션" />)).toBe(
      js(renderDot({ tone: 'active', size: 'sm', label: '활성 세션' }))
    );
  });
  it('tone=pulse default size', () => {
    expect(tsx(<Dot tone="pulse" />)).toBe(js(renderDot({ tone: 'pulse' })));
  });
  it('ariaHidden=false', () => {
    expect(tsx(<Dot ariaHidden={false} />)).toBe(js(renderDot({ ariaHidden: false })));
  });
  it('label 내 따옴표 이스케이프(&quot;)', () => {
    const label = 'a "quoted" 세션';
    expect(tsx(<Dot label={label} />)).toBe(js(renderDot({ label })));
  });
  it('비유효 tone/size → info/md fallback', () => {
    // 비유효 입력 fallback 동작 동치(원본 VALID_*.has 분기).
    // 타입상 유효하지 않으므로 any 캐스트로 런타임 경로만 검증.
    const badTone = 'nope' as never;
    const badSize = 'xl' as never;
    expect(tsx(<Dot tone={badTone} size={badSize} />)).toBe(
      js(renderDot({ tone: badTone, size: badSize }))
    );
  });
});

describe('markers/SortHead ↔ renderSortHead — 출력 동치', () => {
  it('default sort=idle (↕, aria-sort none)', () => {
    expect(tsx(<SortHead label="Name" sortKey="name" />)).toBe(
      js(renderSortHead({ label: 'Name', key: 'name' }))
    );
  });
  it('sort=asc (↑, ascending)', () => {
    expect(tsx(<SortHead label="Name" sort="asc" sortKey="name" />)).toBe(
      js(renderSortHead({ label: 'Name', sort: 'asc', key: 'name' }))
    );
  });
  it('sort=desc (↓, descending)', () => {
    expect(tsx(<SortHead label="Calls" sort="desc" sortKey="calls" />)).toBe(
      js(renderSortHead({ label: 'Calls', sort: 'desc', key: 'calls' }))
    );
  });
  it('label/key HTML 이스케이프(<, &, ")', () => {
    const label = 'A & B <x> "q"';
    const key = 'k&<>"';
    expect(tsx(<SortHead label={label} sort="asc" sortKey={key} />)).toBe(
      js(renderSortHead({ label, sort: 'asc', key }))
    );
  });
  it('비유효 sort → idle fallback', () => {
    const badSort = 'sideways' as never;
    expect(tsx(<SortHead label="X" sort={badSort} sortKey="x" />)).toBe(
      js(renderSortHead({ label: 'X', sort: badSort, key: 'x' }))
    );
  });
});

describe('badges/Badge ↔ renderBadge — 출력 동치', () => {
  it('default tone=neutral, label only', () => {
    expect(tsx(<Badge label="배지" />)).toBe(js(renderBadge({ label: '배지' })));
  });
  it('tone=warn + iconText (글리프 prefix)', () => {
    expect(tsx(<Badge tone="warn" iconText="↑" label="spike" />)).toBe(
      js(renderBadge({ tone: 'warn', iconText: '↑', label: 'spike' }))
    );
  });
  it('tone=error + icon=<ErrorIcon/> (SVG prefix, icon > iconText 우선)', () => {
    // 원본은 svgError() HTML 문자열을 icon 으로 전달; TSX 는 동일 SVG 노드를 전달.
    expect(tsx(<Badge tone="error" icon={<ErrorIcon />} label="오류" />)).toBe(
      js(renderBadge({ tone: 'error', icon: svgError(), label: '오류' }))
    );
  });
  it('ariaLabel 명시(label 과 다른 값)', () => {
    expect(tsx(<Badge tone="info" label="i" ariaLabel="정보 배지" />)).toBe(
      js(renderBadge({ tone: 'info', label: 'i', ariaLabel: '정보 배지' }))
    );
  });
  it('label 빈 문자열 → aria-label 미출력', () => {
    expect(tsx(<Badge tone="neutral" label="" />)).toBe(
      js(renderBadge({ tone: 'neutral', label: '' }))
    );
  });
  it('label HTML 이스케이프(&, <, ")', () => {
    const label = 'x & y <z> "q"';
    expect(tsx(<Badge tone="brand" label={label} />)).toBe(
      js(renderBadge({ tone: 'brand', label }))
    );
  });
  it('icon 과 iconText 동시 → icon 우선', () => {
    expect(tsx(<Badge tone="warn" icon={<Warn />} iconText="↑" label="경고" />)).toBe(
      js(renderBadge({ tone: 'warn', icon: svgWarn(), iconText: '↑', label: '경고' }))
    );
  });
});

describe('chips/Chip ↔ renderChip — 출력 동치', () => {
  it('default (tone=undefined → unknown), label only', () => {
    // 원본 renderChip 은 tone ?? 'unknown' 로 undefined 를 허용하나, JS JSDoc 상 tone 이
    // required 로 추론된다(원본 무수정). 런타임 동작(undefined→unknown) 동치 검증을 위해
    // tone 을 명시 undefined 로 전달한다.
    const undefTone = undefined as never;
    expect(tsx(<Chip label="MCP" />)).toBe(js(renderChip({ tone: undefTone, label: 'MCP' })));
  });
  it('tone=mcp, label', () => {
    expect(tsx(<Chip tone="mcp" label="MCP" />)).toBe(
      js(renderChip({ tone: 'mcp', label: 'MCP' }))
    );
  });
  it('tone=sonnet + dot (ds-dot prefix)', () => {
    expect(tsx(<Chip tone="sonnet" label="sonnet" dot />)).toBe(
      js(renderChip({ tone: 'sonnet', label: 'sonnet', dot: true }))
    );
  });
  it('dataAttrs 삽입 순서 보존 (meta-doc-type → meta-doc-id)', () => {
    const dataAttrs = { 'meta-doc-type': 'skill', 'meta-doc-id': 'foo-skill' };
    expect(tsx(<Chip tone="skill" label="Skill" dataAttrs={dataAttrs} />)).toBe(
      js(renderChip({ tone: 'skill', label: 'Skill', dataAttrs }))
    );
  });
  it('icon=<ErrorIcon/> (icon > dot 우선)', () => {
    expect(tsx(<Chip tone="task" label="Task" dot icon={<ErrorIcon />} />)).toBe(
      js(renderChip({ tone: 'task', label: 'Task', dot: true, icon: svgError() }))
    );
  });
  it('label/dataAttrs HTML 이스케이프(&, <, ")', () => {
    const dataAttrs = { 'meta-doc-id': 'a&b<c>"d"' };
    const label = 'x & <y> "z"';
    expect(tsx(<Chip tone="agent" label={label} dataAttrs={dataAttrs} />)).toBe(
      js(renderChip({ tone: 'agent', label, dataAttrs }))
    );
  });
});

describe('stats/Bar ↔ renderBar — 출력 동치', () => {
  it('default tone=neutral, value/max', () => {
    expect(tsx(<Bar value={50} max={100} />)).toBe(js(renderBar({ value: 50, max: 100 })));
  });
  it('tone=success, 정수 비율(78%)', () => {
    expect(tsx(<Bar value={78} max={100} tone="success" />)).toBe(
      js(renderBar({ value: 78, max: 100, tone: 'success' }))
    );
  });
  it('부동소수 비율(3/5=60%)', () => {
    expect(tsx(<Bar value={3} max={5} tone="info" ariaLabel="캐시 히트율" />)).toBe(
      js(renderBar({ value: 3, max: 5, tone: 'info', ariaLabel: '캐시 히트율' }))
    );
  });
  it('비정수 부동소수(1/3=33.333…%) 문자열화 동치', () => {
    expect(tsx(<Bar value={1} max={3} tone="brand" />)).toBe(
      js(renderBar({ value: 1, max: 3, tone: 'brand' }))
    );
  });
  it('value>max → 100% clamp', () => {
    expect(tsx(<Bar value={150} max={100} tone="error" />)).toBe(
      js(renderBar({ value: 150, max: 100, tone: 'error' }))
    );
  });
  it('value<0 → 0% clamp', () => {
    expect(tsx(<Bar value={-10} max={100} />)).toBe(js(renderBar({ value: -10, max: 100 })));
  });
  it('glow=true → data-glow="on"', () => {
    expect(tsx(<Bar value={40} max={100} tone="brand" glow />)).toBe(
      js(renderBar({ value: 40, max: 100, tone: 'brand', glow: true }))
    );
  });
  it('max 기본값(100) 생략 동치', () => {
    expect(tsx(<Bar value={25} />)).toBe(js(renderBar({ value: 25 })));
  });
  it('비유효 tone → neutral fallback', () => {
    const badTone = 'rainbow' as never;
    expect(tsx(<Bar value={10} max={100} tone={badTone} />)).toBe(
      js(renderBar({ value: 10, max: 100, tone: badTone }))
    );
  });
});

describe('feedback/index — placeholder 존재 검증(원본도 placeholder, 렌더 출력 없음)', () => {
  it('feedback 배럴은 import 가능하고 아직 export 가 없다(원본 TODO 와 동치)', async () => {
    // 원본 assets/js/design-system/feedback/index.js 가 placeholder 이므로 동치 비교 대상이 없다.
    // 모듈이 로드 가능하며 렌더 컴포넌트를 노출하지 않음을 확인(후속 wave 에서 채움).
    const mod = await import('../feedback/index');
    const exportedKeys = Object.keys(mod).filter((k) => k !== 'default');
    expect(exportedKeys).toEqual([]);
  });
});

describe('false-pass 가드 — 정규화가 실제 차이를 삼키지 않음', () => {
  it('다른 tone 은 동치가 아니다', () => {
    expect(tsx(<Dot tone="active" />)).not.toBe(js(renderDot({ tone: 'ended' })));
  });
  it('다른 label 은 동치가 아니다', () => {
    expect(tsx(<Badge tone="info" label="A" />)).not.toBe(
      js(renderBadge({ tone: 'info', label: 'B' }))
    );
  });
  it('다른 width(value) 는 동치가 아니다', () => {
    expect(tsx(<Bar value={10} max={100} />)).not.toBe(js(renderBar({ value: 90, max: 100 })));
  });
  it('속성 누락(aria-sort 없는 임의 마크업)은 동치가 아니다', () => {
    expect(tsx(<SortHead label="N" sort="asc" sortKey="n" />)).not.toBe(
      js('<button class="ds-sort-head">N</button>')
    );
  });
});
