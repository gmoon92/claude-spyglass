import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { i18next } from './lib/i18n';
import { bridgeLegacyI18n, type LegacyI18nLike } from './lib/i18n-legacy-bridge';

// i18n Phase B1(태스크 #12) — react-i18next 인스턴스 초기화(import 시) + 레거시 window.I18n 과 언어 동기.
//   전환기에는 두 시스템이 공존한다: 미변환 컴포넌트는 window.I18n.t(tt) 를, 변환 컴포넌트는
//   useTranslation 을 쓴다. 둘이 같은 언어를 추종하도록 브릿지를 설치한다.
//
//   초기 언어는 react-i18next 자신의 init(lng: resolveInitialLang())이 SSoT 다 — 레거시와 동일 우선순위·
//   동일 localStorage 키라 정합한다. 과거 부팅 시 레거시 getLang() 을 읽어 덮어쓰던 코드는 main.tsx 가
//   deferred 모듈이라 레거시 DOMContentLoaded init 전에 실행돼 미초기화 기본값('ko')을 읽어 `?lang=en`
//   같은 올바른 init 언어를 ko 로 고착시키는 회귀(lang-switch)를 유발했다 — 제거. 런타임 전환만 브릿지한다
//   (classic lang-switcher 가 setLang→onChange 발화 → changeLanguage → reload 없이 변환분 재렌더).
bridgeLegacyI18n(i18next, (globalThis as { I18n?: LegacyI18nLike }).I18n);

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
