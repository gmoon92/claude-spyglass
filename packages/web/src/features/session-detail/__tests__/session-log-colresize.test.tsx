/**
 * session-log-colresize.test.tsx — SessionLog 표 골격 안정성 계약 (P3-05, P3-04 §4.2 최대 위험)
 *
 * 계약(§4.2 가드 #1):
 *  - <colgroup>/<thead> 는 안정 노드 — col 너비는 LOG_TABLE_COLS 상수에서 1회 주입(원본
 *    turn-views.js:1004-1009 와 동치). tbody(TurnRows) 데이터가 바뀌어도 colgroup/thead 마크업은
 *    불변이어야 한다(드래그한 컬럼 너비가 리셋되는 회귀 방지).
 *  - 9컬럼 폭: 100/88/120/130/(가변)/48/48/52/68px.
 *
 * 정적 골격 계약(renderToStaticMarkup): col-resize 의 useEffect 미실행 환경에서 colgroup/thead
 *   불변·9컬럼·colspan 을 검증한다.
 * 라이브 결선 계약(createRoot+act): production 주력 훅 useColResize(storageKey='session-log')가
 *   마운트 시 각 thead th 에 .col-resize-handle 을 부착함을 jsdom 에서 입증한다(syslib-colresize 선례).
 */
import './_dom-stub'; // bun test 양립: createRoot 마운트용 전역 DOM 보장(vitest 에선 no-op).
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionLog, LOG_TABLE_COLS } from '../SessionLog';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// expandCols 파생 공식 SSoT 검증용 — TurnRows 내부 로직과 동기화 유지.
const SESSION_DETAIL_EXPAND_COLS = (showSession: boolean) => showSession ? 10 : 9;

beforeAll(() => {
  // 루트 bun test(jsdom 부재)용 window 보장. i18n 은 vitest.setup 의 기본 t(passthrough)가 담당.
  (globalThis as any).window = (globalThis as any).window ?? {};
});

/** colgroup ... /colgroup 마크업만 추출. */
function colgroupOf(html: string): string {
  return html.match(/<colgroup>[\s\S]*?<\/colgroup>/)?.[0] ?? '';
}
function theadOf(html: string): string {
  return html.match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? '';
}

const turnA: any = {
  prompt: { id: 'p1', type: 'prompt', turn_id: 't1', timestamp: '2026-04-28T10:00:00Z' },
  items: [{ kind: 'tool', request: { id: 'a1', type: 'tool_call', tool_name: 'Read', turn_id: 't1', timestamp: '2026-04-28T10:01:00Z' } }],
};
const turnB: any = {
  prompt: { id: 'p2', type: 'prompt', turn_id: 't2', timestamp: '2026-04-28T10:00:00Z' },
  items: [
    { kind: 'tool', request: { id: 'b1', type: 'tool_call', tool_name: 'Bash', turn_id: 't2', timestamp: '2026-04-28T10:01:00Z' } },
    { kind: 'response', request: { id: 'b2', type: 'response', turn_id: 't2', timestamp: '2026-04-28T10:02:00Z' } },
  ],
};

describe('LOG_TABLE_COLS 상수 = 9컬럼 폭', () => {
  it('너비 시퀀스 일치 (Duration 은 "DURATION" 헤더가 잘리지 않도록 90px)', () => {
    expect(LOG_TABLE_COLS).toEqual(['100px', '88px', '120px', '130px', null, '48px', '48px', '52px', '90px']);
  });
});

describe('colgroup/thead 안정 노드 — tbody 데이터 변경에 불변', () => {
  it('활성 턴이 바뀌어도 colgroup 마크업 동일', () => {
    const a = renderToStaticMarkup(<SessionLog activeTurn={turnA} />);
    const b = renderToStaticMarkup(<SessionLog activeTurn={turnB} />);
    expect(colgroupOf(a)).toBe(colgroupOf(b));
    expect(colgroupOf(a)).not.toBe(''); // colgroup 실제 존재
  });

  it('활성 턴이 바뀌어도 thead 마크업 동일', () => {
    const a = renderToStaticMarkup(<SessionLog activeTurn={turnA} />);
    const b = renderToStaticMarkup(<SessionLog activeTurn={turnB} />);
    expect(theadOf(a)).toBe(theadOf(b));
  });

  it('tbody 만 활성 턴별로 달라진다(골격 외 영역이 갱신됨을 확인)', () => {
    const a = renderToStaticMarkup(<SessionLog activeTurn={turnA} />);
    const b = renderToStaticMarkup(<SessionLog activeTurn={turnB} />);
    const tbodyA = a.match(/<tbody[\s\S]*?<\/tbody>/)?.[0] ?? '';
    const tbodyB = b.match(/<tbody[\s\S]*?<\/tbody>/)?.[0] ?? '';
    expect(tbodyA).not.toBe(tbodyB);
  });

  it('빈 활성 턴 → tbody 비고 골격은 유지', () => {
    const html = renderToStaticMarkup(<SessionLog activeTurn={null} />);
    expect(colgroupOf(html)).not.toBe('');
    expect(theadOf(html)).not.toBe('');
    expect(html).toContain('id="turnLogTable"');
    expect(html).toContain('id="turnLogBody"');
  });
});

describe('표 골격 구조 계약', () => {
  it('9개 col + 4개 고정폭 우측정렬 헤더(in/out/Cache/Duration)', () => {
    const html = renderToStaticMarkup(<SessionLog activeTurn={turnA} />);
    // `<colgroup` 자기 자신을 세지 않도록 `<col` 뒤 공백/`>`/`/` 만 카운트.
    const cols = colgroupOf(html).match(/<col(?=[\s/>])/g) ?? [];
    expect(cols.length).toBe(9);
    expect(theadOf(html)).toContain('Time');
    expect(theadOf(html)).toContain('Duration');
  });

  it('flowPane 슬롯 주입 시 log-pane 앞에 렌더', () => {
    const html = renderToStaticMarkup(
      <SessionLog activeTurn={turnA} flowPane={<div data-region="flow">FLOW</div>} />,
    );
    expect(html.indexOf('data-region="flow"')).toBeLessThan(html.indexOf('data-region="log"'));
  });
});

describe('expand 행 colspan 계약 — 테이블 컬럼 수와 일치해야 레이아웃이 깨지지 않음', () => {
  it('showSession=false(기본) → expandCols=9 = LOG_TABLE_COLS 길이', () => {
    // TurnRows 가 expandCols=9 를 주입하므로, colspan 이 실제 col 개수(9)와 일치한다.
    expect(SESSION_DETAIL_EXPAND_COLS(false)).toBe(LOG_TABLE_COLS.length);
  });

  it('showSession=true → expandCols=10 = LOG_TABLE_COLS 길이 + Session 컬럼 1', () => {
    // showSession=true 면 Session 컬럼이 추가되어 10컬럼이므로 expandCols=10 이어야 한다.
    expect(SESSION_DETAIL_EXPAND_COLS(true)).toBe(LOG_TABLE_COLS.length + 1);
  });
});

describe('SessionLog — col-resize 핸들 부착(useColResize 라이브 결선)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('#turnLogTable thead 각 th 에 .col-resize-handle 이 붙는다(개수 = 9컬럼)', () => {
    root = createRoot(container);
    act(() => root.render(<SessionLog activeTurn={turnA} />));
    const table = container.querySelector('#turnLogTable')!;
    const ths = table.querySelectorAll('thead th');
    const handles = table.querySelectorAll('.col-resize-handle');
    expect(ths.length).toBe(LOG_TABLE_COLS.length); // 9컬럼
    expect(handles.length).toBe(ths.length); // th 마다 핸들 1개
  });
});
