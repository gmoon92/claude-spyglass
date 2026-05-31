// app/SettingsLayout.tsx — settings 모드 레이아웃 셸 (P4-06)
//
// 원본: main.js enterSettingsMode + settings-view.js(1590) 의 6 sub-tab 라우터.
//   진단/Hook/서버/Graph/SQLite/Proxy 6 패널을 좌측 네비 + 활성 패널 region 으로 조립한다.
//
// 자기완결 결선: settings 6 패널은 각자 useAsyncResource(use-settings-diag) 로 자체 fetch 한다
//   (DiagPanel/HooksPanel/... 헤더 §데이터 페칭). 따라서 본 셸은 데이터 오케스트레이션 없이
//   완전 결선된다 — browse/metadocs 와 달리 F3 역전 의존이 없다. 활성 탭은 셸 로컬 상태(useState).
//   SSR(renderToStaticMarkup)에서는 useAsyncResource effect 미발화 → 각 패널이 loading 셸을 렌더.
//
// 레이어(architecture.md §1.3): app → features(settings) 정방향.

import { useState } from 'react';
import type { ReactElement } from 'react';
import {
  DiagPanel, HooksPanel, ServerPanel, GraphPanel, SqlitePanel, ProxyPanel,
} from '../features/settings';
import { tt } from './i18n-labeler';

/** 6 sub-tab 식별자(settings-view.js 탭 순서 1:1). */
type SettingsTab = 'diag' | 'hooks' | 'server' | 'graph' | 'sqlite' | 'proxy';

/** 네비 항목 정의(SSoT) — 탭 키 + i18n 라벨 키. */
const SETTINGS_TABS: ReadonlyArray<{ key: SettingsTab; labelKey: string }> = [
  { key: 'diag', labelKey: 'ui.settings-view.tab.diag' },
  { key: 'hooks', labelKey: 'ui.settings-view.tab.hooks' },
  { key: 'server', labelKey: 'ui.settings-view.tab.server' },
  { key: 'graph', labelKey: 'ui.settings-view.tab.graph' },
  { key: 'sqlite', labelKey: 'ui.settings-view.tab.sqlite' },
  { key: 'proxy', labelKey: 'ui.settings-view.tab.proxy' },
];

/** 활성 탭 → 해당 패널. 각 패널은 t 주입(+자체 fetch). diag 만 onJump 로 탭 전환 통지. */
function renderPanel(tab: SettingsTab, onJump: (t: SettingsTab) => void): ReactElement {
  switch (tab) {
    case 'hooks': return <HooksPanel t={tt} />;
    case 'server': return <ServerPanel t={tt} />;
    case 'graph': return <GraphPanel t={tt} />;
    case 'sqlite': return <SqlitePanel t={tt} />;
    case 'proxy': return <ProxyPanel t={tt} />;
    case 'diag':
    default:
      return <DiagPanel t={tt} onJump={(x) => onJump(x as SettingsTab)} />;
  }
}

export function SettingsLayout(): ReactElement {
  const [tab, setTab] = useState<SettingsTab>('diag');

  return (
    <div className="settings-layout" data-testid="settings-layout">
      <nav className="settings-nav" data-testid="settings-nav" role="tablist">
        {SETTINGS_TABS.map(({ key, labelKey }) => (
          <button
            key={key}
            type="button"
            role="tab"
            data-settings-tab={key}
            aria-selected={tab === key}
            className={`settings-tab${tab === key ? ' active' : ''}`}
            onClick={() => setTab(key)}
          >
            {tt(labelKey)}
          </button>
        ))}
      </nav>
      <section className="settings-panel" data-testid="settings-panel">
        {renderPanel(tab, setTab)}
      </section>
    </div>
  );
}
