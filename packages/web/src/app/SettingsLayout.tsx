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

import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import {
  DiagPanel, HooksPanel, ServerPanel, GraphPanel, SqlitePanel, ProxyPanel,
  SettingsHeader,
} from '../features/settings';
import { Toast } from '../components/settings/Toast';
import { useTranslation } from 'react-i18next';
import { tt } from './i18n-labeler';

/** 6 sub-tab 식별자(settings-view.js 탭 순서 1:1). */
type SettingsTab = 'diag' | 'hooks' | 'server' | 'graph' | 'sqlite' | 'proxy';

/**
 * 네비 항목 정의(SSoT) — 탭 키 + i18n 라벨 키.
 *   순서/라벨키 모두 원본 index.html nav(:833-844) 1:1 — diag → proxy → hooks → sqlite → graph → server.
 *   라벨키는 `tab-<key>` 형식(locales 의 ui.settings-view.tab-diag 등) — dot 형식은 미존재 키라 raw 노출됨.
 */
const SETTINGS_TABS: ReadonlyArray<{ key: SettingsTab; labelKey: string }> = [
  { key: 'diag', labelKey: 'ui.settings-view.tab-diag' },
  { key: 'proxy', labelKey: 'ui.settings-view.tab-proxy' },
  { key: 'hooks', labelKey: 'ui.settings-view.tab-hooks' },
  { key: 'sqlite', labelKey: 'ui.settings-view.tab-sqlite' },
  { key: 'graph', labelKey: 'ui.settings-view.tab-graph' },
  { key: 'server', labelKey: 'ui.settings-view.tab-server' },
];

/**
 * 활성 탭 → 해당 패널. 각 패널은 t 주입(+자체 fetch).
 *   - diag 만 onJump 로 탭 전환 통지(원본 :349 jump 버튼).
 *   - copy 가능 패널(diag/sqlite/graph/proxy/server)은 onCopy → 상위 Toast 호스트(원본 toast :1579).
 *   - refreshKey 는 "전체 진단 다시 실행"(원본 settingsRefreshBtn :131) — 키 변경 시 패널 remount→refetch.
 */
function renderPanel(
  tab: SettingsTab,
  onJump: (t: SettingsTab) => void,
  onCopy: (text: string) => void,
): ReactElement {
  switch (tab) {
    case 'hooks': return <HooksPanel t={tt} />;
    case 'server': return <ServerPanel t={tt} onCopy={onCopy} />;
    case 'graph': return <GraphPanel t={tt} onCopy={onCopy} />;
    case 'sqlite': return <SqlitePanel t={tt} onCopy={onCopy} />;
    case 'proxy': return <ProxyPanel t={tt} onCopy={onCopy} />;
    case 'diag':
    default:
      return <DiagPanel t={tt} onJump={(x) => onJump(x as SettingsTab)} onCopy={onCopy} />;
  }
}

export function SettingsLayout(): ReactElement {
  // i18n(태스크 #12) — 언어 변경 구독(재렌더 → tt/renderPanel 재평가, window.I18n 동기값 반영, reload 불요).
  useTranslation();
  const [tab, setTab] = useState<SettingsTab>('diag');
  // 새로고침 카운터 — 증가 시 활성 패널을 remount 시켜 useAsyncResource 재페치(원본 renderActiveTab 재실행 :131).
  const [refreshKey, setRefreshKey] = useState(0);
  // 복사 토스트 호스트(무전역) — 패널 onCopy 통지 시 1.8s 노출(원본 copyToClipboard→toast :1571).
  const [toast, setToast] = useState<string | null>(null);

  const onRefresh = useCallback(() => setRefreshKey((n) => n + 1), []);
  const onCopy = useCallback((text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => setToast(tt('ui.settings-view.proxy.copied')),
        () => setToast('Copy failed'),
      );
    } else {
      setToast(tt('ui.settings-view.proxy.copied'));
    }
  }, []);

  // 컨테이너 셸 — 원본 index.html `<section id="settingsView" class="settings-view">`(:814) 1:1.
  //   설정 CSS(settings-view.css) 가 `#settingsView.settings-view` 셀렉터로 grid-column:3/4 +
  //   flex column + 본문 색/보더를 부여한다. React Router 는 /settings 경로에서만 본 셸을 마운트하므로
  //   레거시의 body[data-app-mode="settings"] display 토글 대신 `.settings-view--router`
  //   (settings-view.css 말미 정의) 가 무조건 display:flex 로 가시화한다(meta-docs-root 동형).
  return (
    <section
      id="settingsView"
      className="settings-view settings-view--router"
      data-testid="settings-layout"
      aria-label="Settings panel"
    >
      <SettingsHeader onRefresh={onRefresh} t={tt} />
      {/* 본문 2-column grid — 좌 .settings-nav(200px) + 우 .settings-content(1fr). 원본 :829. */}
      <div className="settings-body">
        <nav className="settings-nav" data-testid="settings-nav" role="tablist" aria-label="Settings sub-tabs">
          {SETTINGS_TABS.map(({ key, labelKey }) => (
            <button
              key={key}
              type="button"
              role="tab"
              data-settings-tab={key}
              aria-selected={tab === key}
              className={`settings-nav-btn${tab === key ? ' is-active' : ''}`}
              onClick={() => setTab(key)}
            >
              {tt(labelKey)}
            </button>
          ))}
        </nav>
        <div className="settings-content" data-testid="settings-panel" role="tabpanel">
          {/* key=tab:refreshKey — 탭 전환·새로고침 모두 패널 remount → useAsyncResource 재페치(원본 :131). */}
          <div key={`${tab}:${refreshKey}`} className="settings-content-body">
            {renderPanel(tab, setTab, onCopy)}
          </div>
        </div>
      </div>
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </section>
  );
}
