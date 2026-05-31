/**
 * renderers-equivalence.test.tsx — TSX render 컴포넌트 ↔ 원본 JS 렌더 함수 출력 동치 검증 (P2-04)
 *
 * 골든마스터 보호(★최고 주의★):
 *  - 원본 골든마스터는 assets/js/__tests__/renderers.test.ts(.snap, 20 snapshot). 이 파일은
 *    그 .js/.snap 를 일절 건드리지 않는다. 여기서는 **신규 TSX** 출력이 **원본 .js** 출력과
 *    동치임을 독립적으로 증명한다(원본 .js 가 곧 oracle).
 *
 * 전략(D형 — icons-equivalence.test.tsx 와 동일 철학):
 *  - 원본 makeRequestRow/makeSessionRow/makeTargetCell 의 HTML 문자열과 TSX
 *    RequestRow/SessionRow/TargetCell 의 renderToStaticMarkup 결과를 **정규화 후 1:1 비교**.
 *  - 정규화: (1) self-close `<x/>`↔`<x></x>` 통일, (2) 무의미 공백·줄바꿈 축약,
 *    (3) HTML 엔티티 디코드(React 는 `'`→`&#x27;` `"`→`&quot;`, escHtml 은 `'` raw — 표현차 흡수).
 *    속성 이름/값(디코드 후)·순서·텍스트는 보존 → 시각·구조 동치의 충분조건.
 *  - 20 시나리오는 renderers.test.ts 와 1:1 대응(동일 fixture·동일 mock).
 *
 * 거짓통과 가드:
 *  - 정규화가 구조 차이까지 삼키지 않음을 별도 테스트로 증명(셀렉터/속성 의도적 변형 주입 시 불일치).
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

// 신규 TSX(barrel 경유 — barrel 완전성 동시 검증).
import { RequestRow, SessionRow, TargetCell } from '../index';

// 원본 JS(병존, 무수정) — 동치 비교 oracle.
import { makeRequestRow, makeSessionRow, makeTargetCell } from '../../../../assets/js/renderers.js';

// ── 환경 mock (renderers.test.ts 와 동일) ─────────────────────────────────────
const NOW_FIXED_MS = new Date('2026-05-04T10:00:00Z').getTime();
const originalDateNow = Date.now;

beforeAll(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.I18n = {
    t: (key: string, vars?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common.formatters.just-now': '방금',
        'common.formatters.minutes-ago': `${vars?.n}분 전`,
        'common.formatters.hours-ago': `${vars?.n}시간 전`,
        'common.formatters.days-ago': `${vars?.n}일 전`,
        'session.rows.empty-message': '메시지 없음',
        'session.rows.no-data': '데이터가 없습니다',
        'session.rows.status.ended': '종료된 세션',
        'session.rows.status.live': '라이브 세션',
        'session.rows.status.stale': 'stale — SessionEnd 누락 의심',
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

/** 명명·16진수·10진수 HTML 엔티티를 원문자로 디코드(표현차 흡수). */
function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&'); // amp 는 마지막(이중 디코드 방지)
}

/**
 * HTML 마크업 정규화 — 구조·속성·텍스트는 보존, 표현차만 제거.
 *  1) self-close 통일,
 *  2) 태그 사이 공백/줄바꿈 제거 + 태그 내부 다중 공백 축약,
 *  3) 엔티티 디코드,
 *  4) 속성 **이름** 소문자화 — HTML 속성명은 대소문자 무관(spec)인데 React 일부 환경에서
 *     colSpan/viewBox 등 camelCase 를 그대로 출력. 값은 보존(값은 항상 따옴표 내부이므로
 *     `(공백)(이름)=` 패턴은 값 토큰과 충돌하지 않는다).
 */
function normalizeHtml(s: string): string {
  return decodeEntities(
    s
      .replace(/<([a-zA-Z]+)([^<>]*?)\/>/g, '<$1$2></$1>')
      .replace(/>\s+</g, '><')
      .replace(/\s+/g, ' ')
      .replace(/\s+>/g, '>')
      .replace(/(\s)([a-zA-Z][a-zA-Z0-9-]*)(=)/g, (_m, sp, name, eq) => `${sp}${name.toLowerCase()}${eq}`)
      .trim()
  );
}

const tsx = (el: Parameters<typeof renderToStaticMarkup>[0]) => normalizeHtml(renderToStaticMarkup(el));
const js = (s: string) => normalizeHtml(s);

// ── 목 데이터 (renderers.test.ts 와 동일) ──────────────────────────────────────

function prompt(id: string, session_id: string, tokens_input = 100) {
  return {
    id,
    type: 'prompt',
    session_id,
    tokens_input,
    tokens_output: 0,
    timestamp: '2026-04-28T10:00:00Z',
    model: 'claude-3-5-sonnet',
    duration_ms: 50,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
  };
}

function tool_call(id: string, turn_id: string, tool_name = 'Read') {
  return {
    id,
    type: 'tool_call',
    session_id: 's1',
    tokens_input: 0,
    tokens_output: 100,
    timestamp: '2026-04-28T10:01:00Z',
    model: null,
    tool_name,
    turn_id,
    duration_ms: 200,
  };
}

function session(id: string, started_at = '2026-04-28T10:00:00Z', total_tokens = 5000) {
  return {
    id,
    started_at,
    ended_at: null as string | null,
    first_prompt_payload: JSON.stringify({ preview: '첫 프롬프트 미리보기' }),
    total_tokens,
  };
}

// ── makeRequestRow 동치 (9) ────────────────────────────────────────────────────

describe('RequestRow ≡ makeRequestRow (golden master 9)', () => {
  it('prompt with showSession: false', () => {
    const r = prompt('r1', 's1', 500);
    expect(tsx(<RequestRow r={r} opts={{ showSession: false }} />)).toBe(
      js(makeRequestRow(r, { showSession: false }))
    );
  });

  it('prompt with showSession: true', () => {
    const r = prompt('r1', 's1', 500);
    expect(tsx(<RequestRow r={r} opts={{ showSession: true }} />)).toBe(
      js(makeRequestRow(r, { showSession: true }))
    );
  });

  it('tool_call 정상 응답', () => {
    const r = tool_call('r2', 'turn1', 'Read');
    expect(tsx(<RequestRow r={r} opts={{ showSession: false }} />)).toBe(
      js(makeRequestRow(r, { showSession: false }))
    );
  });

  it('tool_call anomaly flags (spike + loop)', () => {
    const r = tool_call('r3', 'turn2', 'Bash');
    r.duration_ms = 2000;
    const flags = new Set(['spike', 'loop']);
    expect(tsx(<RequestRow r={r} opts={{ showSession: false, anomalyFlags: flags }} />)).toBe(
      js(makeRequestRow(r, { showSession: false, anomalyFlags: flags }))
    );
  });

  it('system 타입', () => {
    const r: any = {
      id: 'r4',
      type: 'system',
      session_id: 's1',
      tokens_input: 0,
      tokens_output: 0,
      timestamp: '2026-04-28T10:02:00Z',
      model: null,
      duration_ms: 10,
    };
    expect(tsx(<RequestRow r={r} opts={{ showSession: true }} />)).toBe(
      js(makeRequestRow(r, { showSession: true }))
    );
  });

  it('토큰 0 (빈 셀)', () => {
    const r = prompt('r5', 's2', 0);
    r.tokens_output = 0;
    expect(tsx(<RequestRow r={r} opts={{ showSession: false }} />)).toBe(
      js(makeRequestRow(r, { showSession: false }))
    );
  });

  it('synthetic 모델', () => {
    const r = prompt('r6', 's3');
    r.model = 'synthetic';
    expect(tsx(<RequestRow r={r} opts={{ showSession: false }} />)).toBe(
      js(makeRequestRow(r, { showSession: false }))
    );
  });

  it('캐시 토큰 포함', () => {
    const r = prompt('r7', 's4', 1000);
    r.cache_read_tokens = 500;
    r.cache_creation_tokens = 250;
    expect(tsx(<RequestRow r={r} opts={{ showSession: false }} />)).toBe(
      js(makeRequestRow(r, { showSession: false }))
    );
  });

  it('anomaly flag: slow만', () => {
    const r = tool_call('r8', 'turn3', 'Write');
    r.duration_ms = 3000;
    const flags = new Set(['slow']);
    expect(tsx(<RequestRow r={r} opts={{ showSession: false, anomalyFlags: flags }} />)).toBe(
      js(makeRequestRow(r, { showSession: false, anomalyFlags: flags }))
    );
  });
});

// ── makeTargetCell 동치 (5) ────────────────────────────────────────────────────

describe('TargetCell ≡ makeTargetCell (golden master 5)', () => {
  it('prompt (user role)', () => {
    const r = prompt('r1', 's1');
    expect(tsx(<TargetCell r={r} />)).toBe(js(makeTargetCell(r)));
  });
  it('tool_call with tool_name', () => {
    const r = tool_call('r2', 'turn1', 'Read');
    expect(tsx(<TargetCell r={r} />)).toBe(js(makeTargetCell(r)));
  });
  it('tool_call tool_name 없음', () => {
    const r = tool_call('r3', 'turn2', '');
    (r as any).tool_name = null;
    expect(tsx(<TargetCell r={r} />)).toBe(js(makeTargetCell(r)));
  });
  it('Agent/Skill 타입', () => {
    const r = tool_call('r4', 'turn3', 'Agent');
    expect(tsx(<TargetCell r={r} />)).toBe(js(makeTargetCell(r)));
  });
  it('system 타입', () => {
    const r: any = { id: 'r5', type: 'system', session_id: 's1' };
    expect(tsx(<TargetCell r={r} />)).toBe(js(makeTargetCell(r)));
  });
});

// ── makeSessionRow 동치 (6) ────────────────────────────────────────────────────

describe('SessionRow ≡ makeSessionRow (golden master 6)', () => {
  it('활성 세션 with preview', () => {
    const s = session('s1', '2026-04-28T10:00:00Z', 10000);
    expect(tsx(<SessionRow s={s} isSelected={false} />)).toBe(js(makeSessionRow(s, false)));
  });
  it('활성 세션 isSelected: true', () => {
    const s = session('s2', '2026-04-28T09:00:00Z', 5000);
    expect(tsx(<SessionRow s={s} isSelected={true} />)).toBe(js(makeSessionRow(s, true)));
  });
  it('종료된 세션', () => {
    const s = session('s3', '2026-04-28T08:00:00Z', 3000);
    s.ended_at = '2026-04-28T08:30:00Z';
    expect(tsx(<SessionRow s={s} isSelected={false} />)).toBe(js(makeSessionRow(s, false)));
  });
  it('미리보기 없는 세션', () => {
    const s = session('s4');
    s.first_prompt_payload = JSON.stringify({});
    expect(tsx(<SessionRow s={s} isSelected={false} />)).toBe(js(makeSessionRow(s, false)));
  });
  it('토큰 많은 세션', () => {
    const s = session('s5', '2026-04-28T07:00:00Z', 1000000);
    expect(tsx(<SessionRow s={s} isSelected={false} />)).toBe(js(makeSessionRow(s, false)));
  });
  it('긴 미리보기 (특수문자)', () => {
    const s = session('s6');
    s.first_prompt_payload = JSON.stringify({
      preview:
        '이것은 매우 긴 프롬프트 텍스트입니다. ' +
        '여러 줄에 걸쳐 있을 수 있으며 특수 문자도 포함됩니다: <>&"\'',
    });
    expect(tsx(<SessionRow s={s} isSelected={false} />)).toBe(js(makeSessionRow(s, false)));
  });
});

// ── 거짓통과 가드 ──────────────────────────────────────────────────────────────
//
// 정규화가 "표현차"만 제거하고 "구조/속성/텍스트 차이"는 보존함을 증명한다.
// 의도적 변형(셀렉터·data-attr·텍스트)을 주입하면 정규화 비교가 반드시 불일치해야 한다.

describe('정규화 거짓통과 가드 — 의도적 변형은 잡혀야 한다', () => {
  // window mock 은 beforeAll 에서 세팅되므로 baseJs 는 각 it 내부에서 lazy 생성.
  const buildBase = () => makeRequestRow(prompt('r1', 's1', 500), { showSession: false });

  it('클래스 변형(cell-target→cell-targetX) 주입 시 불일치', () => {
    const baseJs = buildBase();
    const mutated = baseJs.replace('cell-target', 'cell-targetX');
    expect(js(mutated)).not.toBe(js(baseJs));
  });

  it('data-cell 속성 제거 시 불일치', () => {
    const baseJs = buildBase();
    const mutated = baseJs.replace('data-cell="time"', '');
    expect(js(mutated)).not.toBe(js(baseJs));
  });

  it('텍스트 변형(토큰 값) 주입 시 불일치', () => {
    const baseJs = buildBase();
    const mutated = baseJs.replace('>500<', '>999<');
    expect(js(mutated)).not.toBe(js(baseJs));
  });

  it('data-tone 값 변형 주입 시 불일치', () => {
    const baseJs = buildBase();
    const mutated = baseJs.replace('data-tone="brand"', 'data-tone="warn"');
    expect(js(mutated)).not.toBe(js(baseJs));
  });

  it('정규화는 self-close·공백·엔티티 표현차는 흡수(동일 구조는 일치)', () => {
    // 같은 구조를 self-close/공백/엔티티 표현만 바꿔도 동치로 판정.
    const a = `<td class="x" data-cell="t"><span class="y"/></td>`;
    const b = `<td  class="x"   data-cell="t" >\n  <span class="y"></span>\n</td>`;
    expect(js(a)).toBe(js(b));
    expect(js(`<i title="a'b"></i>`)).toBe(js(`<i title="a&#x27;b"></i>`));
  });
});
