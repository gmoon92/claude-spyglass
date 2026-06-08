/**
 * anomaly-badges-equivalence.test.tsx — anomaly 배지 React 골든마스터 스냅샷 (B-2)
 *
 * 연혁:
 *  - (B-2 도입) oracle = assets/js/render/badges.js 의 HTML-string producer 와 정규화 후
 *    1:1 동치(.toBe) 검증 + 스냅샷 동결. 이때 React 출력이 vanilla HTML 과 byte-동치임을 확인했다.
 *  - (B-2 vanilla 삭제) anomaly/toolStatus producer 는 React 컴포넌트(render/anomaly-badges.tsx)로
 *    완전 대체되어 런타임 소비처가 0 이므로 badges.ts 에서 제거됨. 본 테스트는 검증된 React 출력을
 *    골든마스터 스냅샷으로 동결해 이후 회귀를 잡는다(vanilla oracle 의존 0 — renderers-equivalence 선례).
 *
 *  - 판정/포맷 SSoT 는 lib/anomaly-field.ts(순수) 단일.
 *  - i18n: useTranslation → parseMissingKeyHandler 폴백(window.I18n.t) 로 {var} 보간 해석.
 *
 * 정규화: self-close 통일 / 태그 사이 공백·줄바꿈 축약 / 엔티티 디코드 / 속성명 소문자화.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  BloatedSysBadge,
  ContextSaturationBadge,
  AgentSpikeBadge,
  TurnSpikeSummary,
} from '../anomaly-badges';

// ── i18n stub — React(useTranslation→parseMissingKeyHandler 폴백 window.I18n.t).
//   locales/en/ui.json 의 anomaly 키를 {var} 보간으로 재현(라벨/tooltip 문자열 고정).
const I18N_MAP: Record<string, string> = {
  'ui:anomaly.bloated-sys.warn.label': 'sys {pct}%',
  'ui:anomaly.bloated-sys.warn.tooltip': 'system context bloated ({pct}%)',
  'ui:anomaly.bloated-sys.warn.modal': 'system bloated · /mcp list',
  'ui:anomaly.bloated-sys.critical.label': 'bloated {pct}%',
  'ui:anomaly.bloated-sys.critical.tooltip': 'system dominates user ({pct}%)',
  'ui:anomaly.bloated-sys.critical.modal': "system dominates · compact won't help",
  'ui:anomaly.context-saturation.warn.label': '▦ ctx {pct}%',
  'ui:anomaly.context-saturation.warn.tooltip': 'Session context {pct}% used — approaching limit',
  'ui:anomaly.context-saturation.warn.modal': '/clear or /compact recommended',
  'ui:anomaly.context-saturation.critical.label': '▦ ctx {pct}%',
  'ui:anomaly.context-saturation.critical.tooltip': 'Session context {pct}% used — approaching limit',
  'ui:anomaly.context-saturation.critical.modal': '/clear or /compact recommended',
  'ui:anomaly.agent-spike.tooltip': 'Agent is {n}× parent row',
  'ui:anomaly.agent-spike.modal': 'Agent token spike · ↑×{n} · split session',
  'ui:anomaly.agent-spike.summary': '↑{n}× larger than parent row',
};

/** {var} 단일 중괄호 보간 — locales JSON·i18next prefix/suffix 와 동일. */
function interpolate(tpl: string, vars?: Record<string, unknown>): string {
  if (!vars) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (_m, k) => (vars[k] != null ? String(vars[k]) : `{${k}}`));
}

// 테스트 t — useTranslation 출력을 I18N_MAP({var} 보간)으로 고정(vitest.setup __setTestT).
//   afterEach 가 기본 passthrough 로 자동 복원하므로 각 테스트 전 재주입한다.
beforeEach(() => {
  globalThis.__setTestT?.((key, vars) => {
    const tpl = I18N_MAP[key];
    return tpl != null ? interpolate(tpl, vars) : key;
  });
});

// ── 정규화(renderers-equivalence 동일 계약) ──────────────────────────────────────
function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

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

// ── bloated-sys (mini/full/dot × warn/critical) ─────────────────────────────────
describe('BloatedSysBadge 골든마스터', () => {
  const warn = { stage: 'warn', pct: 0.42 };
  const critical = { stage: 'critical', pct: 0.71 };
  const normal = { stage: 'normal', pct: 0.1 };

  it('mini warn', () => {
    expect(tsx(<BloatedSysBadge bloatedSys={warn} variant="mini" />)).toMatchSnapshot();
  });
  it('mini critical', () => {
    expect(tsx(<BloatedSysBadge bloatedSys={critical} variant="mini" />)).toMatchSnapshot();
  });
  it('full warn', () => {
    expect(tsx(<BloatedSysBadge bloatedSys={warn} variant="full" />)).toMatchSnapshot();
  });
  it('full critical', () => {
    expect(tsx(<BloatedSysBadge bloatedSys={critical} variant="full" />)).toMatchSnapshot();
  });
  it('dot critical (노출)', () => {
    expect(tsx(<BloatedSysBadge bloatedSys={critical} variant="dot" />)).toMatchSnapshot();
  });
  it('dot warn (미노출 — 빈 출력)', () => {
    expect(renderToStaticMarkup(<BloatedSysBadge bloatedSys={warn} variant="dot" />)).toBe('');
  });
  it('normal (미노출)', () => {
    expect(renderToStaticMarkup(<BloatedSysBadge bloatedSys={normal} variant="mini" />)).toBe('');
  });
  it('pct 누락 → ?', () => {
    expect(tsx(<BloatedSysBadge bloatedSys={{ stage: 'warn' }} variant="mini" />)).toMatchSnapshot();
  });
});

// ── context-saturation (full × warn/critical) ───────────────────────────────────
describe('ContextSaturationBadge 골든마스터', () => {
  const warn = { stage: 'warn', pct: 0.55 };
  const critical = { stage: 'critical', pct: 0.88 };
  it('warn', () => {
    expect(tsx(<ContextSaturationBadge ctxSat={warn} />)).toMatchSnapshot();
  });
  it('critical', () => {
    expect(tsx(<ContextSaturationBadge ctxSat={critical} />)).toMatchSnapshot();
  });
  it('normal (미노출)', () => {
    expect(renderToStaticMarkup(<ContextSaturationBadge ctxSat={{ stage: 'normal' }} />)).toBe('');
  });
});

// ── agent-spike ──────────────────────────────────────────────────────────────────
describe('AgentSpikeBadge 골든마스터', () => {
  const spike = { stage: 'spike', multiplier: 4.2 };
  it('spike ×4', () => {
    expect(tsx(<AgentSpikeBadge agentSpike={spike} />)).toMatchSnapshot();
  });
  it('multiplier<3 (미노출)', () => {
    expect(renderToStaticMarkup(<AgentSpikeBadge agentSpike={{ stage: 'spike', multiplier: 2 }} />)).toBe('');
  });
  it('null (미노출)', () => {
    expect(renderToStaticMarkup(<AgentSpikeBadge agentSpike={null} />)).toBe('');
  });
});

// ── turn-spike-summary (+ sparkline) ─────────────────────────────────────────────
describe('TurnSpikeSummary 골든마스터', () => {
  const spike = { stage: 'spike', multiplier: 5 };
  it('spike with samples', () => {
    const samples = [10, 20, 5, 40, 15];
    expect(tsx(<TurnSpikeSummary agentSpike={spike} samples={samples} />)).toMatchSnapshot();
  });
  it('spike with empty samples (baseline)', () => {
    expect(tsx(<TurnSpikeSummary agentSpike={spike} samples={[]} />)).toMatchSnapshot();
  });
  it('null (미노출)', () => {
    expect(renderToStaticMarkup(<TurnSpikeSummary agentSpike={null} samples={[]} />)).toBe('');
  });
});
