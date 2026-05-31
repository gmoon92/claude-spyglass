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

import { useCallback, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useSSE } from '../hooks/use-sse';
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

  // SSE 연결 상태 — onOpen=연결, onError=끊김. 초기 true(연결 시도 중엔 배너 숨김 — 원본 onError 전까지 숨김).
  const [connected, setConnected] = useState(true);
  const lifecycle = useMemo(
    () => ({ onOpen: () => setConnected(true), onError: () => setConnected(false) }),
    [],
  );
  useSSE(useMemo(() => buildAppSSECallbacks(lifecycle), [lifecycle]));

  // 버전 폴링 — 배지/캐시/shallow. SSR 에서는 effect 미발화 → 초기 loading/null/false.
  const { view, cache, isShallow } = useVersionCheck();

  // 모달 open 셸 로컬 상태 — available 배지 클릭 시 진입(openModal 가드 1:1).
  const [modalOpen, setModalOpen] = useState(false);

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

      <div className="main-layout">
        <AppRail appMode={activeMode} onSelect={setAppMode} t={tt} />
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
        onOpen={() => setModalOpen(true)}
        t={tt}
      />
      <UpdateModal
        open={modalOpen}
        currentVersion={cache?.currentVersion ?? view.currentVersion}
        latestTag={cache?.latestTag ?? view.latestTag}
        onConfirm={onConfirmUpdate}
        onCancel={() => setModalOpen(false)}
        onClose={() => setModalOpen(false)}
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
