// app/SettingsLayout.tsx — settings 모드 레이아웃 셸 (P4-06)
//
// 원본: main.js enterSettingsMode + settings-view.js(1590) 의 sub-tab 라우터.
//   진단/Hook/서버/Storage/Proxy 5 패널을 좌측 네비 + 활성 패널 region 으로 조립한다.
//   (SQLite·Graph DB 두 탭은 단일 "Storage" 탭으로 통합 — storage-redesign 후속.)
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
  DiagPanel, ServerPanel, StoragePanel, IntegrationPanel,
  SettingsHeader,
} from '../features/settings';
import { SidebarVersionFooter } from '../features/dashboard/SidebarVersionFooter';
import { Toast } from '../components/settings/Toast';
import { useTranslation } from 'react-i18next';

/** sub-tab 식별자. (Hook·Proxy → 'integration', SQLite·Graph → 'storage' 통합.) */
type SettingsTab = 'diag' | 'integration' | 'server' | 'storage';

/**
 * 네비 항목 정의(SSoT) — 탭 키 + i18n 라벨 키.
 *   라벨키는 `tab-<key>` 형식(locales 의 ui.settings-view.tab-diag 등) — dot 형식은 미존재 키라 raw 노출됨.
 *   비개발자 친화: Hook·Proxy(데이터 수집 연동)는 'Integration', SQLite·Graph(저장)는 'Storage' 로 통합.
 */
const SETTINGS_TABS: ReadonlyArray<{ key: SettingsTab; labelKey: string }> = [
  { key: 'diag', labelKey: 'ui.settings-view.tab-diag' },
  { key: 'integration', labelKey: 'ui.settings-view.tab-integration' },
  { key: 'storage', labelKey: 'ui.settings-view.tab-storage' },
  { key: 'server', labelKey: 'ui.settings-view.tab-server' },
];

/**
 * 활성 탭 → 해당 패널. 각 패널은 t 주입(+자체 fetch).
 *   - diag 만 onJump 로 탭 전환 통지(원본 :349 jump 버튼).
 *   - copy 가능 패널(diag/storage/integration/server)은 onCopy → 상위 Toast 호스트(원본 toast :1579).
 *   - refreshKey 는 "전체 진단 다시 실행"(원본 settingsRefreshBtn :131) — 키 변경 시 패널 remount→refetch.
 */
function renderPanel(
  tab: SettingsTab,
  onJump: (t: SettingsTab) => void,
  onCopy: (text: string) => void,
  t: (key: string, vars?: Record<string, unknown>) => string,
): ReactElement {
  switch (tab) {
    case 'integration': return <IntegrationPanel t={t} onCopy={onCopy} />;
    case 'server': return <ServerPanel t={t} onCopy={onCopy} />;
    case 'storage': return <StoragePanel t={t} onCopy={onCopy} />;
    case 'diag':
    default:
      return <DiagPanel t={t} onJump={(x) => onJump(x as SettingsTab)} onCopy={onCopy} />;
  }
}

export function SettingsLayout(): ReactElement {
  // i18n — react-i18next 단일 경로. 언어 변경 시 useTranslation 구독으로 재렌더 → t() 재평가(reload 불요).
  const { t } = useTranslation();
  // 패널/헤더(모듈 함수 renderPanel 경유)는 TFunc 계약((key,vars)=>string)을 prop 으로 받는다.
  //   react-i18next t 를 그 시그니처로 래핑 — 레거시 tt 주입을 대체(window.I18n 비참조).
  const tx = useCallback(
    (key: string, vars?: Record<string, unknown>): string => t(key, vars) as unknown as string,
    [t],
  );
  const [tab, setTab] = useState<SettingsTab>('diag');
  // 새로고침 카운터 — 증가 시 활성 패널을 remount 시켜 useAsyncResource 재페치(원본 renderActiveTab 재실행 :131).
  const [refreshKey, setRefreshKey] = useState(0);
  // 복사 토스트 호스트(무전역) — 패널 onCopy 통지 시 1.8s 노출(원본 copyToClipboard→toast :1571).
  const [toast, setToast] = useState<string | null>(null);

  const onRefresh = useCallback(() => setRefreshKey((n) => n + 1), []);
  const onCopy = useCallback((text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => setToast(t('ui.settings-view.proxy.copied')),
        () => setToast('Copy failed'),
      );
    } else {
      setToast(t('ui.settings-view.proxy.copied'));
    }
  }, [t]);

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
      <SettingsHeader onRefresh={onRefresh} t={tx} />
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
              {t(labelKey)}
            </button>
          ))}
          {/* 버전 뱃지 — 사이드바가 없는 settings 모드에서 nav 하단에 in-flow 로 배치(fixed 폴백 대체). */}
          <SidebarVersionFooter />
        </nav>
        <div className="settings-content" data-testid="settings-panel" role="tabpanel">
          {/* key=tab:refreshKey — 탭 전환·새로고침 모두 패널 remount → useAsyncResource 재페치(원본 :131). */}
          <div key={`${tab}:${refreshKey}`} className="settings-content-body">
            {renderPanel(tab, setTab, onCopy, tx)}
          </div>
        </div>
      </div>
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </section>
  );
}
