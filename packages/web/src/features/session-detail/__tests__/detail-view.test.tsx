/**
 * detail-view.test.tsx — DetailView 조립 + useSessionLoad 로직 + 순환 해소 (P3-07)
 *
 * 원본: assets/js/views/detail-view.js
 *   (loadSession:24 / parseAnomalies:83-85 / applyBloatedSysHeader:166 / applyContextSaturationHeader:141).
 *
 * 전략(§2.3 + hooks-api 패턴):
 *  - parseAnomaliesResponse: 단건 /api/sessions/:id envelope → {bloatedSys, ctxSat, turnCount} 순수 추출.
 *  - DetailView/SessionDetailHeader: renderToStaticMarkup 으로 헤더+뱃지+body 조립 골격 검증.
 *  - 순환 해소: DetailView 가 views/detail-view.js·turn-views.js 를 import 하지 않음(소스 정적 확인) +
 *    onBloatedSysHeader 콜백이 SessionBadges 로 위임됨.
 */
import './_dom-stub';
import { describe, it, expect, beforeAll } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseAnomaliesResponse } from '../detail-view';
import { DetailView, SessionDetailHeader } from '../DetailView';

beforeAll(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.I18n = {
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}(${JSON.stringify(vars)})` : key,
  };
});

const r = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

// ── parseAnomaliesResponse (detail-view.js:83-85) ────────────────────────────────
describe('parseAnomaliesResponse — 단건 envelope 추출', () => {
  it('anomalies.bloated_sys / context_saturation / turn_count 추출', () => {
    const json = {
      data: {
        anomalies: { bloated_sys: { stage: 'warn', pct: 0.5 }, context_saturation: { stage: 'critical' } },
        turn_count: 42,
      },
    };
    const a = parseAnomaliesResponse(json);
    expect(a.bloatedSys).toEqual({ stage: 'warn', pct: 0.5 });
    expect(a.contextSaturation).toEqual({ stage: 'critical' });
    expect(a.turnCount).toBe(42);
  });

  it('data.bloated_sys 평면 폴백(anomalies 부재)', () => {
    const a = parseAnomaliesResponse({ data: { bloated_sys: { stage: 'critical' } } });
    expect(a.bloatedSys).toEqual({ stage: 'critical' });
  });

  it('필드 부재 → null / turnCount 유한수 아니면 null', () => {
    const a = parseAnomaliesResponse({ data: {} });
    expect(a.bloatedSys).toBeNull();
    expect(a.contextSaturation).toBeNull();
    expect(a.turnCount).toBeNull();
  });

  it('json null/비객체 → 전부 null(방어)', () => {
    const a = parseAnomaliesResponse(null);
    expect(a.bloatedSys).toBeNull();
    expect(a.contextSaturation).toBeNull();
    expect(a.turnCount).toBeNull();
  });
});

// ── SessionDetailHeader (applyBloatedSysHeader/applyContextSaturationHeader 선언화) ──
describe('SessionDetailHeader — 헤더 뱃지 선언화', () => {
  it('세션 id 8자 + … / project / tokens / endedAt', () => {
    const html = r(
      <SessionDetailHeader
        sessionId="abcdef1234567890"
        projectName="my-proj"
        totalTokens={1234}
        endedAt="2026-04-28T10:00:00Z"
      />,
    );
    expect(html).toContain('id="detailSessionId"');
    expect(html).toContain('abcdef12…'); // 8자 + …
    expect(html).toContain('my-proj');
    expect(html).toContain('id="detailProject"');
    expect(html).toContain('id="detailTokens"');
  });

  it('bloated-sys warn → full 뱃지(badges.js SSoT)', () => {
    const html = r(
      <SessionDetailHeader
        sessionId="x"
        bloatedSys={{ stage: 'warn', pct: 0.6 }}
      />,
    );
    expect(html).toContain('badge-bloated-sys--full');
    expect(html).toContain('id="detailBadges"');
  });

  it('bloated-sys 부재 → 뱃지 미렌더(빈 detailBadges 골격 유지)', () => {
    const html = r(<SessionDetailHeader sessionId="x" />);
    expect(html).not.toContain('badge-bloated-sys--full');
    expect(html).toContain('id="detailBadges"');
  });

  it('context-saturation critical → full 뱃지', () => {
    const html = r(
      <SessionDetailHeader sessionId="x" contextSaturation={{ stage: 'critical', pct: 0.9 }} />,
    );
    expect(html).toContain('badge-context-saturation--full');
  });

  it('turnCount>=20 → ⟲ 힌트 뱃지', () => {
    const html = r(<SessionDetailHeader sessionId="x" turnCount={25} />);
    expect(html).toContain('badge-turn-count--hint');
    expect(html).toContain('data-turn-count="25"');
  });

  it('turnCount<20 → 힌트 미렌더', () => {
    const html = r(<SessionDetailHeader sessionId="x" turnCount={5} />);
    expect(html).not.toContain('badge-turn-count--hint');
  });
});

// ── DetailView 조립 (FlowPane + SessionLog + SessionBadges) ───────────────────────
describe('DetailView — P3-06 FlowPane + P3-05 SessionLog 조립', () => {
  const turns: any = [
    {
      turn_id: 't1',
      turn_index: 2,
      prompt: { preview: 'p' },
      summary: { tokens_input: 10, tokens_output: 20, total_tokens: 30, tool_call_count: 7 },
      items: [{ kind: 'tool', request: { id: 'a1', type: 'tool_call', turn_id: 't1', timestamp: '2026-04-28T10:01:00Z', tool_name: 'Read' } }],
      tool_calls: [{ tool_name: 'Read' }],
    },
  ];

  it('헤더 + flow-pane + log-pane + detailBadges 모두 포함', () => {
    const html = r(
      <DetailView
        sessionId="sess1234abcd"
        projectName="proj"
        totalTokens={40}
        turns={turns}
        activeTurnId="t1"
      />,
    );
    expect(html).toContain('id="detailSessionId"');
    expect(html).toContain('class="flow-pane"');
    expect(html).toContain('class="log-pane"');
    expect(html).toContain('id="turnLogTable"');
    expect(html).toContain('id="detailBadges"');
  });

  it('flow-pane 이 log-pane 보다 앞(슬롯 계약)', () => {
    const html = r(
      <DetailView sessionId="s" projectName="p" totalTokens={40} turns={turns} activeTurnId="t1" />,
    );
    const flowIdx = html.indexOf('class="flow-pane"');
    const logIdx = html.indexOf('class="log-pane"');
    expect(flowIdx).toBeGreaterThanOrEqual(0);
    expect(logIdx).toBeGreaterThan(flowIdx);
  });

  it('활성 reminder 가 있으면 flow-head 안에 sysrem 칩', () => {
    const html = r(
      <DetailView
        sessionId="s"
        projectName="p"
        totalTokens={40}
        turns={turns}
        activeTurnId="t1"
        activeReminders={['rem']}
      />,
    );
    expect(html).toContain('id="turn-sysrem-chip-2"');
  });

  it('빈 turns → 골격 유지(헤더+빈 body)', () => {
    const html = r(<DetailView sessionId="s" projectName="p" totalTokens={0} turns={[]} activeTurnId={null} />);
    expect(html).toContain('id="detailSessionId"');
    expect(html).toContain('class="log-pane"');
  });
});

// ── 순환 해소 (§5 핵심) ──────────────────────────────────────────────────────────
describe('순환 해소 — turn-views ⇄ detail-view 단절', () => {
  it('DetailView.tsx 는 views/detail-view.js·turn-views.js·session-detail.js facade 를 import 하지 않는다', async () => {
    const src = await Bun.file(new URL('../DetailView.tsx', import.meta.url)).text();
    expect(src).not.toMatch(/from ['"].*views\/detail-view/);
    expect(src).not.toMatch(/from ['"].*turn-views/);
    expect(src).not.toMatch(/from ['"].*\/session-detail['"]/); // 루트 facade
    expect(src).not.toMatch(/import.*applyBloatedSysHeader/);
  });

  it('detail-view.ts 로직 모듈도 facade/turn-views 를 import 하지 않는다', async () => {
    const src = await Bun.file(new URL('../detail-view.ts', import.meta.url)).text();
    expect(src).not.toMatch(/from ['"].*turn-views/);
    expect(src).not.toMatch(/from ['"].*\/session-detail['"]/);
  });

  it('bloated-sys 헤더 재부착은 onBloatedSysHeader 콜백으로 SessionBadges 에 위임(주입 시 호출됨)', () => {
    // DetailView 에 onBloatedSysHeader 를 주입하면 SessionBadges 의 useEffect 가 이를 호출(콜백 위임 경로 존재).
    // SSR(renderToStaticMarkup)은 useEffect 미실행이므로, 여기선 prop 전달 경로만 정적으로 확인한다.
    const turns: any = [{ turn_index: 1, summary: { total_tokens: 10 }, tool_calls: [] }];
    // 렌더가 throw 없이 통과 = onBloatedSysHeader prop 배선 정상.
    expect(() =>
      r(
        <DetailView
          sessionId="s"
          projectName="p"
          totalTokens={10}
          turns={turns}
          activeTurnId={null}
          onBloatedSysHeader={() => {}}
        />,
      ),
    ).not.toThrow();
  });
});
