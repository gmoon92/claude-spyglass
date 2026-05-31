import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';

// P4-10: 운영 진입 전환 — index.html(#react-root)에 App(AppShell+AppRoutes) 트리를 마운트.
//   - App: BrowserRouter + AppModeSync + AppShell(chrome: rail/footer/banner/modal/warning) + AppRoutes.
//   - StrictMode: 개발 시 부수효과 이중 호출로 effect 정합성 검출(프로덕션 빌드는 단일 호출).
//   - classic i18n 3종(window.I18n)은 이 module 진입 전에 로드됨(index.html + externalizeDaemonAssets plugin).
const container = document.getElementById('react-root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
  // 원본 main.js:865 이식 — init 완료 후 html.app-ready 부여.
  // layout.css 의 `html:not(.app-ready) .main-layout {...}` preinit 규칙이 grid/left-panel 을
  // 축소·차단하므로, 이 클래스를 붙여야 레이아웃이 활성화된다(rAF×2 = React 마운트 paint 후).
  requestAnimationFrame(() =>
    requestAnimationFrame(() => document.documentElement.classList.add('app-ready'))
  );
}
