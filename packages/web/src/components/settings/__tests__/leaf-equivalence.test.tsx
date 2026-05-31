/**
 * leaf-equivalence.test.tsx — 공용 settings leaf 컴포넌트 DOM 계약 검증 (P2-06)
 *
 * 원본: settings-view.js 의 rowHtml/health-badge/option-card/tooltip/code-wrap/inline-copy 마크업.
 * 전략: filter-bar/icons-equivalence 선례 계승 — renderToStaticMarkup 으로 셀렉터/속성/escape 검증.
 *   이 leaf 들은 P2-07(Graph/SQLite/Proxy)이 재사용하므로 계약을 여기서 못박는다.
 */
import { describe, it, expect } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsRow } from '../SettingsRow';
import { HealthBadge } from '../HealthBadge';
import { OptionCard } from '../OptionCard';
import { TooltipHost } from '../TooltipHost';
import { CodeCopyBox } from '../CodeCopyBox';
import { InlineCopyButton } from '../InlineCopyButton';

describe('SettingsRow (settings-view.js:1534 rowHtml)', () => {
  it('status 별 글리프 + settings-row-{status} 클래스', () => {
    expect(renderToStaticMarkup(<SettingsRow label="Bun" status="ok" value="1.0" />)).toContain('settings-row-ok');
    expect(renderToStaticMarkup(<SettingsRow label="Bun" status="ok" value="1.0" />)).toContain('✓');
    expect(renderToStaticMarkup(<SettingsRow label="x" status="warn" value="" />)).toContain('⚠');
    expect(renderToStaticMarkup(<SettingsRow label="x" status="fail" value="" />)).toContain('✕');
  });

  it('label/value 4슬롯 구조(icon/label/value/tail) 보존', () => {
    const html = renderToStaticMarkup(<SettingsRow label="PID" status="ok" value="123" />);
    expect(html).toContain('settings-row-icon');
    expect(html).toContain('settings-row-label');
    expect(html).toContain('settings-row-value');
    expect(html).toContain('settings-row-tail');
  });

  it('label/value 는 React 이스케이프(원본 escHtml 대응)', () => {
    const html = renderToStaticMarkup(<SettingsRow label="<b>x</b>" status="ok" value="a&b" />);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('a&amp;b');
  });

  it('tail(ReactNode) 슬롯 렌더 — jump 버튼 등 보조 컨텐츠', () => {
    const html = renderToStaticMarkup(
      <SettingsRow label="Graph DB" status="warn" value="미설치" tail={<button data-settings-jump="graph">→</button>} />,
    );
    expect(html).toContain('data-settings-jump="graph"');
  });
});

describe('HealthBadge (settings-view.js:476 settings-health-badge)', () => {
  it('is-{variant} + 글리프 + 라벨', () => {
    const html = renderToStaticMarkup(<HealthBadge variant="ok" icon="✓" label="모두 등록" />);
    expect(html).toContain('settings-health-badge is-ok');
    expect(html).toContain('settings-health-icon');
    expect(html).toContain('settings-health-text');
    expect(html).toContain('모두 등록');
  });
  it('warn variant', () => {
    expect(renderToStaticMarkup(<HealthBadge variant="warn" icon="⚠" label="부분" />)).toContain(
      'settings-health-badge is-warn',
    );
  });
  it('라벨 이스케이프', () => {
    expect(renderToStaticMarkup(<HealthBadge variant="ok" icon="✓" label="<x>" />)).toContain('&lt;x&gt;');
  });
});

describe('OptionCard (settings-view.js:432 settings-option-card)', () => {
  it('data-hook-profile + role=radio + aria-checked + is-active', () => {
    const html = renderToStaticMarkup(
      <OptionCard dataAttr="hook-profile" value="full" active label="Full" desc="설명" tooltip="툴팁" />,
    );
    expect(html).toContain('settings-option-card');
    expect(html).toContain('is-active');
    expect(html).toContain('data-hook-profile="full"');
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
  });
  it('비활성: is-active 없음 + aria-checked false', () => {
    const html = renderToStaticMarkup(
      <OptionCard dataAttr="hook-profile" value="minimal" active={false} label="Minimal" desc="d" tooltip="t" />,
    );
    expect(html).not.toContain('is-active');
    expect(html).toContain('aria-checked="false"');
  });
  it('head+label+ⓘ툴팁+desc 구조', () => {
    const html = renderToStaticMarkup(
      <OptionCard dataAttr="graph-mode" value="primary" active={false} label="Primary" desc="설명" tooltip="툴팁" />,
    );
    expect(html).toContain('settings-option-card-head');
    expect(html).toContain('settings-option-card-label');
    expect(html).toContain('settings-option-card-desc');
    expect(html).toContain('settings-tooltip-host');
  });
  it('onSelect onClick 콜백 배선', () => {
    let picked = '';
    const tree = OptionCard({
      dataAttr: 'hook-profile',
      value: 'full',
      active: false,
      label: 'Full',
      desc: 'd',
      tooltip: 't',
      onSelect: (v) => { picked = v; },
    });
    expect(typeof tree.props.onClick).toBe('function');
    (tree.props.onClick as () => void)();
    expect(picked).toBe('full');
  });
});

describe('TooltipHost (settings-view.js:437 settings-tooltip-host)', () => {
  it('ⓘ 아이콘 + role=tooltip 버블 + aria-label', () => {
    const html = renderToStaticMarkup(<TooltipHost text="도움말" />);
    expect(html).toContain('settings-tooltip-host');
    expect(html).toContain('settings-tooltip-icon');
    expect(html).toContain('settings-tooltip-bubble');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('aria-label="도움말"');
    expect(html).toContain('ⓘ');
  });
});

describe('CodeCopyBox (settings-view.js:1505 settings-code-wrap)', () => {
  it('pre.settings-code + 복사버튼(아이콘+라벨)', () => {
    const html = renderToStaticMarkup(<CodeCopyBox code="bun run dev" copyLabel="복사" />);
    expect(html).toContain('settings-code-wrap');
    expect(html).toContain('settings-code');
    expect(html).toContain('settings-code-copy');
    expect(html).toContain('settings-copy-icon');
    expect(html).toContain('bun run dev');
  });
  it('코드 이스케이프', () => {
    expect(renderToStaticMarkup(<CodeCopyBox code="a && b" copyLabel="복사" />)).toContain('a &amp;&amp; b');
  });
});

describe('InlineCopyButton (settings-view.js:211 settings-inline-copy)', () => {
  it('data-copy-text + 아이콘 + title', () => {
    const html = renderToStaticMarkup(<InlineCopyButton text="brew install jq" title="복사" />);
    expect(html).toContain('settings-inline-copy');
    expect(html).toContain('data-copy-text="brew install jq"');
    expect(html).toContain('settings-copy-icon');
    expect(html).toContain('title="복사"');
  });
  it('onCopy 콜백 배선', () => {
    let copied = '';
    const tree = InlineCopyButton({ text: 'cmd', title: 't', onCopy: (t) => { copied = t; } });
    (tree.props.onClick as () => void)();
    expect(copied).toBe('cmd');
  });
});
