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
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

// P5-07: Bun.file(...).text() (bun 런타임 전용) → Node fs 로 포팅. `new URL(rel, import.meta.url)` 은
//   Vitest 모듈 변환에서 dev-server base(http) 로 재작성되므로, 테스트 파일 자신의 file:// URL 만
//   변환한 뒤 path.resolve 로 대상 소스를 가리킨다(두 러너에서 동일 절대 경로).
const readSource = (rel: string): string =>
  readFileSync(resolvePath(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
import { parseAnomaliesResponse } from '../detail-view';
import { DetailView, SessionDetailHeader } from '../DetailView';

// 테스트 t — useTranslation 출력 고정(vitest.setup __setTestT). afterEach 자동 복원 대응으로 각 테스트 전 재주입.
beforeEach(() => {
  globalThis.__setTestT?.((key, vars) => (vars ? `${key}(${JSON.stringify(vars)})` : key));
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

  it('turnUnifiedBody + flow-pane + log-pane 조립(헤더/badges 는 chart-detail-meta SSoT)', () => {
    const html = r(
      <DetailView sessionId="sess1234abcd" totalTokens={40} turns={turns} activeTurnId="t1" />,
    );
    expect(html).toContain('id="turnUnifiedBody"');
    expect(html).toContain('class="flow-pane"');
    expect(html).toContain('class="log-pane"');
    expect(html).toContain('id="turnLogTable"');
    // 헤더(detailSessionId)·집계뱃지(detailBadges)는 본문에서 제거 — chart-detail-meta(BrowseLayout) 소유.
    expect(html).not.toContain('id="detailSessionId"');
    expect(html).not.toContain('id="detailBadges"');
  });

  it('flow-pane 이 log-pane 보다 앞(슬롯 계약)', () => {
    const html = r(
      <DetailView sessionId="s" totalTokens={40} turns={turns} activeTurnId="t1" />,
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
        totalTokens={40}
        turns={turns}
        activeTurnId="t1"
        activeReminders={['rem']}
      />,
    );
    expect(html).toContain('id="turn-sysrem-chip-2"');
  });

  it('빈 turns → 골격 유지(빈 body)', () => {
    const html = r(<DetailView sessionId="s" totalTokens={0} turns={[]} activeTurnId={null} />);
    expect(html).toContain('id="turnUnifiedBody"');
    expect(html).toContain('class="log-pane"');
  });
});

// ── 순환 해소 (§5 핵심) ──────────────────────────────────────────────────────────
describe('순환 해소 — turn-views ⇄ detail-view 단절', () => {
  it('DetailView.tsx 는 views/detail-view.js·turn-views.js·session-detail.js facade 를 import 하지 않는다', async () => {
    const src = readSource('../DetailView.tsx');
    expect(src).not.toMatch(/from ['"].*views\/detail-view/);
    expect(src).not.toMatch(/from ['"].*turn-views/);
    expect(src).not.toMatch(/from ['"].*\/session-detail['"]/); // 루트 facade
    expect(src).not.toMatch(/import.*applyBloatedSysHeader/);
  });

  it('detail-view.ts 로직 모듈도 facade/turn-views 를 import 하지 않는다', async () => {
    const src = readSource('../detail-view.ts');
    expect(src).not.toMatch(/from ['"].*turn-views/);
    expect(src).not.toMatch(/from ['"].*\/session-detail['"]/);
  });

  it('헤더/뱃지 제거 후에도 본문(turnUnifiedBody)이 throw 없이 렌더', () => {
    // 헤더·집계뱃지(SessionBadges)는 chart-detail-meta(BrowseLayout) 소유로 이전 — DetailView 본문은
    // turnUnifiedBody(flow-pane + log-pane)만 렌더. 단일 턴 입력에도 throw 없이 통과해야 한다.
    const turns: any = [{ turn_index: 1, summary: { total_tokens: 10 }, tool_calls: [] }];
    expect(() =>
      r(
        <DetailView
          sessionId="s"
          totalTokens={10}
          turns={turns}
          activeTurnId={null}
        />,
      ),
    ).not.toThrow();
  });
});
