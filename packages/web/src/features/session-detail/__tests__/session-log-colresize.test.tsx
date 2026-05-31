/**
 * session-log-colresize.test.tsx — SessionLog 표 골격 안정성 계약 (P3-05, P3-04 §4.2 최대 위험)
 *
 * 계약(§4.2 가드 #1):
 *  - <colgroup>/<thead> 는 안정 노드 — col 너비는 LOG_TABLE_COLS 상수에서 1회 주입(원본
 *    turn-views.js:1004-1009 와 동치). tbody(TurnRows) 데이터가 바뀌어도 colgroup/thead 마크업은
 *    불변이어야 한다(드래그한 컬럼 너비가 리셋되는 회귀 방지).
 *  - 9컬럼 폭: 100/88/120/130/(가변)/48/48/52/68px.
 *
 * 주의: col-resize 의 useEffect 부착은 실제 DOM mount 에서만 동작하므로(러너는 renderToStaticMarkup,
 *   effect 미실행) 본 테스트는 *정적 골격 계약* 만 검증한다. 드래그→너비유지 런타임 확인은
 *   수동 verify(§4.2 가드 #3, P3-01 resize 패턴) 로 보강한다.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionLog, LOG_TABLE_COLS } from '../SessionLog';

beforeAll(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.I18n = { t: (k: string) => k };
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

describe('LOG_TABLE_COLS 상수 = 원본 9컬럼 폭(turn-views.js:1004-1009)', () => {
  it('너비 시퀀스 일치', () => {
    expect(LOG_TABLE_COLS).toEqual(['100px', '88px', '120px', '130px', null, '48px', '48px', '52px', '68px']);
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
