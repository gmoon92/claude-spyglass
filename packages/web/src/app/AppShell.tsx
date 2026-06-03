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
import { TooltipLayer } from '../hooks/use-tooltip';
import { useAppStore } from '../stores/app-store';
import { buildAppSSECallbacks } from './app-sse';
import { pathToAppMode } from './app-mode-route';
import { useTranslation } from 'react-i18next';
import { AppRail } from './AppRail';
import { ErrorBanner } from './ErrorBanner';
import { Footer } from './Footer';
import { KeyboardHelpModal } from './KeyboardHelpModal';
import { useKeyboardShortcuts } from './use-keyboard-shortcuts';
import { DashboardWarning } from './DashboardWarning';
import {
  UpdateBadge,
  UpdateModal,
  useVersionCheck,
} from '../features/dashboard';
import { useVersionStore } from '../stores/version-store';
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
  // i18n(태스크 #12) — 언어 변경 시 chrome 재렌더 구독. t 는 i18next(미스 키는 window.I18n 폴백).
  //   memo 된 chrome(UpdateBadge/UpdateModal/DashboardWarning)에 t={t} 로 주입 → 언어 변경 시 t ref 변화로
  //   memo 가 풀려 라벨이 갱신된다(t={t} 안정 ref 였다면 memo 가 막아 stale).
  const { t } = useTranslation();
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

  // 버전 폴링 — 단일 폴러(앱 전체에서 AppShell 1곳만). SSR 에서는 effect 미발화 → 초기 loading/null/false.
  //   결과를 version-store 에 기록해, 위치가 분리된 사이드바 배지(트리거)와 셸 모달/경고(오버레이)가
  //   동일 SSoT 를 구독하게 한다(버그 #6 — 배지 이중 렌더 + 폴러 중복 제거).
  const { view, cache, isShallow } = useVersionCheck();
  const setVersion = useVersionStore((s) => s.setVersion);
  useEffect(() => {
    setVersion({ view, cache, isShallow });
  }, [view, cache, isShallow, setVersion]);

  // 모달 open 상태 — 사이드바 배지가 열 수 있도록 version-store 가 소유(위치 분리 트리거↔오버레이 결합).
  const modalOpen = useVersionStore((s) => s.modalOpen);
  const openModal = useVersionStore((s) => s.openModal);
  const closeModal = useVersionStore((s) => s.closeModal);

  // doUpdate 진행/결과 — POST /api/update 오케스트레이션 상태(원본 version-check.js doUpdate 결선).
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | undefined>(undefined);
  const [updateSuccess, setUpdateSuccess] = useState<string | undefined>(undefined);

  // 모달 닫기 — 진행 중(updating)엔 차단(재시작 응답 유실 방지) + 결과 메시지 초기화(다음 진입 잔여 방지).
  const handleModalClose = useCallback(() => {
    if (updating) return;
    setUpdateError(undefined);
    setUpdateSuccess(undefined);
    closeModal();
  }, [updating, closeModal]);

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

  // 키보드 단축키 도움말 모달(레거시 keyboard.js + renderKbdHelpModal 복원) — footer `?` 버튼과
  //   `?` 키 모두 토글(레거시 btnHelpOpen→toggleKbdHelp 1:1). 전역 keydown(/·⌘F·1-7·ESC 체인)은
  //   use-keyboard-shortcuts 훅이 단일 소유.
  const [helpOpen, setHelpOpen] = useState(false);
  const onHelp = useCallback(() => setHelpOpen((v) => !v), []);
  const onCloseHelp = useCallback(() => setHelpOpen(false), []);
  useKeyboardShortcuts({ helpOpen, onToggleHelp: onHelp, onCloseHelp });

  const onRetry = useCallback(() => {
    // 원본 retryBtn → 재연결. SSE 컨트롤러는 자체 5초 backoff 재연결하므로, 즉시 재시도는 reload 동치.
    try { (globalThis as { location?: Location }).location?.reload(); } catch { /* noop */ }
  }, []);

  // 업데이트 확정 — POST /api/update(routes/version.ts): git pull + bun install 후 1.2s 뒤 서버 자기 재시작.
  //   성공 응답은 재시작 "전"에 작성되므로(restarting:true), 성공 메시지 노출 후 잠시 뒤 reload 하여 새 버전 회수.
  //   409(local_changes)·500(pull/install 실패)은 메시지 분기. updating 가드로 중복 POST 차단.
  const onConfirmUpdate = useCallback(async () => {
    if (updating) return;
    setUpdating(true);
    setUpdateError(undefined);
    setUpdateSuccess(undefined);
    try {
      const res = await fetch('/api/update', { method: 'POST' });
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;
      if (res.ok && json?.success) {
        setUpdateSuccess(t('ui.html.update-modal.success'));
        // 서버 재시작(1.2s) + 부팅 여유 후 reload — 재시작 중 연결 실패는 SSE 재연결/이 reload 가 흡수.
        setTimeout(() => {
          try { (globalThis as { location?: Location }).location?.reload(); } catch { /* noop */ }
        }, 4000);
        return; // 성공 경로는 reload 까지 updating 유지(버튼 비활성 + "업데이트 중…").
      }
      const key = json?.error === 'local_changes'
        ? 'ui.html.update-modal.error-local-changes'
        : 'ui.html.update-modal.error-generic';
      setUpdateError(t(key));
      setUpdating(false);
    } catch {
      setUpdateError(t('ui.html.update-modal.error-generic'));
      setUpdating(false);
    }
  }, [updating, t]);

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
      <ErrorBanner visible={!connected} onRetry={onRetry} t={t} />

      <div className={`main-layout${leftPanelHidden ? ' left-panel-hidden' : ''}`}>
        <AppRail appMode={activeMode} onSelect={setAppMode} t={t} />
        {/* 좌측 패널 접기 토글(원본 sidebar-edge-toggle) — ⌘B 단축키와 동작 공유. */}
        <button
          className="sidebar-edge-toggle"
          id="btnPanelCollapse"
          type="button"
          title={t('ui.html.sidebar-toggle.title')}
          aria-label={t('ui.html.sidebar-toggle.aria')}
          onClick={toggleLeftPanel}
        >
          <svg className="ds-chevron" data-dir={leftPanelHidden ? 'right' : 'left'} aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M7.5 2L3.5 6L7.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {/* 콘텐츠 슬롯 — AppRoutes(좌/우 패널 레이아웃). */}
        {children}
      </div>

      <Footer onHelp={onHelp} t={t} />
      </div>

      {/* fallback 배지(버그 #6) — 사이드바가 없는 모드(settings)에서만 노출한다. browse/metadocs 는
          사이드바 footer(.left-panel-footer)가 배지를 소유하므로 여기선 숨긴다. 노드는 항상 마운트하고
          body[data-app-mode] 게이트 CSS(.app-shell-update-badge — left-panel.css)로 visibility 만 제어:
          (1) AppShell chrome 마운트 계약(app-shell.test SSR `update-badge--loading`) 보존,
          (2) 과거 .app-shell 형제로 직접 둬 position 없는 width:100% 버튼이 footer 아래 전폭으로 깔리던
              stray 제거. 배지는 version-store 구독(단일 폴러 결과)으로 controlled. */}
      <div className="app-shell-update-badge">
        <UpdateBadge
          state={view.badge}
          currentVersion={view.currentVersion}
          latestTag={view.latestTag}
          onOpen={openModal}
          t={t}
        />
      </div>
      <UpdateModal
        open={modalOpen}
        currentVersion={cache?.currentVersion ?? view.currentVersion}
        latestTag={cache?.latestTag ?? view.latestTag}
        onConfirm={onConfirmUpdate}
        onCancel={handleModalClose}
        onClose={handleModalClose}
        t={t}
        busy={updating}
        errorMessage={updateError}
        successMessage={updateSuccess}
      />

      <DashboardWarning
        visible={isShallow && !shallowDismissed}
        onDismiss={onDismissShallow}
        onCopy={onCopyShallow}
        t={t}
      />

      {/* 키보드 단축키 도움말 모달(레거시 #kbdHelpBackdrop) — footer `?` 버튼·`?` 키 토글, ESC/백드롭/× 닫기. */}
      <KeyboardHelpModal open={helpOpen} onClose={onCloseHelp} t={t} />

      {/* 전역 호버 툴팁(B-1 — React Portal). document 위임으로 [data-*-tooltip]/.cache-cell 감지 +
          tooltip-store point-hover 구독 → createPortal(body) 로 .stat-tooltip/.cache-tooltip 표시.
          per-component JSX 수정 없음(레거시 stat/obs/cache-panel/cache 툴팁 통합 포팅). */}
      <TooltipLayer />
    </>
  );
}
