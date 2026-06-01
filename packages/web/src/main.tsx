import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { i18next } from './lib/i18n';

// i18n Phase B1(태스크 #12) — react-i18next 인스턴스 초기화(import 시) + 레거시 window.I18n 과 언어 동기.
//   전환기에는 두 시스템이 공존한다: 미변환 컴포넌트는 window.I18n.t(tt) 를, 변환 컴포넌트는
//   useTranslation 을 쓴다. 둘이 같은 언어를 추종하도록, classic lang-switcher 가 window.I18n.setLang →
//   onChange 를 발화하면 react-i18next 인스턴스도 changeLanguage 로 따라간다(reload 없이 변환분 재렌더).
//   (Phase C 로 전 컴포넌트 변환 완료 후 Phase B2 에서 lang-switcher reload 를 제거한다.)
{
  const w = globalThis as { I18n?: { getLang?: () => string; onChange?: (fn: (lng: string) => void) => void } };
  const initial = w.I18n?.getLang?.();
  if (initial) void i18next.changeLanguage(initial);
  w.I18n?.onChange?.((lng) => { void i18next.changeLanguage(lng); });
}

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
