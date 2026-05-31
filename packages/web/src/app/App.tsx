// app/App.tsx — React Router v6 App 조립 (P4-06)
//
// 원본: main.js(1036) 의 appMode CSS 라우팅(applyAppMode body[data-app-mode]) + init 초기화 +
//   startSSE 결선을 React Router v6 + 최상위 SSE 바인딩으로 대체 설계한다.
//
// 구성:
//   App        — 최상위. BrowserRouter + 최상위 SSE 바인딩(useSSE) + AppModeSync + AppRoutes.
//   AppRoutes  — Routes 정의(테스트 진입점: MemoryRouter 로 감싸 경로별 레이아웃 마운트 검증).
//   AppModeSync— app-store.appMode ↔ URL 양방향 동기(applyAppMode 의 선언적 대체, app-mode-route SSoT).
//
// init 순서(tasks.json verify §2: store hydrate → 라우터 마운트 → SSE 연결):
//   1) store hydrate: app-store persist 미들웨어가 모듈 로드 시 자동 복원(activeRange). 별도 호출 불요.
//   2) 라우터 마운트: BrowserRouter + AppRoutes.
//   3) SSE 연결: useSSE 의 useEffect 가 마운트 직후 1회 connect — 라우터 마운트 이후 발화 보장(자식 effect 순서).
//
// 진입 전환 경계(P4-07): 본 App 은 작성/테스트만(병존). main.tsx 의 실 entry 전환과
//   index.html <script> 교체는 P4-07 에서 수행한다(현행 main.js 무수정 병존, 회귀 0).
//
// 레이어(architecture.md §1.3): app → features/hooks/stores/components 정방향(역참조 0).

import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import {
  BrowserRouter, MemoryRouter, Routes, Route,
  useLocation, useNavigate,
} from 'react-router-dom';
import { useAppStore } from '../stores/app-store';
import { ROUTE_PATHS, appModeToPath, pathToAppMode } from './app-mode-route';
import { BrowseLayout } from './BrowseLayout';
import { MetaDocsLayout } from './MetaDocsLayout';
import { SettingsLayout } from './SettingsLayout';
import { AppShell } from './AppShell';

/**
 * appMode ↔ URL 양방향 동기 — main.js applyAppMode(body[data-app-mode]) 의 선언적 대체.
 *
 *   - URL → store: 라우트 진입/변경 시 pathToAppMode 로 store.appMode 정정(딥링크/뒤로가기 정합).
 *   - store → URL: rail 등으로 store.appMode 가 바뀌면 appModeToPath 로 navigate(모드 버튼 → 경로 이동).
 *
 * 두 effect 모두 "이미 일치하면 no-op" 가드 → 무한 navigate/set 루프 차단.
 * 렌더는 없다(동기 전용 컴포넌트).
 */
export function AppModeSync(): null {
  const location = useLocation();
  const navigate = useNavigate();
  const appMode = useAppStore((s) => s.appMode);
  const setAppMode = useAppStore((s) => s.setAppMode);

  // URL → store: 현재 경로가 가리키는 모드로 store 정정(불일치 시에만).
  useEffect(() => {
    const modeFromPath = pathToAppMode(location.pathname);
    if (modeFromPath !== appMode) setAppMode(modeFromPath);
    // location.pathname 변화에만 반응(appMode 는 아래 effect 가 담당 — 책임 분리).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // store → URL: appMode 가 가리키는 경로로 navigate(현재 경로의 모드와 다를 때만).
  //   ★초기 마운트 skip(deep-link-race-fix): 마운트 시 URL→store effect 가 store 를 아직 정정하기 전이라
  //   appMode 는 기본값('browse')이다. 그 상태로 navigate 하면 /meta-docs 직접 진입이 즉시 / 로 클로버된다.
  //   마운트 시점에는 URL 이 SSoT — 첫 렌더에서는 navigate 하지 않고, 이후 사용자 액션(rail 클릭 등)으로
  //   appMode 가 *변할 때*만 navigate 한다(딥링크/뒤로가기 정합 유지).
  const didMountModeSync = useRef(false);
  useEffect(() => {
    if (!didMountModeSync.current) {
      didMountModeSync.current = true;
      return;
    }
    const targetPath = appModeToPath(appMode);
    if (pathToAppMode(location.pathname) !== appMode) {
      navigate(targetPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode]);

  return null;
}

/**
 * Routes 정의(테스트 진입점). 라우터 컨텍스트(Browser/Memory)는 호출처가 제공한다.
 *   '/'           → BrowseLayout
 *   '/meta-docs'  → MetaDocsLayout
 *   '/settings'   → SettingsLayout
 *   그 외          → '/' 리다이렉트(main.js applyAppMode 무효값 가드 1:1).
 */
export function AppRoutes(): ReactElement {
  return (
    <Routes>
      <Route path={ROUTE_PATHS.browse} element={<BrowseLayout />} />
      <Route path={ROUTE_PATHS.metadocs} element={<MetaDocsLayout />} />
      <Route path={ROUTE_PATHS.settings} element={<SettingsLayout />} />
      {/* 미지 경로 → BrowseLayout 직접 렌더(main.js applyAppMode 무효값 가드 1:1).
          Navigate(리다이렉트) 대신 직접 마운트해 SSR 단일 렌더에서도 결정적으로 browse 를 노출하고,
          클라이언트에서는 AppModeSync 가 store.appMode='browse' 로 정정하며 '/' 로 URL 을 정규화한다. */}
      <Route path="*" element={<BrowseLayout />} />
    </Routes>
  );
}

/**
 * App 최상위 — BrowserRouter 컨텍스트 + 모드 동기 + chrome 셸(AppShell)로 감싼 Routes.
 *
 * P4-09: SSE 바인딩은 AppShell 내부로 이관됐다(connected 상태를 ErrorBanner 에 결선 —
 *   onOpen/onError 가 셸의 가시성 상태를 갱신). chrome(rail/footer/modal/banner/warning)이
 *   AppRoutes(좌/우 패널 레이아웃)를 children 으로 감싸 페이지 전체 chrome 을 복원한다.
 * (실 entry 마운트·index.html 진입 전환은 후속 — 본 트리는 작성/테스트 병존, 회귀 0.)
 */
export function App(): ReactElement {
  return (
    <BrowserRouter>
      <AppModeSync />
      <AppShell>
        <AppRoutes />
      </AppShell>
    </BrowserRouter>
  );
}

/** 테스트 편의 — MemoryRouter 로 감싼 라우트(SSE/Sync 없이 라우트 구조만 검증할 때). */
export function AppRoutesWithMemoryRouter({ initialPath = '/' }: { initialPath?: string }): ReactElement {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <AppRoutes />
    </MemoryRouter>
  );
}
