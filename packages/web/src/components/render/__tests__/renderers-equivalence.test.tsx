/**
 * renderers-equivalence.test.tsx — TSX render 컴포넌트 골든마스터 스냅샷 (P2-04 → P5 정공법)
 *
 * 연혁:
 *  - (P2-04) oracle = assets/js/renderers.js#{makeRequestRow,makeSessionRow,makeTargetCell} 와
 *    renderToStaticMarkup 출력 동치 검증.
 *  - (P5 데드 vanilla 삭제) renderers.js shim 및 render/rows·cells 의 make* producer 는 React
 *    RequestRow/SessionRow/TargetCell 로 완전 대체되어 런타임 소비처가 없으므로 제거됨.
 *    본 테스트는 검증된 React 출력을 골든마스터 스냅샷으로 동결해 이후 회귀를 잡는다. vanilla oracle 의존 0.
 *
 * 정규화: self-close 통일 / 태그 사이 공백·줄바꿈 축약 / 엔티티 디코드 / 속성명 소문자화.
 *  스냅샷은 정규화된 형태로 저장되어 표현차(self-close·공백·엔티티) 노이즈가 제거된다.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { i18next } from '../../../lib/i18n';

// 신규 TSX(barrel 경유 — barrel 완전성 동시 검증).
import { RequestRow, SessionRow, TargetCell } from '../index';

const NOW_FIXED_MS = new Date('2026-05-04T10:00:00Z').getTime();
const originalDateNow = Date.now;

// 테스트 t — i18next.t/useTranslation 출력을 ko 라벨로 고정(vitest.setup __setTestT). afterEach 가 기본
//   passthrough 로 복원하므로 각 테스트 전 beforeEach 로 재주입한다.
beforeEach(() => {
  globalThis.__setTestT?.((key, vars) => {
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
  });
});

// 골든마스터는 ko 로케일 날짜 포맷(getLocale→i18next.language)으로 동결됨 — jsdom navigator 가 en 이므로 명시 고정.
beforeAll(async () => {
  Date.now = () => NOW_FIXED_MS;
  await i18next.changeLanguage('ko');
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
 *  1) self-close 통일, 2) 태그 사이 공백/줄바꿈 제거 + 내부 다중 공백 축약,
 *  3) 엔티티 디코드, 4) 속성 이름 소문자화(값 보존).
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

// ── 목 데이터 (서버 request-normalizer SSoT 정합) ──────────────────────────────
function prompt(id: string, session_id: string, tokens_input = 100) {
  return {
    id,
    type: 'prompt' as const,
    session_id,
    tokens_input,
    tokens_output: 0,
    tokens_total: tokens_input + 0,
    timestamp: Date.parse('2026-04-28T10:00:00Z'),
    model: 'claude-3-5-sonnet',
    model_fallback_applied: false,
    sub_type: null as 'agent' | 'skill' | 'task' | 'mcp' | null,
    trust_level: 'trusted' as 'trusted' | 'unknown' | 'synthetic' | 'estimated',
    duration_ms: 50,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
  };
}

function tool_call(id: string, turn_id: string, tool_name = 'Read') {
  return {
    id,
    type: 'tool_call' as const,
    session_id: 's1',
    tokens_input: 0,
    tokens_output: 100,
    tokens_total: 0 + 100,
    timestamp: Date.parse('2026-04-28T10:01:00Z'),
    model: null,
    model_fallback_applied: false,
    sub_type: null as 'agent' | 'skill' | 'task' | 'mcp' | null,
    trust_level: 'unknown' as 'trusted' | 'unknown' | 'synthetic' | 'estimated',
    tool_name,
    turn_id,
    duration_ms: 200,
  };
}

function session(id: string, started_at = '2026-04-28T10:00:00Z', total_tokens = 5000) {
  return {
    id,
    started_at: Date.parse(started_at),
    ended_at: null as number | null,
    first_prompt_payload: JSON.stringify({ preview: '첫 프롬프트 미리보기' }),
    total_tokens,
    project_name: '',
  };
}

// ── RequestRow 골든마스터 (9) ───────────────────────────────────────────────────

describe('RequestRow 골든마스터 스냅샷 (9)', () => {
  it('prompt with showSession: false', () => {
    const r = prompt('r1', 's1', 500);
    expect(tsx(<RequestRow r={r} opts={{ showSession: false }} />)).toMatchSnapshot();
  });

  it('prompt with showSession: true', () => {
    const r = prompt('r1', 's1', 500);
    expect(tsx(<RequestRow r={r} opts={{ showSession: true }} />)).toMatchSnapshot();
  });

  it('tool_call 정상 응답', () => {
    const r = tool_call('r2', 'turn1', 'Read');
    expect(tsx(<RequestRow r={r} opts={{ showSession: false }} />)).toMatchSnapshot();
  });

  it('tool_call anomaly flags (spike + loop)', () => {
    const r = tool_call('r3', 'turn2', 'Bash');
    r.duration_ms = 2000;
    const flags = new Set(['spike', 'loop']);
    expect(tsx(<RequestRow r={r} opts={{ showSession: false, anomalyFlags: flags }} />)).toMatchSnapshot();
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
    expect(tsx(<RequestRow r={r} opts={{ showSession: true }} />)).toMatchSnapshot();
  });

  it('토큰 0 (빈 셀)', () => {
    const r = prompt('r5', 's2', 0);
    r.tokens_output = 0;
    expect(tsx(<RequestRow r={r} opts={{ showSession: false }} />)).toMatchSnapshot();
  });

  it('synthetic 모델', () => {
    const r = prompt('r6', 's3');
    r.model = 'synthetic';
    expect(tsx(<RequestRow r={r} opts={{ showSession: false }} />)).toMatchSnapshot();
  });

  it('캐시 토큰 포함', () => {
    const r = prompt('r7', 's4', 1000);
    r.cache_read_tokens = 500;
    r.cache_creation_tokens = 250;
    expect(tsx(<RequestRow r={r} opts={{ showSession: false }} />)).toMatchSnapshot();
  });

  it('anomaly flag: slow만', () => {
    const r = tool_call('r8', 'turn3', 'Write');
    r.duration_ms = 3000;
    const flags = new Set(['slow']);
    expect(tsx(<RequestRow r={r} opts={{ showSession: false, anomalyFlags: flags }} />)).toMatchSnapshot();
  });
});

// ── TargetCell 골든마스터 (5) ───────────────────────────────────────────────────

describe('TargetCell 골든마스터 스냅샷 (5)', () => {
  it('prompt (user role)', () => {
    const r = prompt('r1', 's1');
    expect(tsx(<TargetCell r={r} />)).toMatchSnapshot();
  });
  it('tool_call with tool_name', () => {
    const r = tool_call('r2', 'turn1', 'Read');
    expect(tsx(<TargetCell r={r} />)).toMatchSnapshot();
  });
  it('tool_call tool_name 없음', () => {
    const r = tool_call('r3', 'turn2', '');
    (r as any).tool_name = null;
    expect(tsx(<TargetCell r={r} />)).toMatchSnapshot();
  });
  it('Agent/Skill 타입', () => {
    const r = tool_call('r4', 'turn3', 'Agent');
    expect(tsx(<TargetCell r={r} />)).toMatchSnapshot();
  });
  it('system 타입', () => {
    const r: any = { id: 'r5', type: 'system', session_id: 's1' };
    expect(tsx(<TargetCell r={r} />)).toMatchSnapshot();
  });
});

// ── SessionRow 골든마스터 (6) ───────────────────────────────────────────────────

describe('SessionRow 골든마스터 스냅샷 (6)', () => {
  it('활성 세션 with preview', () => {
    const s = session('s1', '2026-04-28T10:00:00Z', 10000);
    expect(tsx(<SessionRow s={s} isSelected={false} />)).toMatchSnapshot();
  });
  it('활성 세션 isSelected: true', () => {
    const s = session('s2', '2026-04-28T09:00:00Z', 5000);
    expect(tsx(<SessionRow s={s} isSelected={true} />)).toMatchSnapshot();
  });
  it('종료된 세션', () => {
    const s = session('s3', '2026-04-28T08:00:00Z', 3000);
    s.ended_at = Date.parse('2026-04-28T08:30:00Z');
    expect(tsx(<SessionRow s={s} isSelected={false} />)).toMatchSnapshot();
  });
  it('미리보기 없는 세션', () => {
    const s = session('s4');
    s.first_prompt_payload = JSON.stringify({});
    expect(tsx(<SessionRow s={s} isSelected={false} />)).toMatchSnapshot();
  });
  it('토큰 많은 세션', () => {
    const s = session('s5', '2026-04-28T07:00:00Z', 1000000);
    expect(tsx(<SessionRow s={s} isSelected={false} />)).toMatchSnapshot();
  });
  it('긴 미리보기 (특수문자)', () => {
    const s = session('s6');
    s.first_prompt_payload = JSON.stringify({
      preview:
        '이것은 매우 긴 프롬프트 텍스트입니다. ' +
        '여러 줄에 걸쳐 있을 수 있으며 특수 문자도 포함됩니다: <>&"\'',
    });
    expect(tsx(<SessionRow s={s} isSelected={false} />)).toMatchSnapshot();
  });
});

// ── 정규화 거짓통과 가드 (oracle 무관, 정규화 자체 계약) ─────────────────────────

describe('정규화 거짓통과 가드 — 표현차는 흡수, 구조/속성/값 차이는 보존', () => {
  it('정규화는 self-close·공백·엔티티 표현차는 흡수(동일 구조는 일치)', () => {
    const a = `<td class="x" data-cell="t"><span class="y"/></td>`;
    const b = `<td  class="x"   data-cell="t" >\n  <span class="y"></span>\n</td>`;
    expect(normalizeHtml(a)).toBe(normalizeHtml(b));
    expect(normalizeHtml(`<i title="a'b"></i>`)).toBe(normalizeHtml(`<i title="a&#x27;b"></i>`));
  });

  it('클래스/속성/텍스트/값 차이는 불일치로 잡힌다', () => {
    const base = `<td class="cell-target" data-cell="time" data-tone="brand">500</td>`;
    expect(normalizeHtml(base)).not.toBe(normalizeHtml(base.replace('cell-target', 'cell-targetX')));
    expect(normalizeHtml(base)).not.toBe(normalizeHtml(base.replace('data-cell="time"', '')));
    expect(normalizeHtml(base)).not.toBe(normalizeHtml(base.replace('>500<', '>999<')));
    expect(normalizeHtml(base)).not.toBe(normalizeHtml(base.replace('data-tone="brand"', 'data-tone="warn"')));
  });
});
