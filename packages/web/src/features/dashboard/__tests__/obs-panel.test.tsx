/**
 * obs-panel.test.tsx — Observability 카드 5종 골든마스터 (P3-09 핵심 산출물)
 *
 * review-completeness M1 가 지목한 "직접 테스트 0 사각지대" 해소:
 *  obs-panel 카드(burn-rate/cache-health/live-pulse/tool-categories/anomaly-badge)는
 *  P3-03 api 역전에서 호출부만 dispatch 로 바뀔 뿐, 뷰 컴포넌트 TSX 이식 + 골든마스터가
 *  없었다. 본 파일이 카드 렌더 출력(클래스/구조/빈상태/델타/임계)을 결정론으로 고정한다.
 *
 * 결정론: t stub(key→`t:key`) 주입(window.I18n 무의존). Date.now/fmtRelative 미사용 케이스 위주,
 *  fmtRelative 사용 카드는 last_event_ts 절대값으로 표기 동치만 확인.
 *
 * 전략(filter-bar/Chart 계승): renderToStaticMarkup 마크업 계약 검증.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { i18next } from '../../../lib/i18n';
import {
  BurnRateCard,
  CacheHealthCard,
  LivePulseCard,
  ToolCategoriesCard,
  AnomalyBadge,
} from '../ObsPanel';

/**
 * 카드 자체 i18n 은 useTranslation 직접 구독(self-subscribe). 결정론을 위해 vitest.setup 의
 * __setTestT 로 key 를 그대로 노출하는 t 를 주입한다(라벨 식별). formatters.js 의 fmtRelative/fmt 가
 * 내부에서 getLocale(i18next.language)을 참조하므로 'en' 로케일을 고정한다.
 * 주의: Chart.tsx hasRealDom 가드가 bare window 스텁에서 useLayoutEffect 를 회피하므로 안전.
 */
beforeAll(async () => { await i18next.changeLanguage('en'); });
afterAll(async () => { await i18next.changeLanguage('ko'); });

// 결정론 t — key 를 그대로 노출(vars 무시)해 라벨 식별. afterEach(vitest.setup)가 기본 t 로 복원하므로
//   매 테스트 전 재주입한다.
beforeEach(() => {
  (globalThis as { __setTestT?: (fn: (key: string) => string) => void }).__setTestT?.((key) => `t:${key}`);
});

describe('BurnRateCard — 골든마스터', () => {
  it('빈 payload → obs-card-empty + no-data 라벨, id=cardBurnRate', () => {
    const html = renderToStaticMarkup(<BurnRateCard payload={null} />);
    expect(html).toContain('id="cardBurnRate"');
    expect(html).toContain('obs-card-empty');
    expect(html).toContain('t:ui:obs-panel.no-data');
  });

  it('current_total=0 → 빈 상태(원본 early-return 조건)', () => {
    const html = renderToStaticMarkup(
      <BurnRateCard payload={{ buckets: [{ tokens: 5 }], current_total: 0 }} />,
    );
    expect(html).toContain('obs-card-empty');
  });

  it('정상 → value/spark, delta_pct>0 → is-up + Chevron(+%)', () => {
    const html = renderToStaticMarkup(
      <BurnRateCard
        payload={{
          buckets: [{ tokens: 100 }, { tokens: 200 }],
          current_total: 300,
          yesterday_same_window: 250,
          delta_pct: 12.3,
        }}
      />,
    );
    expect(html).toContain('obs-card-value');
    expect(html).toContain('obs-card-trend is-up');
    expect(html).toContain('+12.3%');
    expect(html).toContain('data-dir="up"'); // Chevron 재사용
    expect(html).toContain('obs-card-spark');
    expect(html).toContain('<svg'); // sparkline
    expect(html).toContain('t:ui:obs-panel.yesterday');
  });

  it('delta_pct<0 → is-down, delta_pct=0/null → flat "—"', () => {
    const down = renderToStaticMarkup(
      <BurnRateCard payload={{ buckets: [{ tokens: 1 }], current_total: 1, delta_pct: -4.5 }} />,
    );
    expect(down).toContain('obs-card-trend is-down');
    expect(down).toContain('-4.5%');
    const flat = renderToStaticMarkup(
      <BurnRateCard payload={{ buckets: [{ tokens: 1 }], current_total: 1, delta_pct: 0 }} />,
    );
    expect(flat).toMatch(/obs-card-trend">—|obs-card-trend">\s*—/);
    expect(flat).not.toContain('is-up');
    expect(flat).not.toContain('is-down');
  });

  it('yesterday_same_window=0 → sub 빈 문자열(yesterday 라벨 미노출)', () => {
    const html = renderToStaticMarkup(
      <BurnRateCard payload={{ buckets: [{ tokens: 1 }], current_total: 1, yesterday_same_window: 0 }} />,
    );
    expect(html).not.toContain('t:ui:obs-panel.yesterday');
  });
});

describe('CacheHealthCard — 골든마스터', () => {
  it('hit_rate_now=null → 빈 상태', () => {
    const html = renderToStaticMarkup(
      <CacheHealthCard payload={{ buckets: [{ hit_rate: 0.5 }], hit_rate_now: null }} />,
    );
    expect(html).toContain('id="cardCacheHealth"');
    expect(html).toContain('t:ui:obs-panel.no-cache');
  });

  it('hit_rate 임계 톤: ≥0.7 is-up / ≥0.3 is-down / <0.3 is-warn', () => {
    const high = renderToStaticMarkup(
      <CacheHealthCard payload={{ buckets: [{ hit_rate: 0.8 }], hit_rate_now: 0.8 }} />,
    );
    expect(high).toContain('obs-card-trend is-up');
    expect(high).toContain('80.0%');
    const mid = renderToStaticMarkup(
      <CacheHealthCard payload={{ buckets: [{ hit_rate: 0.5 }], hit_rate_now: 0.5 }} />,
    );
    expect(mid).toContain('obs-card-trend is-down');
    const low = renderToStaticMarkup(
      <CacheHealthCard payload={{ buckets: [{ hit_rate: 0.1 }], hit_rate_now: 0.1 }} />,
    );
    expect(low).toContain('obs-card-trend is-warn');
  });

  it('line sparkline + savings 라벨', () => {
    const html = renderToStaticMarkup(
      <CacheHealthCard
        payload={{ buckets: [{ hit_rate: 0.4 }, { hit_rate: 0.6 }], hit_rate_now: 0.6, savings_tokens_total: 9000 }}
      />,
    );
    expect(html).toContain('t:ui:obs-panel.savings');
    expect(html).toContain('obs-card-spark');
  });
});

describe('LivePulseCard — 골든마스터', () => {
  it('active_count=0 + no last_event → 빈 상태', () => {
    const html = renderToStaticMarkup(
      <LivePulseCard payload={{ active_count: 0, last_event_ts: null }} />,
    );
    expect(html).toContain('id="cardLivePulse"');
    expect(html).toContain('t:ui:obs-panel.no-activity');
  });

  it('active_count>0 → is-up + count, recent-activity 라벨', () => {
    const html = renderToStaticMarkup(
      <LivePulseCard payload={{ active_count: 3, last_event_ts: 1_700_000_000_000, recent_calls: [1, 2, 3] }} />,
    );
    expect(html).toContain('obs-card-trend is-up');
    expect(html).toContain('t:ui:obs-panel.recent-activity');
    expect(html).toContain('obs-card-spark');
  });

  it('active_count=0 이지만 last_event 있으면 노출(is-up 아님)', () => {
    const html = renderToStaticMarkup(
      <LivePulseCard payload={{ active_count: 0, last_event_ts: 1_700_000_000_000 }} />,
    );
    expect(html).not.toContain('obs-card-empty');
    expect(html).toContain('obs-card-value');
  });
});

describe('ToolCategoriesCard — 골든마스터(2 모드 + suppressed)', () => {
  it('빈 배열 → no-tool-calls', () => {
    const html = renderToStaticMarkup(<ToolCategoriesCard payload={[]} />);
    expect(html).toContain('t:ui:obs-panel.no-tool-calls');
  });

  it('전역 모드: 카테고리 행 + cls/ds-tone + tooltip', () => {
    const html = renderToStaticMarkup(
      <ToolCategoriesCard
        payload={[
          { category: 'Agent', request_count: 10, percentage: 50 },
          { category: 'MCP', request_count: 5 },
        ]}
      />,
    );
    expect(html).toContain('obs-cat-bar-fill--agent');
    expect(html).toContain('data-tone="warn"'); // agent → warn
    expect(html).toContain('obs-cat-bar-fill--mcp');
    expect(html).toContain('data-tone="info"'); // mcp → info
    expect(html).toContain('data-obs-tooltip="cat-Agent"');
    expect(html).toContain('50.0%'); // percentage 우선 표기
    expect(html).toContain('>5<'); // percentage 없으면 request_count
  });

  it('meta-docs 모드: obs-card-meta-docs + obs-meta-row + invocations', () => {
    const html = renderToStaticMarkup(
      <ToolCategoriesCard payload={{ mode: 'meta-docs', items: [{ name: 'reviewer', invocations: 8 }] }} />,
    );
    expect(html).toContain('obs-card-meta-docs');
    expect(html).toContain('obs-meta-row');
    expect(html).toContain('reviewer');
    expect(html).toContain('>8<');
  });

  it('meta-docs 빈 items → no-behavior-defs', () => {
    const html = renderToStaticMarkup(
      <ToolCategoriesCard payload={{ mode: 'meta-docs', items: [] }} />,
    );
    expect(html).toContain('t:ui:obs-panel.no-behavior-defs');
  });

  it('mode=meta-docs 인데 배열 payload → suppressed(렌더 없음, null)', () => {
    const html = renderToStaticMarkup(
      <ToolCategoriesCard payload={[{ category: 'Agent', request_count: 1 }]} mode="meta-docs" />,
    );
    expect(html).toBe(''); // null → 빈 마크업(원본 early return = 덮어쓰기 방지)
  });
});

describe('AnomalyBadge — 골든마스터', () => {
  it('total=0 → hidden, 콘텐츠 없음', () => {
    const html = renderToStaticMarkup(<AnomalyBadge payload={{ total: 0 }} />);
    expect(html).toContain('id="anomalyBadge"');
    expect(html).toContain('hidden');
    expect(html).not.toContain('anomaly-badge-count');
  });

  it('null payload → hidden', () => {
    const html = renderToStaticMarkup(<AnomalyBadge payload={null} />);
    expect(html).toContain('hidden');
  });

  it('total>0 → dot + count + tooltip', () => {
    const html = renderToStaticMarkup(<AnomalyBadge payload={{ total: 4, counts: { token_spike: 4 } }} />);
    expect(html).toContain('data-obs-tooltip="anomaly"');
    expect(html).toContain('anomaly-badge-dot ds-dot');
    expect(html).toContain('data-tone="pulse"');
    expect(html).toContain('anomaly-badge-count');
    expect(html).toContain('>4<');
    expect(html).not.toMatch(/id="anomalyBadge"[^>]*hidden/);
  });
});
