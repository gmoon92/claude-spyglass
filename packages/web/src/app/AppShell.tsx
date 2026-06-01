// app/AppShell.tsx — 앱 chrome 조립 셸 (P4-09)
//
// 원본: index.html 정적 chrome — .app-rail(:130) / #errorBanner(:117) / .footer(:854) /
//   #updateModal(:866) / #dashboardShallowWarning(:950). P4-06 셸이 좌/우 패널만 조립해 생긴
//   chrome gap(.manual-verify-p4-07 §5)을 메운다. 콘텐츠(AppRoutes)를 chrome 으로 감싼다.
//
// 결선:
//   - AppRail: 활성 모드는 현재 경로(useLocation→pathToAppMode)에서 도출, 클릭은 setAppMode →
//     AppModeSync 가 navigate(store→URL). rail aria-current 가 라우트와 항상 정합(SSR 결정적).
//   - ErrorBanner: SSE onError → connected=false 시 노출, onRetry 는 강제 reload(원본 retryBtn 동치).
//     SSE 생명주기(onOpen/onError)는 본 셸이 보유한 connected 상태와 SSEBinding 으로 결선.
//   - Footer: 도움말 진입(onHelp) — 오버레이 자체는 후속 chrome(본 범위 밖, no-op 가능).
//   - UpdateBadge/UpdateModal: useVersionCheck 폴링 결과를 controlled props 로. 모달 open 은 셸 로컬 상태.
//   - DashboardWarning: useVersionCheck.isShallow + localStorage dismiss(원본 SHALLOW_DISMISS_KEY).
//
// SSR 안전: 모든 fetch/EventSource 는 useEffect(useSSE/useVersionCheck) 안 → renderToStaticMarkup 미발화.
//
// 레이어(architecture.md §1.3): app 셸 → features(dashboard) + hooks(use-sse) + stores 정방향.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useSSE } from '../hooks/use-sse';
import { useTooltip } from '../hooks/use-tooltip';
import { useAppStore } from '../stores/app-store';
import { buildAppSSECallbacks } from './app-sse';
import { pathToAppMode } from './app-mode-route';
import { tt } from './i18n-labeler';
import { AppRail } from './AppRail';
import { ErrorBanner } from './ErrorBanner';
import { Footer } from './Footer';
import { DashboardWarning } from './DashboardWarning';
import {
  UpdateBadge,
  UpdateModal,
  useVersionCheck,
} from '../features/dashboard';
import { copyToClipboard } from '../lib/clipboard';

/** shallow warning dismiss 영속 키 — version-check.js SHALLOW_DISMISS_KEY(:50) 1:1. */
const SHALLOW_DISMISS_KEY = 'spyglass:shallow-warning-dismissed';

/** localStorage 안전 읽기 — dismiss 됨? (SSR/예외 안전). */
function readShallowDismissed(): boolean {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls?.getItem(SHALLOW_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * 앱 chrome 셸 — rail + 콘텐츠(children) + footer + error-banner + update-modal + dashboard-warning.
 * 라우터 컨텍스트 안에서 마운트해야 한다(useLocation/AppModeSync 의존).
 */
export function AppShell({ children }: { children: ReactNode }): ReactElement {
  const location = useLocation();
  const setAppMode = useAppStore((s) => s.setAppMode);

  // rail 활성 모드 — 현재 경로에서 도출(SSR 결정적, store hydrate 무관).
  const activeMode = pathToAppMode(location.pathname);

  // body[data-app-mode] 동기화 — 레거시 main.js#applyAppMode(:73-123) 의 선언적 대체.
  //   레거시 CSS(left-panel/settings-view/meta-docs)는 body[data-app-mode="browse|metadocs|settings"]
  //   셀렉터로 모드별 show/hide 를 제어한다. React 라우팅은 이 속성을 세팅하지 않아 모드-게이트 CSS 가
  //   전부 무력화됐다(설정뷰 display:none, 메타 모드 세션섹션 미숨김 등). 외부 DOM 속성 동기화는
  //   effect 가 정석(렌더 중 부수효과 금지). SSR(renderToStaticMarkup)에서는 미발화.
  useEffect(() => {
    const body = (globalThis as { document?: Document }).document?.body;
    if (!body) return;
    body.dataset.appMode = activeMode;
  }, [activeMode]);

  // SSE 연결 상태 — onOpen=연결, onError=끊김. 초기 true(연결 시도 중엔 배너 숨김 — 원본 onError 전까지 숨김).
  const [connected, setConnected] = useState(true);
  const lifecycle = useMemo(
    () => ({ onOpen: () => setConnected(true), onError: () => setConnected(false) }),
    [],
  );
  useSSE(useMemo(() => buildAppSSECallbacks(lifecycle), [lifecycle]));

  // 전역 호버 툴팁(레거시 stat-tooltip/obs-tooltip/cache-panel-tooltip/cache-tooltip 통합 포팅).
  //   document 위임으로 [data-*-tooltip] / .cache-cell 감지 — per-component JSX 수정 없음.
  useTooltip();

  // 버전 폴링 — 배지/캐시/shallow. SSR 에서는 effect 미발화 → 초기 loading/null/false.
  const { view, cache, isShallow } = useVersionCheck();

  // 모달 open 셸 로컬 상태 — available 배지 클릭 시 진입(openModal 가드 1:1).
  const [modalOpen, setModalOpen] = useState(false);
  // 모달 토글 콜백 — memo(UpdateBadge/UpdateModal) 가 유효하도록 참조 안정화(인라인 화살표 제거).
  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  // 좌측 패널 접기(#btnPanelCollapse + ⌘B) — 원본 main.js#toggleLeftPanel(:911) + 단축키(:917).
  //   .main-layout 에 left-panel-hidden 클래스를 토글(원본 클래스 1:1).
  const [leftPanelHidden, setLeftPanelHidden] = useState(false);
  const toggleLeftPanel = useCallback(() => setLeftPanelHidden((v) => !v), []);
  useEffect(() => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return;
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'b') return;
      e.preventDefault();
      toggleLeftPanel();
    };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [toggleLeftPanel]);

  // shallow dismiss 로컬 상태 — 초기값은 localStorage 영속분 반영(원본 applyShallowWarning dismiss 판정).
  const [shallowDismissed, setShallowDismissed] = useState<boolean>(() => readShallowDismissed());

  const onHelp = useCallback(() => {
    // keyboard-help 오버레이는 후속 chrome — 진입점만 노출(본 범위 밖). 안전 no-op.
  }, []);

  const onRetry = useCallback(() => {
    // 원본 retryBtn → 재연결. SSE 컨트롤러는 자체 5초 backoff 재연결하므로, 즉시 재시도는 reload 동치.
    try { (globalThis as { location?: Location }).location?.reload(); } catch { /* noop */ }
  }, []);

  const onConfirmUpdate = useCallback(() => {
    // doUpdate(POST /api/update) 오케스트레이션은 후속 결선(본 범위: 모달 토글 + 진입). 안전 no-op.
  }, []);

  const onDismissShallow = useCallback(() => {
    try {
      (globalThis as { localStorage?: Storage }).localStorage?.setItem(SHALLOW_DISMISS_KEY, '1');
    } catch { /* noop */ }
    setShallowDismissed(true);
  }, []);

  const onCopyShallow = useCallback((command: string) => {
    void copyToClipboard(command, () => { /* 토스트 마운트는 후속 — 복사만 */ });
  }, []);

  return (
    <>
      <div className="app-shell" data-testid="app-shell">
      {/* 연결 실패 배너 — .app-shell grid row1(auto). main-layout 보다 먼저 와야 row 정합. */}
      <ErrorBanner visible={!connected} onRetry={onRetry} t={tt} />

      <div className={`main-layout${leftPanelHidden ? ' left-panel-hidden' : ''}`}>
        <AppRail appMode={activeMode} onSelect={setAppMode} t={tt} />
        {/* 좌측 패널 접기 토글(원본 sidebar-edge-toggle) — ⌘B 단축키와 동작 공유. */}
        <button
          className="sidebar-edge-toggle"
          id="btnPanelCollapse"
          type="button"
          title={tt('ui.html.sidebar-toggle.title')}
          aria-label={tt('ui.html.sidebar-toggle.aria')}
          onClick={toggleLeftPanel}
        >
          <svg className="ds-chevron" data-dir={leftPanelHidden ? 'right' : 'left'} aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M7.5 2L3.5 6L7.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {/* 콘텐츠 슬롯 — AppRoutes(좌/우 패널 레이아웃). */}
        {children}
      </div>

      <Footer onHelp={onHelp} t={tt} />
      </div>

      {/* overlay(grid 흐름 밖) — UpdateBadge/Modal/Warning 은 자체 position. app-shell grid row 를
          먹어 main-layout 1fr 을 압박하지 않도록 app-shell 형제로 분리. */}
      <UpdateBadge
        state={view.badge}
        currentVersion={view.currentVersion}
        latestTag={view.latestTag}
        onOpen={openModal}
        t={tt}
      />
      <UpdateModal
        open={modalOpen}
        currentVersion={cache?.currentVersion ?? view.currentVersion}
        latestTag={cache?.latestTag ?? view.latestTag}
        onConfirm={onConfirmUpdate}
        onCancel={closeModal}
        onClose={closeModal}
        t={tt}
      />

      <DashboardWarning
        visible={isShallow && !shallowDismissed}
        onDismiss={onDismissShallow}
        onCopy={onCopyShallow}
        t={tt}
      />
    </>
  );
}
